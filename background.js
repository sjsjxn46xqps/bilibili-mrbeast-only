/*
 * Self-healing background worker.
 *
 * Content scripts normally load automatically on Bilibili. This worker is a
 * safety net for the cases where the extension was disabled/reloaded while a
 * Bilibili tab stayed open: after the next navigation, it detects that the
 * content script is missing and injects it again.
 *
 * It also proxies the signed Bilibili space API. A background fetch can use
 * the Referer rule from rules/space-referer.json and cookies; a page fetch
 * from www.bilibili.com is blocked with HTTP 412.
 */
importScripts('lib/md5.js', 'lib/wbi.js');

(() => {
  'use strict';

  const CONTENT_JS = ['content/content.js'];
  const CONTENT_CSS = 'content/content.css';
  const SEARCH_JS = ['content/search-guard.js', 'search/search.js'];
  const SEARCH_CSS = ['content/content.css', 'search/search.css'];
  const RETRIES = 3;
  const RETRY_DELAY = 250;
  const inFlight = new Map();
  const HOME_LOCALES = new Set([
    'zh-hans', 'zh-hant', 'zh-cn', 'zh-tw',
    'en', 'en-us', 'en-gb',
    'ja', 'ja-jp', 'ko', 'ko-kr',
    'ru', 'de', 'fr', 'es', 'pt', 'pt-br',
    'id', 'vi', 'th', 'ar', 'tr', 'it', 'nl', 'pl', 'uk', 'ms', 'hi',
  ]);

  const pendingUrlChecks = new Map();

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tab?.url) return;

    if (changeInfo.status === 'complete') {
      ensureTab(tabId, tab.url);
      return;
    }

    // Bilibili is a SPA. A client-side navigation back to "/" does not emit
    // another "complete" status, so debounce URL changes separately.
    if (changeInfo.url) {
      clearTimeout(pendingUrlChecks.get(tabId));
      const timer = setTimeout(() => {
        pendingUrlChecks.delete(tabId);
        if (tab.url) ensureTab(tabId, tab.url);
      }, 450);
      pendingUrlChecks.set(tabId, timer);
    }
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    try {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab?.url) return;
        ensureTab(tabId, tab.url);
      });
    } catch {
      // The tab may have closed between activation and lookup.
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'MBO_FETCH_OFFICIAL') {
      const mid = /^\d+$/.test(String(message.mid || '')) ? String(message.mid) : '1027737427';

      globalThis.MBO_WBI.fetchOfficialVideos(mid, { pageSize: 50, maxPages: 10 })
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => {
          console.warn('[MrBeast Only] official space fetch failed:', error);
          sendResponse({ ok: false, error: String(error) });
        });

      return true;
    }

    if (message?.type === 'MBO_SEARCH_VIDEOS') {
      searchVideos(message).then(sendResponse);
      return true;
    }

    return undefined;
  });

  async function searchVideos(message) {
    const keyword = String(message.keyword || '').trim();
    const page = Math.max(1, Number(message.page) || 1);
    if (!keyword) return { ok: false, error: 'empty keyword' };

    try {
      const keys = await globalThis.MBO_WBI.getWbiKeys();
      const query = globalThis.MBO_WBI.signParams(
        { search_type: 'video', keyword, page: String(page) },
        keys.imgKey,
        keys.subKey
      );

      const response = await fetch(
        `https://api.bilibili.com/x/web-interface/wbi/search/type?${query}`,
        {
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json, text/plain, */*' },
        }
      );

      if (!response.ok) return { ok: false, error: `search HTTP ${response.status}` };
      const payload = await response.json();
      if (payload?.code !== 0) return { ok: false, error: `search API code ${payload?.code}` };

      return { ok: true, items: payload?.data?.result || [] };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    bootstrap();
  });

  chrome.runtime.onStartup.addListener(() => {
    bootstrap();
  });

  async function bootstrap() {
    const tabs = await queryTabs();
    for (const tab of tabs) {
      if (tab?.id != null) await ensureTab(tab.id, tab.url);
    }
  }

  function ensureTab(tabId, url) {
    const kind = pageKind(url);
    if (!kind) return Promise.resolve();
    if (inFlight.has(tabId)) return inFlight.get(tabId);

    const task = checkAndInject(tabId, kind).finally(() => {
      inFlight.delete(tabId);
    });

    inFlight.set(tabId, task);
    return task;
  }

  async function checkAndInject(tabId, kind) {
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      const state = await askState(tabId);
      if (state) return;
      await sleep(RETRY_DELAY);
    }

    const js = kind === 'search' ? SEARCH_JS : CONTENT_JS;
    const css = kind === 'search' ? SEARCH_CSS : [CONTENT_CSS];

    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: css });
      await chrome.scripting.executeScript({ target: { tabId }, files: js });
    } catch (error) {
      console.warn('[MrBeast Only] background injection failed:', error);
    }
  }

  function askState(tabId) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, { type: 'MRBEAST_GET_STATE' }, (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve(null);
            return;
          }
          resolve(response);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function queryTabs() {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query(
          { url: ['https://www.bilibili.com/*', 'https://bilibili.com/*', 'https://search.bilibili.com/*'] },
          (tabs) => {
            if (chrome.runtime.lastError) {
              resolve([]);
              return;
            }
            resolve(tabs || []);
          }
        );
      } catch {
        resolve([]);
      }
    });
  }

  function pageKind(rawUrl) {
    if (isHomeUrl(rawUrl)) return 'home';
    if (isSearchUrl(rawUrl)) return 'search';
    return null;
  }

  function isSearchUrl(rawUrl) {
    if (!rawUrl) return false;
    try {
      const url = new URL(rawUrl);
      if (!/^search\.bilibili\.com$/i.test(url.hostname)) return false;
      return /^\/(all|video)\/?$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  function isHomeUrl(rawUrl) {
    if (!rawUrl) return false;
    try {
      const url = new URL(rawUrl);
      if (!/^www\.bilibili\.com$/i.test(url.hostname) && !/^bilibili\.com$/i.test(url.hostname)) {
        return false;
      }

      const clean = url.pathname
        .replace(/\/index\.html$/i, '')
        .replace(/\/+$/, '');

      if (!clean) return true;

      const locale = clean.slice(1).toLowerCase();
      return !locale.includes('/') && HOME_LOCALES.has(locale);
    } catch {
      return false;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
