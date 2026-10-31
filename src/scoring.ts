import type { Candidate, Library, Match, ProfileState, Recommendation, Release } from './types';

function knownKeys(library: Library): Set<string> {
  return new Set([...Object.keys(library.collection), ...Object.keys(library.wishlist), ...(library.collectionKeys || []), ...(library.wishlistKeys || [])]);
}
function knownIn(release: Release, keys: Set<string>): boolean {
  return keys.has(release.key) || (release.type === 't' && !!release.albumId && keys.has('a:' + release.albumId));
}
export function isKnown(release: Release, library: Library): boolean {
  return knownIn(release, knownKeys(library));
}

export function defaultSeeds(library: Library): Release[] {
  const result: Release[] = [];
  const artists = new Set<string>();
  function add(list: Release[], limit: number, diverse: boolean) {
    let added = 0;
    for (const release of list) {
      const artist = String(release.artistId || release.artist.toLowerCase());
      if (result.some(r => r.key === release.key) || (diverse && artists.has(artist))) continue;
      result.push(release);
      artists.add(artist);
      if (++added >= limit) break;
    }
  }
  const order = (items: Record<string, Release>) => Object.values(items).sort((a, b) => (b.added || 0) - (a.added || 0));
  add(order(library.collection), 4, true);
  add(order(library.wishlist).filter(r => !library.collection[r.key]), 2, true);
  if (result.length < 6) add([...order(library.collection), ...order(library.wishlist)], 6 - result.length, false);
  return result;
}

export function scoreCandidate(candidate: Candidate, state: ProfileState, now = Date.now()): Match {
  const items = { ...candidate.items };
  for (const key of candidate.seedKeys) {
    const seed = state.seeds.find(r => r.key === key);
    if (seed) items[key] = seed;
  }
  const releases = Object.values(items);
  const owned = new Set([...Object.keys(state.library.collection), ...(state.library.collectionKeys || [])]);
  const wanted = new Set([...Object.keys(state.library.wishlist), ...(state.library.wishlistKeys || [])]);
  const known = new Set([...owned, ...wanted]);
  const purchases = releases.filter(r => owned.has(r.key));
  const wishlist = releases.filter(r => !owned.has(r.key) && wanted.has(r.key));
  const purchaseCount = candidate.totalSharedPurchases ?? purchases.length;
  const m = purchaseCount + wishlist.length;
  const weighted = purchaseCount + wishlist.length * 0.5;
  const userNorm = Math.sqrt(owned.size + [...wanted].filter(k => !owned.has(k)).length * 0.25);
  const comparedSize = candidate.totalSharedPurchases === undefined ? releases.length : Math.max(releases.length, candidate.fan.collectionCount);
  const score = userNorm && comparedSize ? weighted / (userNorm * Math.sqrt(comparedSize)) * m / (m + 5) : 0;
  const examined = Object.keys(candidate.items).length;
  return {
    fan: candidate.fan, score, purchases, wishlist, examined,
    total: Math.max(candidate.fan.collectionCount, examined),
    complete: candidate.fetched && !candidate.more,
    discoveries: releases.filter(r => !knownIn(r, known) && !state.hiddenReleases.includes(r.key) && !state.seeds.some(seed => seed.key === r.key)).slice(0, 3),
    stale: candidate.checkedAt > 0 && now - candidate.checkedAt >= 86_400_000,
    totalSharedPurchases: candidate.totalSharedPurchases,
  };
}

export function getMatches(state: ProfileState, now = Date.now()): Match[] {
  const followed = new Set(state.library.followingComplete ? state.library.followingIds : []);
  const hidden = new Set(state.hiddenFans);
  return Object.values(state.candidates)
    .filter(c => c.fetched && !c.unavailable && c.fan.id !== state.profile.id && !followed.has(c.fan.id) && !hidden.has(c.fan.id))
    .map(c => scoreCandidate(c, state, now))
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score || (b.purchases.length + b.wishlist.length) - (a.purchases.length + a.wishlist.length) || a.fan.id - b.fan.id);
}

export function getRecommendations(state: ProfileState, matches = getMatches(state)): Recommendation[] {
  if (!state.library.collectionComplete || !state.library.wishlistComplete) return [];
  const releases = new Map<string, Recommendation>();
  const hidden = new Set(state.hiddenReleases);
  const known = knownKeys(state.library);
  for (const match of matches) {
    const candidate = state.candidates[String(match.fan.id)];
    for (const release of Object.values(candidate.items)) {
      if (knownIn(release, known) || hidden.has(release.key) || state.seeds.some(seed => seed.key === release.key)) continue;
      let recommendation = releases.get(release.key);
      if (!recommendation) {
        recommendation = { release, score: 0, fans: [] };
        releases.set(release.key, recommendation);
      }
      if (recommendation.fans.some(f => f.id === match.fan.id)) continue;
      recommendation.score += match.score;
      recommendation.fans.push({ id: match.fan.id, name: match.fan.name, url: match.fan.url });
    }
  }
  const sorted = [...releases.values()].sort((a, b) => b.score - a.score || a.release.key.localeCompare(b.release.key));
  const first: Recommendation[] = [], rest: Recommendation[] = [];
  const artists = new Map<string, number>();
  for (const item of sorted) {
    const artist = String(item.release.artistId || item.release.artist.toLowerCase());
    if (first.length < 20 && (artists.get(artist) || 0) < 2) {
      first.push(item);
      artists.set(artist, (artists.get(artist) || 0) + 1);
    } else rest.push(item);
  }
  // The first page stays diverse even if fewer than twenty distinct options exist.
  return first.length === 20 ? [...first, ...rest] : first;
}
