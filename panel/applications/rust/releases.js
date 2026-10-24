import {assert} from '../../common.js';
import {boundedJSON} from '../../core/release-fetch.js';

export async function rustReleases({fetcher}) {
  const data = await boundedJSON(
    fetcher,
    'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=252490&count=6&maxlength=2000&feeds=steam_community_announcements',
  );
  assert(
    data.appnews?.appid === 252490 && Array.isArray(data.appnews.newsitems),
    'Invalid Steam news response.',
    503,
  );
  return {
    game: 'rust',
    choices: [],
    updateAvailable: null,
    branch: 'public',
    source: 'Valve Steam news API',
    message:
      'Rust uses Steam branch builds. Steam news does not prove which dedicated-server build is installed or available. A SteamCMD build check and a backed-up installation workflow are required before enabling version changes.',
    news: data.appnews.newsitems
      .slice(0, 6)
      .map((item) => ({
        title: String(item.title || '').slice(0, 300),
        text: String(item.contents || '').slice(0, 2000),
        published: Number.isFinite(item.date)
          ? new Date(item.date * 1000).toISOString()
          : null,
        url: /^\d+$/.test(String(item.gid))
          ? 'https://store.steampowered.com/news/app/252490/view/' + item.gid
          : 'https://store.steampowered.com/news/app/252490',
      })),
  };
}
