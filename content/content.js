/*
 * B站只看野兽先生 · MrBeast Only
 * Replaces the Bilibili homepage recommendation feed with a MrBeast-only wall.
 */
(() => {
  'use strict';

  const ROOT_ID = 'mbo-root';
  const MODE_CLASS = 'mbo-mode';
  const READY_CLASS = 'mbo-ready';
  const PREF_KEY = 'mrbeast:enabled';
  const SECONDARY_KEY = 'mrbeast:includeSecondary';
  const SECONDARY_ALL_KEY = 'mrbeast:secondaryAll';
  const CACHE_KEY = 'mrbeast:feed:v6';
  const CACHE_TTL = 30 * 60 * 1000;
  const REQUEST_GAP = 420;
  const REQUEST_TIMEOUT = 12000;
  const MIN_REFRESH_GAP = 8000;
  const MIN_REPOST_PLAY = 1000;
  const HOME_LOCALES = new Set([
    'zh-hans', 'zh-hant', 'zh-cn', 'zh-tw',
    'en', 'en-us', 'en-gb',
    'ja', 'ja-jp', 'ko', 'ko-kr',
    'ru', 'de', 'fr', 'es', 'pt', 'pt-br',
    'id', 'vi', 'th', 'ar', 'tr', 'it', 'nl', 'pl', 'uk', 'ms', 'hi',
  ]);

  const OFFICIAL = new Map([
    ['1027737427', {
      name: '野兽先生MrBeast',
      short: '主频道',
      color: '#fb7299',
      space: 'https://space.bilibili.com/1027737427',
    }],
    ['3707039702321329', {
      name: '野兽游戏MrBeast',
      short: 'Beast Games',
      color: '#ff7a45',
      space: 'https://space.bilibili.com/3707039702321329',
    }],
    ['3745034746727465', {
      name: '野兽先生MrBeastChina',
      short: '中国频道',
      color: '#00aeec',
      space: 'https://space.bilibili.com/3745034746727465',
    }],
  ]);

  const QUERIES = [
    { keyword: 'MrBeast', pages: 3 },
    { keyword: '野兽先生', pages: 3 },
    { keyword: '野兽游戏', pages: 3 },
  ];

  const BEAST_RE = /(mr\s*beast|mrbeast|beast\s*games|野兽先生|野獸先生|野兽游戏|野獸遊戲)/i;
  const TRANSLATED_RE = /(中字|中文字幕|字幕|中文|中配|熟肉|翻译|翻譯|双语|雙語|中英|机翻|機翻|cc字幕)/i;
  const COMMENTARY_RE = /(解说|解說|reaction|反應|反应|解析|拆解|评价|評價|如何看待|揭秘|纪录片|紀錄片|盘点|盤點|吐槽|锐评|銳評|杂谈|雜談|专访|專訪|分析|不是|翻拍|模仿|中国版|中國版|对比|對比|差距|能否|为什么|為什麼|为何|為何|影视飓风|影視颶風|热门事件|熱門事件)/i;
  const AI_RE = /(\bAI\b|AIGC|AI生成|AI制作|AI视频|AI创作|AI整活|AI模仿|AI还原|Sora|Runway|可灵|可靈|即梦|即夢|Midjourney|Stable Diffusion|数字人|數字人|虚拟人|虛擬人|合成视频|合成視頻|生成式|人工智能生成)/i;

  const FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'official', label: '官方' },
    { id: 'repost-translated', label: '搬运 · 翻译' },
    { id: 'repost-raw', label: '搬运 · 未翻译' },
  ];

  const CATEGORY = {
    official: { label: '官方', color: '#fb7299' },
    'repost-translated': { label: '搬运 · 翻译', color: '#00aeec' },
    'repost-raw': { label: '搬运 · 未翻译', color: '#8b5cf6' },
    secondary: { label: '二创 · 其他', color: '#8a8a94' },
  };

  const state = {
    enabled: true,
    includeSecondary: false,
    includeAllKeyword: false,
    active: false,
    booted: false,
    fetching: false,
    pendingRefresh: false,
    phase: 'idle',
    items: [],
    filter: 'all',
    sort: 'new',
    note: '',
    lastSync: 0,
    lastFetchAt: 0,
    requestToken: 0,
    root: null,
  };

  const docEl = document.documentElement;
  const boundRoots = new WeakSet();

  if (isHomePath(location.pathname)) {
    docEl.classList.add(MODE_CLASS);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                               */
  /* ------------------------------------------------------------------ */

  init();

  async function init() {
    const stored = await storageGet({ [PREF_KEY]: true, [SECONDARY_KEY]: false, [SECONDARY_ALL_KEY]: false });
    state.enabled = stored[PREF_KEY] !== false;
    state.includeSecondary = stored[SECONDARY_KEY] === true;
    state.includeAllKeyword = stored[SECONDARY_ALL_KEY] === true;
    applyMode();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      if (changes[PREF_KEY]) {
        state.enabled = changes[PREF_KEY].newValue !== false;
        applyMode();
      }

      if (changes[SECONDARY_KEY]) {
        state.includeSecondary = changes[SECONDARY_KEY].newValue === true;
        if (state.active) render();
      }

      if (changes[SECONDARY_ALL_KEY]) {
        state.includeAllKeyword = changes[SECONDARY_ALL_KEY].newValue === true;
        if (state.active) render();
      }
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message) return;

      if (message.type === 'MRBEAST_GET_STATE') {
        sendResponse({
          active: state.active,
          enabled: state.enabled,
          home: isHomePath(location.pathname),
          phase: state.phase,
          count: state.items.length,
        });
        return;
      }

      if (message.type === 'MRBEAST_SET_ENABLED') {
        state.enabled = message.enabled !== false;
        applyMode();
        sendResponse({
          ok: true,
          active: state.active,
          enabled: state.enabled,
          home: isHomePath(location.pathname),
        });
        return;
      }

      if (message.type === 'MRBEAST_REFRESH' && state.active) {
        loadFeed({ force: true });
      }
    });

    let lastPath = location.pathname;
    window.setInterval(() => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      applyMode();
    }, 650);

    window.addEventListener('popstate', applyMode);
    window.addEventListener('pageshow', () => {
      applyMode();
      if (state.active) ensureRoot();
    });
    observeDocument();
  }

  /* ------------------------------------------------------------------ */
  /* Mode / lifecycle                                                   */
  /* ------------------------------------------------------------------ */

  function isHomePath(pathname) {
    // Bilibili serves localized homepages such as /zh-Hans/ and /en/,
    // not only "/". Treat those locale roots as the homepage too.
    const clean = String(pathname || '')
      .replace(/\/index\.html$/i, '')
      .replace(/\/+$/, '');

    if (!clean) return true;

    const locale = clean.slice(1).toLowerCase();
    return !locale.includes('/') && HOME_LOCALES.has(locale);
  }

  function applyMode() {
    const shouldRun = state.enabled && isHomePath(location.pathname);
    state.active = shouldRun;

    if (!shouldRun) {
      teardown();
      return;
    }

    docEl.classList.add(MODE_CLASS);
    ensureRoot();
  }

  function teardown() {
    state.requestToken += 1;
    state.fetching = false;
    docEl.classList.remove(MODE_CLASS, READY_CLASS);
    state.phase = state.items.length ? 'ready' : 'idle';
    for (const host of document.querySelectorAll('main.mbo-host')) {
      host.classList.remove('mbo-host');
    }
    if (state.root) {
      state.root.remove();
      state.root = null;
    }
    const leftover = document.getElementById(ROOT_ID);
    if (leftover) leftover.remove();
  }

  function ensureRoot() {
    if (!state.active) return;

    const main = document.querySelector('main.bili-feed4-layout') || document.querySelector('main');
    if (!main) {
      window.setTimeout(() => {
        if (state.active) ensureRoot();
      }, 250);
      return;
    }

    main.classList.add('mbo-host');

    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('section');
      root.id = ROOT_ID;
      root.className = 'mbo';
      root.setAttribute('aria-label', '野兽先生专属首页');
      root.innerHTML = shellHTML();
      main.prepend(root);
    } else if (root.parentElement !== main) {
      main.prepend(root);
    }

    state.root = root;

    if (!boundRoots.has(root)) {
      bindRoot(root);
      boundRoots.add(root);
    }

    if (!state.booted) {
      hydrateRoot();
    } else {
      render();
    }

    // Do not depend on requestAnimationFrame here: tabs opened in the
    // background, or a page that regained focus through bfcache, may not
    // run animation callbacks in time.
    if (state.active && root.isConnected) {
      docEl.classList.add(READY_CLASS);
    }

    window.requestAnimationFrame(() => {
      if (state.active && state.root && state.root.isConnected) {
        docEl.classList.add(READY_CLASS);
      }
    });
  }

  function observeDocument() {
    const attach = () => {
      if (!document.body) {
        window.setTimeout(attach, 50);
        return;
      }

      let timer = 0;
      const observer = new MutationObserver(() => {
        if (!state.active) return;
        if (state.root && state.root.isConnected) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          if (state.active) ensureRoot();
        }, 220);
      });

      observer.observe(document.body, { childList: true, subtree: true });
    };

    attach();
  }

  /* ------------------------------------------------------------------ */
  /* Data                                                               */
  /* ------------------------------------------------------------------ */

  async function hydrateRoot() {
    if (state.booted) {
      render();
      if (!state.items.length && !state.fetching) {
        loadFeed();
      }
      return;
    }
    state.booted = true;

    const cached = await storageGet({ [CACHE_KEY]: null });
    const snapshot = cached[CACHE_KEY];
    const cachedItems = Array.isArray(snapshot?.items)
      ? snapshot.items.filter(isValidCachedItem)
      : [];

    if (cachedItems.length) {
      state.items = cachedItems;
      state.lastSync = Number(snapshot.savedAt) || 0;
      state.phase = 'ready';
      render();
    } else {
      state.phase = 'loading';
      render();
    }

    const stale = !snapshot || !state.lastSync || Date.now() - state.lastSync > CACHE_TTL;
    if (stale) {
      loadFeed();
    }
  }

  async function loadFeed({ force = false } = {}) {
    if (!state.active) return;
    if (state.fetching) {
      state.pendingRefresh = true;
      return;
    }
    if (!force && state.lastFetchAt && Date.now() - state.lastFetchAt < MIN_REFRESH_GAP) return;

    const token = ++state.requestToken;
    state.fetching = true;
    state.lastFetchAt = Date.now();

    if (!state.items.length) {
      state.phase = 'loading';
    } else {
      state.phase = 'refreshing';
    }
    state.note = '';
    render();

    try {
      const result = await fetchAll(token);

      if (token !== state.requestToken) return;

      if (result.items.length) {
        state.items = mergeItems(state.items, result.items);
        state.lastSync = Date.now();
        state.phase = 'ready';
        state.note = result.note || (result.failed > 0 ? '部分数据源暂时不可用，已显示其余结果。' : '');
        await storageSet({
          [CACHE_KEY]: {
            savedAt: state.lastSync,
            items: state.items,
          },
        });
      } else if (state.items.length) {
        state.phase = 'ready';
        state.note = '这次没有同步到新内容，先显示上次缓存的视频。';
      } else {
        state.phase = 'error';
        state.note = '没有拿到官方视频，可能是 B 站接口暂时限流。';
      }
    } catch (error) {
      console.warn('[MrBeast Only] feed request failed:', error);
      if (token !== state.requestToken) return;

      if (state.items.length) {
        state.phase = 'ready';
        state.note = '刷新失败，已显示上次缓存的视频。';
      } else {
        state.phase = 'error';
        state.note = '连接 B 站失败，请稍后重试。';
      }
    } finally {
      if (token === state.requestToken) {
        state.fetching = false;
        render();

        if (state.pendingRefresh) {
          state.pendingRefresh = false;
          if (state.active) loadFeed({ force: true });
        }
      }
    }
  }

  async function fetchAll(token) {
    // Load the official full list first. Running it beside six search requests
    // can trigger Bilibili risk control for the space API.
    const officialResult = await fetchOfficialItems().catch((error) => ({ error, items: [], total: 0 }));
    if (token !== state.requestToken) return { items: [], failed: 0 };

    const searchResult = await fetchSearchResults(token).catch((error) => ({ error, items: [], failed: 1 }));
    if (token !== state.requestToken) return { items: [], failed: 0 };

    const merged = new Map();

    // Official uploads from the space API take precedence and give us the
    // complete public upload list instead of only search-visible results.
    for (const item of officialResult.items) merged.set(item.bvid, item);
    for (const item of searchResult.items) {
      if (!merged.has(item.bvid)) merged.set(item.bvid, item);
    }

    if (!merged.size) {
      throw new Error(searchResult.error || officialResult.error || 'all requests failed');
    }

    let note = '';
    if (officialResult.error) note = '官方全量接口暂时受 B 站风控限制，官方区仅显示搜索结果。';
    else if (searchResult.error) note = '搜索接口暂时不可用，已显示官方频道全量视频。';
    else if (searchResult.failed > 0) note = '部分搜索数据源暂时不可用，已显示其余结果。';

    return {
      items: Array.from(merged.values()),
      failed: searchResult.failed || 0,
      officialTotal: officialResult.total || 0,
      note,
    };
  }

  async function fetchSearchResults(token) {
    const merged = new Map();
    let failed = 0;
    let total = 0;

    for (const query of QUERIES) {
      for (let page = 1; page <= query.pages; page += 1) {
        total += 1;
        if (token !== state.requestToken) break;

        try {
          const items = await searchViaBackground(query.keyword, page);
          for (const raw of items) {
            const item = normalizeItem(raw);
            if (!item) continue;
            if (!merged.has(item.bvid)) merged.set(item.bvid, item);
          }
        } catch (error) {
          failed += 1;
          console.warn(`[MrBeast Only] ${query.keyword} page ${page} failed:`, error);
        }

        if (page < query.pages) await sleep(REQUEST_GAP);
      }
      await sleep(REQUEST_GAP);
    }

    if (total > 0 && failed === total) {
      throw new Error('all search requests failed');
    }

    return {
      items: Array.from(merged.values()),
      failed,
    };
  }

  function searchViaBackground(keyword, page) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'MBO_SEARCH_VIDEOS', keyword, page },
          (response) => {
            if (chrome.runtime.lastError || !response?.ok) {
              reject(new Error(chrome.runtime.lastError?.message || response?.error || 'search failed'));
              return;
            }
            resolve(response.items || []);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  async function fetchOfficialItems() {
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await sleep(900);

      const result = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'MBO_FETCH_OFFICIAL', mid: '1027737427' }, (response) => {
            if (chrome.runtime.lastError || !response?.ok) {
              resolve({ error: chrome.runtime.lastError?.message || response?.error || 'official failed' });
              return;
            }
            resolve(response);
          });
        } catch (error) {
          resolve({ error: String(error) });
        }
      });

      if (result?.videos?.length) {
        return {
          items: result.videos.map(normalizeSpaceItem).filter(Boolean),
          total: result.total || result.videos.length,
        };
      }

      lastError = result?.error || 'official fetch failed';
    }

    throw new Error(lastError || 'official fetch failed');
  }

  function normalizeSpaceItem(raw) {
    if (!raw?.bvid) return null;

    const bvid = String(raw.bvid).trim();
    if (!/^BV[0-9A-Za-z]+$/.test(bvid)) return null;

    const title = decodeText(raw.title);
    if (!title) return null;

    const official = OFFICIAL.get('1027737427');

    return {
      bvid,
      mid: '1027737427',
      title,
      description: decodeText(raw.description || ''),
      tag: '',
      category: 'official',
      official: true,
      author: official.name,
      authorShort: official.short,
      authorColor: official.color,
      space: official.space,
      cover: normalizeImage(raw.pic),
      duration: normalizeDuration(raw.length),
      play: parseCount(raw.play),
      pubdate: Number(raw.created) || 0,
    };
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/plain, */*',
        },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  function normalizeItem(raw) {
    if (!raw || raw.type !== 'video') return null;

    const bvid = String(raw.bvid || '').trim();
    if (!/^BV[0-9A-Za-z]+$/.test(bvid)) return null;

    const title = decodeText(raw.title);
    if (!title) return null;

    const mid = String(raw.mid || '');
    const description = decodeText(raw.description || raw.desc || '');
    const tag = decodeText(raw.tag || '');
    const rawAuthor = decodeText(raw.author) || '未知UP主';
    const official = OFFICIAL.get(mid);
    const play = parseCount(raw.play);

    let category;
    if (official) {
      category = 'official';
    } else {
      if (!mid || play < 500) return null;
      const haystack = `${title} ${description} ${tag} ${rawAuthor}`;
      if (!BEAST_RE.test(haystack)) return null;

      const isSecondary = play < MIN_REPOST_PLAY
        || AI_RE.test(haystack)
        || (COMMENTARY_RE.test(title) && !/(搬运|中字|字幕|熟肉|完整版)/i.test(`${title} ${description}`));

      category = isSecondary
        ? 'secondary'
        : isTranslatedContent(title, description, tag) ? 'repost-translated' : 'repost-raw';
    }

    const meta = CATEGORY[category];

    return {
      bvid,
      mid,
      title,
      description,
      tag,
      category,
      official: Boolean(official),
      author: official?.name || rawAuthor,
      authorShort: official?.short || meta.label,
      authorColor: official?.color || meta.color,
      space: official?.space || `https://space.bilibili.com/${mid}`,
      cover: normalizeImage(raw.pic),
      duration: normalizeDuration(raw.duration),
      play,
      pubdate: Number(raw.pubdate) || 0,
    };
  }

  function isTranslatedContent(title, description, tag) {
    const text = `${title} ${description} ${tag}`;
    if (TRANSLATED_RE.test(text)) return true;

    // A Chinese title is a strong signal that the repost has been localized.
    const cjkCount = (title.match(/[\u3400-\u9fff]/g) || []).length;
    return cjkCount >= 2;
  }

  function isValidCachedItem(item) {
    if (!item || typeof item.bvid !== 'string' || !/^BV[0-9A-Za-z]+$/.test(item.bvid)) {
      return false;
    }
    if (typeof item.title !== 'string' || !CATEGORY[item.category]) return false;
    if (item.category === 'official') return OFFICIAL.has(String(item.mid));
    return Boolean(item.mid && item.author);
  }

  function mergeItems(...lists) {
    const merged = new Map();

    for (const list of lists) {
      for (const item of list) {
        if (!isValidCachedItem(item)) continue;
        const previous = merged.get(item.bvid);
        if (!previous || item.category === 'official') {
          merged.set(item.bvid, item);
        }
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => (b.pubdate - a.pubdate) || (b.play - a.play))
      .slice(0, 500);
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                          */
  /* ------------------------------------------------------------------ */

  function render() {
    const root = state.root;
    if (!root) return;

    root.classList.toggle('is-fetching', state.fetching);
    root.dataset.phase = state.phase;

    const grid = root.querySelector('[data-ref="grid"]');
    const stateBox = root.querySelector('[data-ref="state"]');
    const count = root.querySelector('[data-ref="count"]');
    const syncText = root.querySelector('[data-ref="sync"]');

    if (!grid || !stateBox || !count) return;

    const visibleItems = state.items.filter((item) => state.includeSecondary || item.category !== 'secondary');
    const counts = countItems(visibleItems);
    const filtered = state.filter === 'all'
      ? visibleItems
      : visibleItems.filter((item) => item.category === state.filter);
    const fullMode = state.filter === 'all' && state.includeSecondary && state.includeAllKeyword;
    const sorted = sortItems(filtered, state.filter === 'all', fullMode);

    count.textContent = visibleItems.length
      ? `共 ${visibleItems.length} 个 · 官方 ${counts.official} / 搬运 ${counts.repost}${counts.secondary ? ` / 二创 ${counts.secondary}` : ''}`
      : state.phase === 'loading'
        ? '正在同步野兽先生内容…'
        : '等待野兽先生内容';

    if (syncText) {
      syncText.textContent = state.lastSync
        ? `同步于 ${formatClock(state.lastSync)}`
        : '实时同步 B 站公开数据';
    }

    grid.replaceChildren();

    if (!sorted.length) {
      if (state.phase === 'loading' || state.phase === 'refreshing' || state.phase === 'idle') {
        renderSkeleton(grid, 8);
      }
    } else {
      for (const item of sorted) {
        grid.appendChild(renderCard(item));
      }
    }

    renderStateBox(stateBox, sorted.length);
    updateSortButtons(root);
    updateFilterButtons(root, counts);
  }

  function renderSkeleton(grid, count) {
    for (let i = 0; i < count; i += 1) {
      const card = document.createElement('div');
      card.className = 'mbo-skeleton';
      card.innerHTML = `
        <div class="mbo-skeleton__cover"></div>
        <div class="mbo-skeleton__line"></div>
        <div class="mbo-skeleton__line mbo-skeleton__line--short"></div>
      `;
      grid.appendChild(card);
    }
  }

  function renderCard(item) {
    const card = document.createElement('article');
    card.className = 'mbo-card';
    card.dataset.category = item.category;

    const link = document.createElement('a');
    link.className = 'mbo-card__cover';
    link.href = `https://www.bilibili.com/video/${item.bvid}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', item.title);

    const img = document.createElement('img');
    img.src = item.cover;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.remove();
      link.classList.add('is-cover-missing');
      const fallback = document.createElement('span');
      fallback.className = 'mbo-card__fallback';
      fallback.textContent = 'MRBEAST';
      link.prepend(fallback);
    }, { once: true });

    const shade = document.createElement('span');
    shade.className = 'mbo-card__shade';

    const badge = document.createElement('span');
    badge.className = 'mbo-card__badge';
    badge.textContent = item.authorShort;
    badge.style.setProperty('--badge-color', item.authorColor);

    const play = document.createElement('span');
    play.className = 'mbo-card__play';
    play.textContent = `▶ ${formatViews(item.play)}`;

    const duration = document.createElement('span');
    duration.className = 'mbo-card__duration';
    duration.textContent = item.duration;

    link.append(img, shade, badge, play, duration);

    const body = document.createElement('div');
    body.className = 'mbo-card__body';

    const title = document.createElement('h3');
    title.className = 'mbo-card__title';
    const titleLink = document.createElement('a');
    titleLink.href = link.href;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = item.title;
    title.append(titleLink);

    const meta = document.createElement('div');
    meta.className = 'mbo-card__meta';

    const author = document.createElement('a');
    author.className = 'mbo-card__author';
    author.href = item.space;
    author.target = '_blank';
    author.rel = 'noopener noreferrer';

    const dot = document.createElement('span');
    dot.className = 'mbo-card__author-dot';
    dot.style.background = item.authorColor;

    const authorName = document.createElement('span');
    authorName.textContent = item.author;
    author.append(dot, authorName);

    const date = document.createElement('span');
    date.className = 'mbo-card__date';
    date.textContent = formatRelativeDate(item.pubdate);

    meta.append(author, date);
    body.append(title, meta);
    card.append(link, body);

    return card;
  }

  function renderStateBox(box, visibleCount) {
    box.replaceChildren();
    box.hidden = false;

    if (state.phase === 'loading' && !state.items.length) {
      box.hidden = true;
      return;
    }

    if (state.phase === 'error' && !state.items.length) {
      box.className = 'mbo-state mbo-state--error';
      box.append(
        makeText('strong', '暂时没有连上 B 站'),
        makeText('p', state.note || '请稍后再试一次。'),
        makeActionButton('重新同步', 'retry', 'mbo-btn mbo-btn--primary')
      );
      return;
    }

    if (!visibleCount && state.items.length) {
      box.className = 'mbo-state';
      box.append(
        makeText('strong', '这个分类暂时没有内容'),
        makeText('p', '可以切换到“全部”，或点刷新重新同步 B 站搜索结果。'),
        makeActionButton('查看全部', 'show-all', 'mbo-btn mbo-btn--primary')
      );
      return;
    }

    if (!visibleCount) {
      box.className = 'mbo-state';
      box.append(
        makeText('strong', '野兽先生今天还没更新'),
        makeText('p', '搜索接口暂时没有返回相关内容，可以直接去官方空间看看。'),
        makeExternalButton('打开官方空间', 'https://space.bilibili.com/1027737427', 'mbo-btn mbo-btn--primary')
      );
      return;
    }

    if (state.note) {
      box.className = 'mbo-state mbo-state--note';
      box.append(makeText('p', state.note));
      return;
    }

    box.hidden = true;
  }

  function countItems(items) {
    let official = 0;
    let translated = 0;
    let raw = 0;
    let secondary = 0;

    for (const item of items) {
      if (item.category === 'official') official += 1;
      else if (item.category === 'repost-translated') translated += 1;
      else if (item.category === 'repost-raw') raw += 1;
      else if (item.category === 'secondary') secondary += 1;
    }

    return {
      all: items.length,
      official,
      translated,
      raw,
      secondary,
      repost: translated + raw,
    };
  }

  function updateFilterButtons(root, counts) {
    for (const button of root.querySelectorAll('[data-filter]')) {
      const filter = button.dataset.filter;
      const active = filter === state.filter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');

      const count = button.querySelector('[data-filter-count]');
      if (!count) continue;
      if (filter === 'all') count.textContent = String(counts.all);
      else if (filter === 'official') count.textContent = String(counts.official);
      else if (filter === 'repost-translated') count.textContent = String(counts.translated);
      else if (filter === 'repost-raw') count.textContent = String(counts.raw);
    }
  }

  function updateSortButtons(root) {
    for (const button of root.querySelectorAll('[data-sort]')) {
      const active = button.dataset.sort === state.sort;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }

  function sortItems(items, allMode = false, fullMode = false) {
    const sorter = (a, b) => state.sort === 'hot'
      ? (b.play - a.play) || (b.pubdate - a.pubdate)
      : (b.pubdate - a.pubdate) || (b.play - a.play);

    if (!allMode) return items.slice().sort(sorter);

    if (fullMode) {
      const official = items.filter((item) => item.category === 'official').sort(sorter);
      const rest = items.filter((item) => item.category !== 'official').sort(sorter);
      return official.concat(rest);
    }

    const primary = items.filter((item) => item.category !== 'secondary').sort(sorter);
    const secondary = items.filter((item) => item.category === 'secondary').sort(sorter);
    return primary.concat(secondary);
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                             */
  /* ------------------------------------------------------------------ */

  function bindRoot(root) {
    root.addEventListener('click', (event) => {
      const filterButton = event.target.closest('[data-filter]');
      if (filterButton) {
        const next = filterButton.dataset.filter;
        state.filter = FILTERS.some((filter) => filter.id === next) ? next : 'all';
        render();
        return;
      }

      const sortButton = event.target.closest('[data-sort]');
      if (sortButton) {
        state.sort = sortButton.dataset.sort === 'hot' ? 'hot' : 'new';
        render();
        return;
      }

      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action) return;

      if (action === 'show-all') {
        state.filter = 'all';
        render();
        return;
      }

      if (action === 'refresh' || action === 'retry') {
        event.preventDefault();
        loadFeed({ force: true });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Formatting helpers                                                 */
  /* ------------------------------------------------------------------ */

  function shellHTML() {
    return `
      <div class="mbo-shell">
        <header class="mbo-hero">
          <div class="mbo-hero__copy">
            <div class="mbo-eyebrow"><span class="mbo-eyebrow__dot"></span>BILIBILI · MRBEAST ONLY</div>
            <h1>只看<span>野兽先生</span></h1>
            <p class="mbo-hero__lead">首页不再投喂其他视频。这里只出现 MrBeast 相关的挑战、实验、疯狂奖金和搬运内容。</p>
            <div class="mbo-hero__actions">
              <button type="button" class="mbo-btn mbo-btn--primary" data-action="refresh">刷新视频</button>
              <a class="mbo-btn mbo-btn--ghost" href="https://space.bilibili.com/1027737427" target="_blank" rel="noopener noreferrer">打开官方空间 <span aria-hidden="true">↗</span></a>
            </div>
            <div class="mbo-hero__meta">
              <span data-ref="count">正在同步官方频道…</span>
              <span class="mbo-hero__sep" aria-hidden="true"></span>
              <span data-ref="sync">实时同步 B 站公开数据</span>
            </div>
          </div>

          <div class="mbo-hero__emblem" aria-hidden="true">
            <span class="mbo-orbit mbo-orbit--outer"></span>
            <span class="mbo-orbit mbo-orbit--inner"></span>
            <span class="mbo-emblem">MB</span>
            <span class="mbo-beast-word">BEAST<br>MODE</span>
            <span class="mbo-ticket mbo-ticket--one">$1,000,000</span>
            <span class="mbo-ticket mbo-ticket--two">NO OTHER VIDEOS</span>
          </div>
        </header>

        <section class="mbo-feed" aria-label="野兽先生视频">
          <div class="mbo-feed__head">
            <div>
              <h2>野兽先生片库</h2>
              <p>官方与搬运内容分开整理，按 B 站公开搜索实时同步。</p>
            </div>
            <div class="mbo-toolbar">
              <div class="mbo-seg" role="tablist" aria-label="排序方式">
                <button type="button" role="tab" data-sort="new" class="is-active" aria-selected="true">最新</button>
                <button type="button" role="tab" data-sort="hot" aria-selected="false">最热</button>
              </div>
              <button type="button" class="mbo-icon-btn" data-action="refresh" title="刷新视频" aria-label="刷新视频">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 11a8 8 0 1 0-2.34 5.66"></path>
                  <path d="M20 4v7h-7"></path>
                </svg>
              </button>
            </div>
          </div>

          <div class="mbo-filterbar">
            <div class="mbo-filterbar__title">
              <span>内容漏斗</span>
              <small>官方与搬运分开看</small>
            </div>
            <div class="mbo-filters" role="tablist" aria-label="内容分类">
              ${FILTERS.map((filter) => `
                <button type="button" role="tab" data-filter="${filter.id}" class="${filter.id === 'all' ? 'is-active' : ''}" aria-selected="${filter.id === 'all' ? 'true' : 'false'}">
                  ${filter.label}<span data-filter-count>0</span>
                </button>
              `).join('')}
            </div>
          </div>

          <div class="mbo-grid" data-ref="grid"></div>
          <div class="mbo-state" data-ref="state" hidden></div>

          <footer class="mbo-foot">
            <p>官方区为账号全量投稿；搬运区来自 B 站搜索可见结果，非全站全部。AI/解说/低播放二创默认隐藏，可在弹窗打开“全部包含二创”。</p>
            <p class="mbo-ai-disclaimer">本项目由 AI 辅助制作，可能存在瑕疵。</p>
            <p class="mbo-foot__links">
              <a href="https://space.bilibili.com/1027737427" target="_blank" rel="noopener noreferrer">主频道</a>
              <span aria-hidden="true">·</span>
              <a href="https://space.bilibili.com/3707039702321329" target="_blank" rel="noopener noreferrer">Beast Games</a>
              <span aria-hidden="true">·</span>
              <a href="https://space.bilibili.com/3745034746727465" target="_blank" rel="noopener noreferrer">中国频道</a>
            </p>
          </footer>
        </section>
      </div>
    `;
  }

  function decodeText(value) {
    const raw = String(value ?? '');
    if (!raw) return '';
    const parsed = new DOMParser().parseFromString(raw, 'text/html');
    return (parsed.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeImage(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('//')) return `https:${raw}`;
    return raw.replace(/^http:\/\//i, 'https://');
  }

  function normalizeDuration(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === '0') return '--:--';

    const short = raw.match(/^(\d+):(\d{1,2})$/);
    if (short) return `${short[1]}:${short[2].padStart(2, '0')}`;

    const long = raw.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
    if (long) return `${long[1]}:${long[2].padStart(2, '0')}:${long[3].padStart(2, '0')}`;

    return raw;
  }

  function parseCount(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const digits = String(value ?? '').replace(/[^\d]/g, '');
    return digits ? Number(digits) : 0;
  }

  function formatViews(value) {
    const number = Number(value) || 0;
    if (!number) return '—';
    if (number >= 100000000) {
      return `${trimZero(number / 100000000)}亿`;
    }
    if (number >= 10000) {
      return `${trimZero(number / 10000)}万`;
    }
    return String(number);
  }

  function trimZero(value) {
    return value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
  }

  function formatRelativeDate(unixSeconds) {
    if (!unixSeconds) return '';

    const timestamp = unixSeconds * 1000;
    const diff = Date.now() - timestamp;
    if (diff < 0) return '刚刚';

    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}天前`;

    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  function formatClock(timestamp) {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function makeText(tag, text) {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  }

  function makeActionButton(text, action, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.action = action;
    button.textContent = text;
    return button;
  }

  function makeExternalButton(text, href, className) {
    const link = document.createElement('a');
    link.className = className;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = text;
    return link;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  /* ------------------------------------------------------------------ */
  /* Chrome storage                                                     */
  /* ------------------------------------------------------------------ */

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
        chrome.storage.local.set(value, () => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve(true);
        });
      } catch {
        resolve(false);
      }
    });
  }
})();
