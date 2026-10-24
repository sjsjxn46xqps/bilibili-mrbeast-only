/*
 * MrBeast-scoped search results page for search.bilibili.com.
 * Keeps Bilibili's header/search bar, pins the official account, and renders
 * only official + reposted MrBeast content.
 */
(() => {
  'use strict';

  const ROOT_ID = 'mbo-root';
  const PREF_KEY = 'mrbeast:enabled';
  const SECONDARY_KEY = 'mrbeast:includeSecondary';
  const SECONDARY_ALL_KEY = 'mrbeast:secondaryAll';
  const MODE_CLASS = 'mbo-s-mode';
  const READY_CLASS = 'mbo-s-ready';
  const CACHE_PREFIX = 'mrbeast:search:v6:';
  const CACHE_TTL = 15 * 60 * 1000;
  const REQUEST_GAP = 400;
  const REQUEST_TIMEOUT = 12000;
  const MIN_REPOST_PLAY = 1000;

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
    rawQuery: '',
    baseQuery: '',
    items: [],
    filter: 'all',
    sort: 'new',
    phase: 'idle',
    fetching: false,
    pendingRefresh: false,
    note: '',
    lastSync: 0,
    requestToken: 0,
    root: null,
    boundRoot: null,
    booted: false,
    accountFetched: false,
    account: {
      name: '野兽先生MrBeast',
      face: '',
      fans: '968.4万',
      videos: '122',
      sign: 'MrBeast 官方账号 · 挑战、实验和疯狂奖金',
      space: 'https://space.bilibili.com/1027737427',
    },
  };

  const docEl = document.documentElement;

  init();

  async function init() {
    if (!isSearchPage()) return;

    const stored = await storageGet({ [PREF_KEY]: true, [SECONDARY_KEY]: false, [SECONDARY_ALL_KEY]: false });
    state.enabled = stored[PREF_KEY] !== false;
    state.includeSecondary = stored[SECONDARY_KEY] === true;
    state.includeAllKeyword = stored[SECONDARY_ALL_KEY] === true;

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'MRBEAST_GET_STATE') {
        sendResponse({
          active: state.enabled && isSearchPage(),
          enabled: state.enabled,
          home: false,
          search: isSearchPage(),
          phase: state.phase,
          count: state.items.length,
        });
        return;
      }

      if (message?.type === 'MRBEAST_REFRESH' && state.enabled) {
        loadAll({ force: true });
      }

      if (message?.type === 'MRBEAST_SET_ENABLED') {
        state.enabled = message.enabled !== false;
        applyEnabled();
        sendResponse({ ok: true, enabled: state.enabled, search: isSearchPage() });
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      if (changes[PREF_KEY]) {
        state.enabled = changes[PREF_KEY].newValue !== false;
        applyEnabled();
      }

      if (changes[SECONDARY_KEY]) {
        state.includeSecondary = changes[SECONDARY_KEY].newValue === true;
        if (state.enabled) render();
      }

      if (changes[SECONDARY_ALL_KEY]) {
        state.includeAllKeyword = changes[SECONDARY_ALL_KEY].newValue === true;
        if (state.enabled) render();
      }
    });

    if (!state.enabled) return;

    state.rawQuery = readRawQuery();
    state.baseQuery = extractBaseQuery(state.rawQuery);

    ensureRoot();
    observeDocument();

    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('pageshow', () => {
      ensureRoot();
    });

    let lastHref = location.href;
    window.setInterval(() => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      handleRouteChange();
    }, 800);
  }

  function applyEnabled() {
    if (state.enabled && isSearchPage()) {
      state.rawQuery = readRawQuery();
      state.baseQuery = extractBaseQuery(state.rawQuery);
      ensureRoot();
    } else {
      teardown();
    }
  }

  function isSearchPage() {
    return /^\/(all|video)\/?$/.test(location.pathname);
  }

  /* ------------------------------------------------------------------ */
  /* DOM lifecycle                                                      */
  /* ------------------------------------------------------------------ */

  function ensureRoot() {
    if (!state.enabled || !isSearchPage()) {
      teardown();
      return;
    }

    const content = document.querySelector('.search-content');
    if (!content) {
      window.setTimeout(ensureRoot, 250);
      return;
    }

    const nativeAccount = readNativeAccount();
    if (nativeAccount) mergeAccount(nativeAccount);

    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('section');
      root.id = ROOT_ID;
      root.className = 'mbo mbo--search';
      root.setAttribute('aria-label', '野兽先生搜索结果');
      root.innerHTML = shellHTML();

      const wrapper = content.querySelector('.search-page-wrapper');
      if (wrapper) content.insertBefore(root, wrapper);
      else content.prepend(root);
    } else if (root.parentElement !== content) {
      const wrapper = content.querySelector('.search-page-wrapper');
      if (wrapper) content.insertBefore(root, wrapper);
      else content.prepend(root);
    }

    state.root = root;

    if (state.boundRoot !== root) {
      bindRoot(root);
      state.boundRoot = root;
    }

    if (!state.booted) {
      state.booted = true;
      hydrateRoot();
      loadAccountData();
    } else {
      render();
    }

    content.classList.add('mbo-s-host');
    docEl.classList.add(MODE_CLASS);

    renderHeader();
    renderAccount();

    window.requestAnimationFrame(() => {
      if (state.root?.isConnected) docEl.classList.add(READY_CLASS);
    });
  }

  function teardown() {
    state.requestToken += 1;
    state.fetching = false;
    docEl.classList.remove(MODE_CLASS, READY_CLASS);
    for (const host of document.querySelectorAll('.mbo-s-host')) {
      host.classList.remove('mbo-s-host');
    }
    if (state.root) {
      state.root.remove();
      state.root = null;
    }
    const leftover = document.getElementById(ROOT_ID);
    if (leftover) leftover.remove();
    state.booted = false;
    state.boundRoot = null;
  }

  function observeDocument() {
    const attach = () => {
      if (!document.body) {
        window.setTimeout(attach, 50);
        return;
      }

      let timer = 0;
      const observer = new MutationObserver(() => {
        if (!isSearchPage()) return;
        if (state.root?.isConnected) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(ensureRoot, 220);
      });

      observer.observe(document.body, { childList: true, subtree: true });
    };

    attach();
  }

  function handleRouteChange() {
    if (!isSearchPage()) {
      teardown();
      return;
    }

    const raw = readRawQuery();
    if (raw === state.rawQuery) return;

    state.rawQuery = raw;
    state.baseQuery = extractBaseQuery(raw);
    state.items = [];
    state.phase = 'loading';
    state.note = '';
    state.requestToken += 1;
    state.fetching = false;
    renderHeader();
    render();
    loadAll({ force: true });
  }

  /* ------------------------------------------------------------------ */
  /* Account card                                                       */
  /* ------------------------------------------------------------------ */

  function readNativeAccount() {
    const card = document.querySelector('.user-list .b-user-video-card');
    if (!card) return null;

    const description = card.querySelector('.user-video-desc')?.textContent || '';
    const fans = description.match(/([\d.]+\s*万?)\s*粉丝/)?.[1] || '';
    const videos = description.match(/(\d+)\s*个视频/)?.[1] || '';
    const name = card.querySelector('.user-name')?.textContent?.trim() || '';

    let face = '';
    const avatar = card.querySelector('.search-user-avatar .avatar-inner')
      || card.querySelector('.search-user-avatar');
    if (avatar) {
      const background = window.getComputedStyle(avatar).backgroundImage || '';
      const match = background.match(/url\(["']?(.+?)["']?\)/);
      if (match) face = match[1];
    }

    if (!name && !face && !fans) return null;
    if (face.startsWith('//')) face = `https:${face}`;
    if (face.startsWith('http://')) face = face.replace(/^http:\/\//, 'https://');

    return {
      name: name || state.account.name,
      face,
      fans,
      videos,
      sign: state.account.sign,
    };
  }

  async function loadAccountData() {
    if (state.accountFetched) return;
    state.accountFetched = true;

    try {
      const [info, stat] = await Promise.all([
        fetchJson('https://api.bilibili.com/x/space/acc/info?mid=1027737427'),
        fetchJson('https://api.bilibili.com/x/relation/stat?vmid=1027737427'),
      ]);

      if (info?.code === 0 && info.data) {
        const data = info.data;
        state.account = {
          ...state.account,
          name: data.name || state.account.name,
          face: normalizeImage(data.face) || state.account.face,
          sign: data.sign || state.account.sign,
        };
      }

      if (stat?.code === 0 && stat.data?.follower != null) {
        state.account.fans = formatFans(stat.data.follower);
      }

      renderAccount();
    } catch (error) {
      console.warn('[MrBeast Search] account info failed:', error);
    }

    // The native account card may hydrate later than our root.
    window.setTimeout(() => {
      const native = readNativeAccount();
      if (!native) return;
      mergeAccount(native);
      renderAccount();
    }, 1200);
  }

  function mergeAccount(data) {
    for (const [key, value] of Object.entries(data)) {
      if (value) state.account[key] = value;
    }
  }

  function renderAccount() {
    const root = state.root;
    if (!root) return;

    const name = root.querySelector('[data-ref="account-name"]');
    const sign = root.querySelector('[data-ref="account-sign"]');
    const fans = root.querySelector('[data-ref="account-fans"]');
    const videos = root.querySelector('[data-ref="account-videos"]');
    const avatar = root.querySelector('[data-ref="account-avatar"]');

    if (name) name.textContent = state.account.name;
    if (sign) sign.textContent = state.account.sign;
    if (fans) fans.textContent = state.account.fans ? `${state.account.fans} 粉丝` : '官方认证账号';
    if (videos) videos.textContent = state.account.videos ? `${state.account.videos} 个视频` : 'MrBeast 主频道';
    if (avatar) {
      avatar.src = state.account.face || chrome.runtime.getURL('icons/icon128.png');
      avatar.alt = state.account.name;
      avatar.onerror = () => {
        avatar.onerror = null;
        avatar.src = chrome.runtime.getURL('icons/icon128.png');
      };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Data                                                               */
  /* ------------------------------------------------------------------ */

  async function hydrateRoot() {
    if (state.booted && state.items.length) {
      render();
      return;
    }

    state.phase = 'loading';
    render();

    const base = state.baseQuery;
    const cacheKey = cacheKeyFor(base);
    const cached = await storageGet({ [cacheKey]: null });
    const snapshot = cached[cacheKey];

    if (snapshot && Array.isArray(snapshot.items)) {
      const items = snapshot.items.filter(isValidItem);
      if (items.length) {
        state.items = items;
        state.lastSync = Number(snapshot.savedAt) || 0;
        state.phase = 'ready';
        render();
      }
    }

    if (!snapshot || !state.lastSync || Date.now() - state.lastSync > CACHE_TTL) {
      loadAll();
    }
  }

  async function loadAll({ force = false } = {}) {
    if (!isSearchPage()) return;
    if (state.fetching) {
      state.pendingRefresh = true;
      return;
    }
    if (!force && state.lastSync && Date.now() - state.lastSync < 12000) return;

    const token = ++state.requestToken;
    state.fetching = true;
    state.phase = state.items.length ? 'refreshing' : 'loading';
    state.note = '';
    render();

    try {
      const result = await fetchAll(token);
      if (token !== state.requestToken) return;

      state.items = mergeItems(state.items, result.items);
      state.lastSync = Date.now();
      state.phase = 'ready';
      state.note = result.note || (result.failed > 0 ? '部分搜索请求失败，已显示其余结果。' : '');

      await storageSet({
        [cacheKeyFor(state.baseQuery)]: {
          savedAt: state.lastSync,
          items: state.items,
        },
      });
    } catch (error) {
      console.warn('[MrBeast Search] request failed:', error);
      if (token !== state.requestToken) return;

      if (state.items.length) {
        state.phase = 'ready';
        state.note = '刷新失败，已显示上次缓存的结果。';
      } else {
        state.phase = 'error';
        state.note = '没有连上 B 站搜索接口，请稍后重试。';
      }
    } finally {
      if (token === state.requestToken) {
        state.fetching = false;
        render();

        if (state.pendingRefresh) {
          state.pendingRefresh = false;
          if (isSearchPage()) loadAll({ force: true });
        }
      }
    }
  }

  async function fetchAll(token) {
    const merged = new Map();
    let failed = 0;
    let total = 0;

    for (const query of buildQueries()) {
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
          console.warn(`[MrBeast Search] ${query.keyword} page ${page} failed:`, error);
        }

        if (page < query.pages) await sleep(REQUEST_GAP);
      }
      await sleep(REQUEST_GAP);
    }

    if (total > 0 && failed === total) throw new Error('all search requests failed');

    const allItems = Array.from(merged.values());
    const matched = state.baseQuery
      ? allItems.filter((item) => queryMatches(item, state.baseQuery))
      : allItems;

    return {
      items: matched.length ? matched : allItems,
      failed,
      note: state.baseQuery && !matched.length && allItems.length
        ? `没有找到同时包含“${state.baseQuery}”的结果，先展示相关的野兽先生内容。`
        : '',
    };
  }

  function buildQueries() {
    const base = state.baseQuery;
    const suffix = base ? ` ${base}` : '';

    if (base) {
      return [
        { keyword: `野兽先生${suffix}`, pages: 3 },
        { keyword: `MrBeast${suffix}`, pages: 3 },
      ];
    }

    return [
      { keyword: '野兽先生', pages: 3 },
      { keyword: 'MrBeast', pages: 2 },
      { keyword: '野兽游戏', pages: 2 },
    ];
  }

  function queryMatches(item, base) {
    if (!base) return true;

    const haystack = normalizeText(`${item.title} ${item.description} ${item.tag} ${item.author}`);
    const needle = normalizeText(base);
    if (!needle) return true;
    if (haystack.includes(needle)) return true;

    const tokens = needle.split(/\s+/).filter((token) => token.length > 1);
    return tokens.some((token) => haystack.includes(token));
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

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json, text/plain, */*' },
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
    return (title.match(/[\u3400-\u9fff]/g) || []).length >= 2;
  }

  function isValidItem(item) {
    if (!item || typeof item.bvid !== 'string' || !/^BV[0-9A-Za-z]+$/.test(item.bvid)) return false;
    if (typeof item.title !== 'string' || !CATEGORY[item.category]) return false;
    if (item.category === 'official') return OFFICIAL.has(String(item.mid));
    return Boolean(item.mid && item.author);
  }

  function mergeItems(...lists) {
    const map = new Map();
    for (const list of lists) {
      for (const item of list) {
        if (!isValidItem(item)) continue;
        const previous = map.get(item.bvid);
        if (!previous || item.category === 'official') map.set(item.bvid, item);
      }
    }
    return Array.from(map.values());
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                          */
  /* ------------------------------------------------------------------ */

  function render() {
    if (!state.root) return;

    state.root.classList.toggle('is-fetching', state.fetching);
    state.root.dataset.phase = state.phase;

    const visibleItems = state.items.filter((item) => state.includeSecondary || item.category !== 'secondary');
    const filtered = state.filter === 'all'
      ? visibleItems
      : visibleItems.filter((item) => item.category === state.filter);
    const fullMode = state.filter === 'all' && state.includeSecondary && state.includeAllKeyword;
    const sorted = sortItems(filtered, state.filter === 'all', fullMode);
    const counts = countItems(visibleItems);

    const grid = state.root.querySelector('[data-ref="grid"]');
    const box = state.root.querySelector('[data-ref="state"]');
    const count = state.root.querySelector('[data-ref="result-count"]');

    if (!grid || !box) return;

    if (count) {
      count.textContent = visibleItems.length
        ? `找到 ${visibleItems.length} 条野兽先生相关内容${counts.secondary ? `（含 ${counts.secondary} 条二创/其他）` : ''}`
        : state.phase === 'loading'
          ? '正在搜索野兽先生相关内容…'
          : '暂无结果';
    }

    grid.replaceChildren();

    if (!sorted.length) {
      if (state.phase === 'loading' || state.phase === 'refreshing' || state.phase === 'idle') {
        renderSkeleton(grid, 8);
      }
    } else {
      for (const item of sorted) grid.appendChild(renderCard(item));
    }

    renderStateBox(box, sorted.length);
    updateFilterButtons(counts);
    updateSortButtons();
  }

  function renderSkeleton(grid, count) {
    for (let index = 0; index < count; index += 1) {
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
        makeText('strong', '搜索暂时不可用'),
        makeText('p', state.note || '请稍后再试一次。'),
        makeActionButton('重新搜索', 'retry', 'mbo-btn mbo-btn--primary')
      );
      return;
    }

    if (!visibleCount && state.items.length) {
      box.className = 'mbo-state';
      box.append(
        makeText('strong', '这个分类暂时没有内容'),
        makeText('p', '换一个分类，或回到“全部”查看所有结果。'),
        makeActionButton('查看全部', 'show-all', 'mbo-btn mbo-btn--primary')
      );
      return;
    }

    if (!visibleCount) {
      box.className = 'mbo-state';
      box.append(
        makeText('strong', '没有找到相关视频'),
        makeText('p', '试试更短的关键词，或者直接去官方空间查看。'),
        makeExternalButton('打开官方空间', state.account.space, 'mbo-btn mbo-btn--primary')
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

  function updateFilterButtons(counts) {
    const root = state.root;
    if (!root) return;

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

  function updateSortButtons() {
    const root = state.root;
    if (!root) return;

    for (const button of root.querySelectorAll('[data-sort]')) {
      const active = button.dataset.sort === state.sort;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }

  function renderHeader() {
    const root = state.root;
    if (!root) return;

    const query = state.baseQuery;
    const queryLine = root.querySelector('[data-ref="query-line"]');
    if (queryLine) {
      queryLine.textContent = query
        ? `“${query}” · 只显示野兽先生相关视频`
        : '全部野兽先生内容 · 官方与搬运';
    }

    const input = document.querySelector('.search-input-el');
    if (input instanceof HTMLInputElement) {
      input.value = state.rawQuery || query;
      input.placeholder = query ? `在野兽先生内容中搜索“${query}”` : '搜索野兽先生相关内容';
    }

    document.title = query
      ? `${query} - 野兽先生 - 哔哩哔哩`
      : '野兽先生 - 哔哩哔哩搜索';
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

    return { all: items.length, official, translated, raw, secondary };
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

    return items.filter((item) => item.category !== 'secondary').sort(sorter)
      .concat(items.filter((item) => item.category === 'secondary').sort(sorter));
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
        loadAll({ force: true });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */

  function shellHTML() {
    return `
      <div class="mbo-shell mbo-s-shell">
        <header class="mbo-s-head">
          <div class="mbo-s-head__copy">
            <div class="mbo-eyebrow"><span class="mbo-eyebrow__dot"></span>BILIBILI · MRBEAST SEARCH</div>
            <h1>搜到的只有<span>野兽先生</span></h1>
            <p data-ref="query-line">全部野兽先生内容 · 官方与搬运</p>
          </div>
          <div class="mbo-s-head__mark" aria-hidden="true">MB</div>
        </header>

        <section class="mbo-s-account" aria-label="野兽先生官方账号">
          <div class="mbo-s-account__avatar">
            <img data-ref="account-avatar" src="${chrome.runtime.getURL('icons/icon128.png')}" alt="野兽先生MrBeast">
          </div>
          <div class="mbo-s-account__copy">
            <div class="mbo-s-account__name">
              <strong data-ref="account-name">野兽先生MrBeast</strong>
              <span class="mbo-s-verified">
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2.4 14.6 5l3.6-.3.9 3.5 2.9 2.2-1.7 3.2 1.7 3.2-2.9 2.2-.9 3.5-3.6-.3L12 21.6 9.4 19l-3.6.3-.9-3.5-2.9-2.2 1.7-3.2-1.7-3.2 2.9-2.2.9-3.5 3.6.3L12 2.4Zm-1.2 12.9 5-5-1.4-1.4-3.6 3.6-1.7-1.7-1.4 1.4 3.1 3.1Z"/></svg>
                官方
              </span>
            </div>
            <p class="mbo-s-account__sign" data-ref="account-sign">MrBeast 官方账号 · 挑战、实验和疯狂奖金</p>
            <div class="mbo-s-account__stats">
              <span data-ref="account-fans">官方认证账号</span>
              <span data-ref="account-videos">MrBeast 主频道</span>
            </div>
          </div>
          <a class="mbo-s-account__link" href="https://space.bilibili.com/1027737427" target="_blank" rel="noopener noreferrer">
            查看官方主页 <span aria-hidden="true">↗</span>
          </a>
        </section>

        <section class="mbo-feed mbo-s-results" aria-label="相关视频">
          <div class="mbo-feed__head">
            <div>
              <h2>相关视频</h2>
              <p data-ref="result-count">正在搜索野兽先生相关内容…</p>
            </div>
            <div class="mbo-toolbar">
              <div class="mbo-seg" role="tablist" aria-label="排序方式">
                <button type="button" role="tab" data-sort="new" class="is-active" aria-selected="true">最新</button>
                <button type="button" role="tab" data-sort="hot" aria-selected="false">最热</button>
              </div>
              <button type="button" class="mbo-icon-btn" data-action="refresh" title="刷新搜索结果" aria-label="刷新搜索结果">
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
            <p>搜索结果只保留野兽先生官方与搬运内容；搬运分类按标题、字幕标记判断翻译状态。</p>
            <p class="mbo-ai-disclaimer">本项目由 AI 辅助制作，可能存在瑕疵。</p>
            <p class="mbo-foot__links">
              <a href="https://space.bilibili.com/1027737427" target="_blank" rel="noopener noreferrer">官方主频道</a>
              <span aria-hidden="true">·</span>
              <a href="https://space.bilibili.com/3707039702321329" target="_blank" rel="noopener noreferrer">Beast Games</a>
            </p>
          </footer>
        </section>
      </div>
    `;
  }

  function readRawQuery() {
    return (new URLSearchParams(location.search).get('keyword') || '').trim();
  }

  function extractBaseQuery(raw) {
    return String(raw || '')
      .replace(/^\s*(?:野兽先生|野獸先生|mr\s*beast|mrbeast|beast\s*games)\s*[:：,，\-–]?\s*/i, '')
      .trim();
  }

  function cacheKeyFor(base) {
    return `${CACHE_PREFIX}${base ? encodeURIComponent(base).slice(0, 100) : '__all__'}`;
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
    if (number >= 100000000) return `${trimZero(number / 100000000)}亿`;
    if (number >= 10000) return `${trimZero(number / 10000)}万`;
    return String(number);
  }

  function formatFans(number) {
    const value = Number(number) || 0;
    if (!value) return '';
    if (value >= 10000) return `${trimZero(value / 10000)}万`;
    return String(value);
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
