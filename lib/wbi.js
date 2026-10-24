/*
 * Bilibili WBI signing + official uploads loader.
 * Requires lib/md5.js loaded first (window.MBO_MD5).
 * Exposes window.MBO_WBI.
 */
(() => {
  'use strict';

  const MIXIN_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
  ];

  const DM_IMG_STR = 'V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ';
  const DM_COVER_IMG_STR = 'QU5HTEUgKE5WSURJQSwgTlZJRElBIEdlRm9yY2UgUlRYIDQwNjAgTG';
  const DM_IMG_INTER = '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}';

  let keyCache = null;
  let keyCacheAt = 0;

  async function getWbiKeys() {
    if (keyCache && Date.now() - keyCacheAt < 10 * 60 * 1000) return keyCache;

    const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`nav HTTP ${response.status}`);

    const payload = await response.json();
    const imgUrl = payload?.data?.wbi_img?.img_url;
    const subUrl = payload?.data?.wbi_img?.sub_url;
    if (!imgUrl || !subUrl) throw new Error('missing WBI keys');

    keyCache = {
      imgKey: imgUrl.split('/').pop().split('.')[0],
      subKey: subUrl.split('/').pop().split('.')[0],
    };
    keyCacheAt = Date.now();
    return keyCache;
  }

  function mixinKey(imgKey, subKey) {
    const source = imgKey + subKey;
    return MIXIN_TAB.map((index) => source[index]).join('').slice(0, 32);
  }

  function signParams(params, imgKey, subKey) {
    const wts = Math.round(Date.now() / 1000);
    const all = { ...params, wts: String(wts) };
    const query = Object.keys(all)
      .sort()
      .map((key) => {
        const value = String(all[key]).replace(/[!'()*]/g, '');
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      })
      .join('&');

    const wRid = globalThis.MBO_MD5(query + mixinKey(imgKey, subKey));
    return `${query}&w_rid=${wRid}`;
  }

  async function fetchOfficialVideos(mid, { pageSize = 50, maxPages = 10 } = {}) {
    const keys = await getWbiKeys();
    const videos = [];
    let total = 0;

    for (let page = 1; page <= maxPages; page += 1) {
      const params = {
        mid: String(mid),
        ps: String(pageSize),
        pn: String(page),
        order: 'pubdate',
        platform: 'web',
        web_location: '333.1387',
        dm_img_list: '[]',
        dm_img_str: DM_IMG_STR,
        dm_cover_img_str: DM_COVER_IMG_STR,
        dm_img_inter: DM_IMG_INTER,
      };

      let payload = null;
      let currentKeys = keys;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const query = signParams(params, currentKeys.imgKey, currentKeys.subKey);
        const response = await fetch(
          `https://api.bilibili.com/x/space/wbi/arc/search?${query}`,
          {
            credentials: 'include',
            cache: 'no-store',
            headers: { Accept: 'application/json, text/plain, */*' },
          }
        );

        if (response.status === 412) {
          keyCache = null;
          await new Promise((resolve) => setTimeout(resolve, 700 + attempt * 500));
          currentKeys = await getWbiKeys();
          continue;
        }

        if (!response.ok) throw new Error(`space HTTP ${response.status}`);
        const body = await response.json();

        if (body?.code === 0) {
          payload = body;
          break;
        }

        if (body?.code === -352 || body?.code === -412) {
          keyCache = null;
          await new Promise((resolve) => setTimeout(resolve, 700 + attempt * 500));
          currentKeys = await getWbiKeys();
          continue;
        }

        throw new Error(`space API code ${body?.code}`);
      }

      if (!payload) throw new Error('space API risk control');

      const list = payload?.data?.list?.vlist || [];
      total = Number(payload?.data?.page?.count) || total;

      for (const item of list) {
        if (item?.bvid) videos.push(item);
      }

      if (!list.length || videos.length >= total) break;
      await new Promise((resolve) => setTimeout(resolve, 280));
    }

    return {
      videos,
      total: total || videos.length,
    };
  }

  globalThis.MBO_WBI = {
    getWbiKeys,
    signParams,
    fetchOfficialVideos,
  };
})();
