/*
 * Search guard: every search from a Bilibili page is routed to a
 * MrBeast-scoped Bilibili search page. The search page itself is then
 * rendered by search/search.js with the official account pinned on top.
 */
(() => {
  'use strict';

  const PREF_KEY = 'mrbeast:enabled';
  const BEAST_RE = /(mr\s*beast|mrbeast|beast\s*games|野兽先生|野獸先生|野兽游戏|野獸遊戲)/i;
  const INPUT_SELECTOR = '.nav-search-input, .search-input-el';

  let enabled = false;

  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  init();

  async function init() {
    const stored = await storageGet({ [PREF_KEY]: true });
    enabled = stored[PREF_KEY] !== false;

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[PREF_KEY]) return;
      enabled = changes[PREF_KEY].newValue !== false;
      if (enabled) {
        enhanceInputs();
        observeInputs();
      } else {
        restoreInputs();
      }
    });

    if (enabled) {
      enhanceInputs();
      observeInputs();
    }
  }

  function onSubmit(event) {
    if (!enabled) return;

    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.querySelector(INPUT_SELECTOR)) return;

    const input = form.querySelector(INPUT_SELECTOR);
    intercept(event, input?.value);
  }

  function onClick(event) {
    if (!enabled) return;

    const button = event.target.closest('.nav-search-btn, .search-button');
    if (!button) return;

    const input = button.closest('form')?.querySelector(INPUT_SELECTOR)
      || document.querySelector(INPUT_SELECTOR);

    if (!input) return;
    intercept(event, input.value);
  }

  function onKeyDown(event) {
    if (!enabled || event.key !== 'Enter' || event.isComposing) return;

    const input = event.target.closest?.(INPUT_SELECTOR);
    if (!input) return;

    intercept(event, input.value);
  }

  function intercept(event, rawValue) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const keyword = buildKeyword(rawValue);
    const target = new URL('https://search.bilibili.com/all');
    target.searchParams.set('keyword', keyword);
    target.searchParams.set('from_source', 'webtop_search');
    target.searchParams.set('spm_id_from', '333.1007');

    window.location.assign(target.toString());
  }

  function buildKeyword(rawValue) {
    const query = String(rawValue || '').trim();
    if (!query) return '野兽先生';
    if (BEAST_RE.test(query)) return query;
    return `野兽先生 ${query}`;
  }

  function enhanceInputs() {
    if (!enabled) return;

    for (const input of document.querySelectorAll(INPUT_SELECTOR)) {
      if (!(input instanceof HTMLInputElement)) continue;
      if (!input.hasAttribute('data-mbo-original-placeholder')) {
        input.setAttribute('data-mbo-original-placeholder', input.placeholder || '');
        input.setAttribute('data-mbo-original-title', input.title || '');
        input.setAttribute('data-mbo-original-aria', input.getAttribute('aria-label') || '');
      }
      input.placeholder = '搜索野兽先生相关内容';
      input.title = '只会搜索野兽先生相关内容';
      input.setAttribute('aria-label', '搜索野兽先生相关内容');
    }
  }

  function restoreInputs() {
    for (const input of document.querySelectorAll(INPUT_SELECTOR)) {
      if (!(input instanceof HTMLInputElement)) continue;
      if (!input.hasAttribute('data-mbo-original-placeholder')) continue;
      input.placeholder = input.getAttribute('data-mbo-original-placeholder') || '';
      input.title = input.getAttribute('data-mbo-original-title') || '';
      const aria = input.getAttribute('data-mbo-original-aria');
      if (aria) input.setAttribute('aria-label', aria);
      else input.removeAttribute('aria-label');
      input.removeAttribute('data-mbo-original-placeholder');
      input.removeAttribute('data-mbo-original-title');
      input.removeAttribute('data-mbo-original-aria');
    }
  }

  let observerAttached = false;

  function observeInputs() {
    if (observerAttached) return;
    observerAttached = true;

    const observer = new MutationObserver(() => {
      enhanceInputs();
    });

    const attach = () => {
      if (!document.body) {
        window.setTimeout(attach, 50);
        return;
      }
      observer.observe(document.body, { childList: true, subtree: true });
      enhanceInputs();
    };

    attach();
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
})();
