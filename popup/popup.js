(() => {
  'use strict';

  const PREF_KEY = 'mrbeast:enabled';
  const HOME_LOCALES = new Set([
    'zh-hans', 'zh-hant', 'zh-cn', 'zh-tw',
    'en', 'en-us', 'en-gb',
    'ja', 'ja-jp', 'ko', 'ko-kr',
    'ru', 'de', 'fr', 'es', 'pt', 'pt-br',
    'id', 'vi', 'th', 'ar', 'tr', 'it', 'nl', 'pl', 'uk', 'ms', 'hi',
  ]);
  const $enabled = document.getElementById('enabled');
  const $includeSecondary = document.getElementById('includeSecondary');
  const $includeAllKeyword = document.getElementById('includeAllKeyword');
  const $secondaryAllRow = document.getElementById('secondaryAllRow');
  const $statusText = document.getElementById('statusText');
  const $statusDot = document.getElementById('statusDot');
  const $refresh = document.getElementById('refresh');
  const $openHome = document.getElementById('openHome');

  let activeTab = null;
  let tabState = { present: false, home: false, search: false, active: false };

  init();

  async function init() {
    const stored = await storageGet({
      [PREF_KEY]: true,
      'mrbeast:includeSecondary': false,
      'mrbeast:secondaryAll': false,
    });
    $enabled.checked = stored[PREF_KEY] !== false;
    $includeSecondary.checked = stored['mrbeast:includeSecondary'] === true;
    $includeAllKeyword.checked = stored['mrbeast:secondaryAll'] === true;
    updateSecondaryState();

    activeTab = await getActiveTab();
    tabState = await probeTab();
    updateContext();
    updateStatus();

    $enabled.addEventListener('change', onToggle);
    $includeSecondary.addEventListener('change', () => {
      storageSet({ 'mrbeast:includeSecondary': $includeSecondary.checked });
      updateSecondaryState();
      setStatus(
        $includeSecondary.checked
          ? '已开启：全部会包含 AI/解说/模仿等二创，并排在最底部。'
          : '已关闭：全部只显示官方和正常搬运。',
        false
      );
    });

    $includeAllKeyword.addEventListener('change', () => {
      storageSet({ 'mrbeast:secondaryAll': $includeAllKeyword.checked });
      setStatus(
        $includeAllKeyword.checked
          ? '已开启全量关键词：所有 ≥500 播放的野兽先生相关视频都会放到底部。'
          : '已关闭全量关键词：底部只放 AI/解说/模仿等二创类别。',
        false
      );
    });
    $refresh.addEventListener('click', onRefresh);
    $openHome.addEventListener('click', (event) => {
      event.preventDefault();
      chrome.tabs.create({ url: 'https://www.bilibili.com/' });
    });
  }

  async function onToggle() {
    const enabled = $enabled.checked;
    await storageSet({ [PREF_KEY]: enabled });

    let responded = await sendToTab({ type: 'MRBEAST_SET_ENABLED', enabled });
    let recovered = false;

    // If this tab was opened before the extension was installed/reloaded,
    // there is no content script to receive the message. Inject it once so
    // toggling back on does not require a manual refresh.
    if (enabled && !responded && !tabState.present && isRefreshableTab()) {
      recovered = await recoverContentScript();
      if (recovered) {
        tabState = { present: true, home: isHomeTab(), search: isSearchTab(), active: true };
        await sleep(120);
        await sendToTab({ type: 'MRBEAST_SET_ENABLED', enabled: true });
        await sendToTab({ type: 'MRBEAST_REFRESH' });
        responded = true;
      }
    }

    updateContext();
    updateStatus();

    if (recovered) {
      setStatus('已重新接管当前首页。', false);
    } else if (enabled && responded && isHomeTab()) {
      sendToTab({ type: 'MRBEAST_REFRESH' });
    }
  }

  async function onRefresh() {
    if (!isRefreshableTab()) {
      setStatus('请先打开哔哩哔哩首页或搜索结果页。', true);
      return;
    }

    $refresh.disabled = true;
    let sent = await sendToTab({ type: 'MRBEAST_REFRESH' });

    if (!sent && !tabState.present) {
      const recovered = await recoverContentScript();
      if (recovered) {
        tabState = { present: true, home: isHomeTab(), search: isSearchTab(), active: true };
        await sleep(120);
        await sendToTab({ type: 'MRBEAST_SET_ENABLED', enabled: true });
        sent = await sendToTab({ type: 'MRBEAST_REFRESH' });
      }
    }

    if (sent) {
      setStatus(isSearchTab() ? '已通知搜索页重新同步结果。' : '已通知首页重新同步视频。', false);
      updateContext();
    } else {
      setStatus('当前页面还没有加载扩展，请刷新一下 B 站页面。', true);
    }

    window.setTimeout(() => {
      $refresh.disabled = !isRefreshableTab();
      updateContext();
    }, 1200);
  }

  async function recoverContentScript() {
    if (!activeTab?.id) return false;

    const search = isSearchTab();
    const js = search
      ? ['content/search-guard.js', 'search/search.js']
      : ['content/content.js'];
    const css = search
      ? ['content/content.css', 'search/search.css']
      : ['content/content.css'];

    try {
      await chrome.scripting.insertCSS({
        target: { tabId: activeTab.id },
        files: css,
      });
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: js,
      });
      return true;
    } catch (error) {
      console.warn('[MrBeast Only] content script injection failed:', error);
      return false;
    }
  }

  function updateSecondaryState() {
    const enabled = $includeSecondary.checked;
    $includeAllKeyword.disabled = !enabled;
    $secondaryAllRow.classList.toggle('is-disabled', !enabled);
  }

  function updateContext() {
    const refreshable = isRefreshableTab();
    $refresh.disabled = !refreshable;
    $refresh.title = refreshable
      ? isSearchTab() ? '重新同步搜索结果' : '重新同步首页视频'
      : '只在 B 站首页或搜索结果页可用';
  }

  function updateStatus() {
    const enabled = $enabled.checked;
    const home = isHomeTab();

    $statusDot.className = 'brand__status';

    if (!enabled) {
      $statusDot.classList.add('is-off');
      setStatus(tabState.present ? '已关闭，首页恢复 B 站原样。' : '已关闭。', false);
      return;
    }

    if (home) {
      if (tabState.present) {
        $statusDot.classList.add('is-on');
        setStatus('已开启，当前首页只显示野兽先生相关内容。', false);
      } else {
        $statusDot.classList.add('is-warn');
        setStatus('已开启，但当前页面还没接管；点“刷新视频”修复。', true);
      }
      return;
    }

    if (isSearchTab()) {
      if (tabState.present) {
        $statusDot.classList.add('is-on');
        setStatus('已开启，当前搜索页只显示野兽先生相关内容。', false);
      } else {
        $statusDot.classList.add('is-warn');
        setStatus('已开启，但当前搜索页还没接管；点“刷新视频”修复。', true);
      }
      return;
    }

    if (tabState.present || isBilibiliUrl(activeTab?.url)) {
      setStatus('已开启，回到 B 站首页后自动生效。', false);
      return;
    }

    setStatus('已开启，打开 B 站首页后自动生效。', false);
  }

  function isHomeTab() {
    if (tabState.home) return true;

    if (!activeTab?.url) return false;
    try {
      const url = new URL(activeTab.url);
      if (!/^www\.bilibili\.com$/i.test(url.hostname)) return false;
      return isHomePathname(url.pathname);
    } catch {
      return false;
    }
  }

  function isHomePathname(pathname) {
    const clean = String(pathname || '')
      .replace(/\/index\.html$/i, '')
      .replace(/\/+$/, '');

    if (!clean) return true;

    const locale = clean.slice(1).toLowerCase();
    return !locale.includes('/') && HOME_LOCALES.has(locale);
  }

  function isSearchTab() {
    if (tabState.search) return true;
    if (!activeTab?.url) return false;

    try {
      const url = new URL(activeTab.url);
      return /^search\.bilibili\.com$/i.test(url.hostname)
        && /^\/(all|video)\/?$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  function isRefreshableTab() {
    return isHomeTab() || isSearchTab();
  }

  function isBilibiliUrl(rawUrl) {
    if (!rawUrl) return false;
    try {
      return /(^|\.)bilibili\.com$/i.test(new URL(rawUrl).hostname);
    } catch {
      return false;
    }
  }

  function probeTab() {
    return new Promise((resolve) => {
      if (!activeTab?.id) {
        resolve({ present: false, home: false, active: false });
        return;
      }

      try {
        chrome.tabs.sendMessage(activeTab.id, { type: 'MRBEAST_GET_STATE' }, (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve({ present: false, home: false, active: false });
            return;
          }
          resolve({
            present: true,
            home: Boolean(response.home),
            search: Boolean(response.search),
            active: Boolean(response.active),
            phase: response.phase,
            count: response.count,
          });
        });
      } catch {
        resolve({ present: false, home: false, active: false });
      }
    });
  }

  function sendToTab(message) {
    return new Promise((resolve) => {
      if (!activeTab?.id) {
        resolve(false);
        return;
      }

      try {
        chrome.tabs.sendMessage(activeTab.id, message, () => {
          resolve(!chrome.runtime.lastError);
        });
      } catch {
        resolve(false);
      }
    });
  }

  function getActiveTab() {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(tabs?.[0] || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function setStatus(text, warn) {
    $statusText.textContent = text;
    $statusText.classList.toggle('is-warn', Boolean(warn));
  }

  function storageGet(defaults) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(defaults, (result) => {
          if (chrome.runtime.lastError) {
            resolve(defaults);
            return;
          }
          resolve(result || defaults);
        });
      } catch {
        resolve(defaults);
      }
    });
  }

  function storageSet(value) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(value, () => resolve(!chrome.runtime.lastError));
      } catch {
        resolve(false);
      }
    });
  }
})();
