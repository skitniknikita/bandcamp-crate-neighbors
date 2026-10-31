import { parseDocument, DomUtils } from 'htmlparser2';
import type { CollectionPage, CollectorsPage, Fan, ProfilePage, Release } from './types';

type RecordData = Record<string, unknown>;
export type Transport = (url: string, init?: RequestInit) => Promise<string>;

export class BandcampError extends Error {
  constructor(public code: 'unsupported' | 'malformed' | 'access' | 'captcha', message: string) {
    super(message);
    this.name = 'BandcampError';
  }
}

function record(value: unknown): RecordData {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordData : {};
}
function number(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function cursor(value: unknown): string | null {
  const s = text(value);
  return s && s.length < 500 ? s : null;
}
function unique<T>(items: T[], getKey: (item: T) => string | number): T[] {
  return [...new Map(items.map(item => [getKey(item), item])).values()];
}

export function isBandcampUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.port && (url.hostname === 'bandcamp.com' || url.hostname.endsWith('.bandcamp.com'));
  } catch { return false; }
}

export function normalizeProfileUrl(value: string): string {
  let input = value.trim();
  if (/^[a-zA-Z0-9_-]+$/.test(input)) input = 'https://bandcamp.com/' + input;
  if (!isBandcampUrl(input)) throw new BandcampError('unsupported', 'Use an HTTPS Bandcamp profile URL.');
  const url = new URL(input);
  const username = url.pathname.replace(/^\/|\/$/g, '');
  if (url.hostname !== 'bandcamp.com' || !/^[a-zA-Z0-9_-]+$/.test(username) ||
      ['login', 'signup', 'discover', 'search', 'settings', 'help', 'api'].includes(username.toLowerCase())) {
    throw new BandcampError('unsupported', 'Use a Bandcamp fan profile URL, such as https://bandcamp.com/username.');
  }
  return 'https://bandcamp.com/' + username;
}

function releaseUrl(value: unknown, hints: unknown, type: 'a' | 't'): string | undefined {
  const raw = text(value);
  if (isBandcampUrl(raw)) {
    const url = new URL(raw);
    if (/^\/(album|track)\/[^/]+\/?$/.test(url.pathname)) {
      url.search = '';
      url.hash = '';
      return url.toString();
    }
  }
  // Canonical Bandcamp subdomains keep first-version requests inside its permissions.
  const h = record(hints);
  const subdomain = text(h.subdomain);
  const slug = text(h.slug);
  if (/^[a-zA-Z0-9-]+$/.test(subdomain) && /^[a-zA-Z0-9_-]+$/.test(slug)) {
    return 'https://' + subdomain + '.bandcamp.com/' + (type === 'a' ? 'album/' : 'track/') + slug;
  }
  return undefined;
}

function imageUrl(value: unknown): string | undefined {
  const candidate = text(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:' && !url.username && !url.password &&
        (url.hostname === 'bcbits.com' || url.hostname.endsWith('.bcbits.com'))) return url.toString();
  } catch { /* Unsupported external images are not stored. */ }
  return undefined;
}
function artwork(id: unknown): string | undefined {
  const n = number(id);
  return n ? 'https://f4.bcbits.com/img/a' + n + '_16.jpg' : undefined;
}
function photograph(id: unknown): string | undefined {
  const n = number(id);
  return n ? 'https://f4.bcbits.com/img/00' + n + '_50.jpg' : undefined;
}

function identity(value: unknown, fallbackKey?: string): { type: 'a' | 't'; id: number; key: string } | undefined {
  const item = record(value);
  const rawType = text(item.tralbum_type || item.item_type || item.type);
  const type = rawType === 'a' || rawType === 'album' ? 'a'
    : rawType === 't' || rawType === 'track' ? 't'
      : fallbackKey?.startsWith('a') ? 'a' : fallbackKey?.startsWith('t') ? 't' : undefined;
  if (!type) return undefined;
  const id = number(item.tralbum_id) || number(item.item_id) || number(item.id) ||
    number(fallbackKey?.replace(/^[at]:?/, ''));
  return id ? { type, id, key: type + ':' + id } : undefined;
}

function release(value: unknown, fallbackKey?: string): Release | undefined {
  const item = record(value);
  if (item.is_private === true || item.hidden === true) return undefined;
  const identified = identity(item, fallbackKey);
  if (!identified) return undefined;
  const { id, type, key } = identified;
  const title = text(item.item_title || item.title);
  const url = releaseUrl(item.item_url || item.url, item.url_hints, type);
  if (!id || !title || !url) return undefined;
  const added = typeof item.added === 'number' ? item.added * (item.added < 1e12 ? 1000 : 1)
    : Date.parse(text(item.purchased || item.added));
  // Keep only this explicit allowlist. API payloads also contain gift and download data.
  return {
    key, type, id,
    ...(number(item.album_id) ? { albumId: number(item.album_id) } : type === 'a' ? { albumId: id } : {}),
    title,
    artist: text(item.band_name || item.artist) || 'Unknown artist',
    ...(number(item.band_id) ? { artistId: number(item.band_id) } : {}),
    url,
    artUrl: imageUrl(item.item_art_url) || artwork(item.item_art_id || item.art_id),
    ...(Number.isFinite(added) ? { added } : {}),
    ...(item.is_subscription_item === true ? { subscription: true } : {}),
  };
}

function fan(value: unknown, fallbackUrl?: string, total?: unknown): Fan | undefined {
  const item = record(value);
  const id = number(item.fan_id || item.id);
  let url: string;
  try {
    const source = text(item.username)
      ? 'https://bandcamp.com/' + text(item.username)
      : text(item.trackpipe_url || item.fan_url || item.url) || fallbackUrl || '';
    url = normalizeProfileUrl(source);
  } catch { return undefined; }
  if (!id) return undefined;
  const username = new URL(url).pathname.slice(1);
  const photo = record(item.photo);
  return {
    id, username, url, name: text(item.name) || username,
    collectionCount: count(total ?? item.collection_count ?? item.collectionCount),
    photoUrl: imageUrl(item.image_url || photo.url) ||
      photograph(item.image_id || photo.image_id || photo.id),
  };
}

function pageData(html: string, attribute: string): RecordData {
  const dom = parseDocument(html, { decodeEntities: true });
  const node = DomUtils.findOne(el => Object.hasOwn(el.attribs, attribute), dom.children);
  const raw = node?.attribs[attribute];
  if (!raw) {
    if (/captcha|verify you are human|just a moment|challenge-platform/i.test(html)) {
      throw new BandcampError('captcha', 'Bandcamp requires a browser verification. Open Bandcamp, complete it, then resume.');
    }
    if (/<title>[^<]*(log in|sign in)/i.test(html)) {
      throw new BandcampError('access', 'Open Bandcamp and sign in, then resume.');
    }
    throw new BandcampError('malformed', 'Bandcamp page data is unavailable or its format has changed.');
  }
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid data');
    return record(data);
  } catch {
    throw new BandcampError('malformed', 'Bandcamp returned unreadable page data.');
  }
}

function cachedItems(cache: unknown, order: unknown): Release[] {
  const items = record(cache);
  const keys = unique([
    ...(Array.isArray(order) ? order.filter((v): v is string => typeof v === 'string') : []),
    ...Object.keys(items),
  ], key => key);
  return unique(keys.map(key => release(items[key], key)).filter((v): v is Release => Boolean(v)), item => item.key);
}

function initialCollection(data: RecordData, kind: 'collection' | 'wishlist'): CollectionPage {
  const meta = record(data[kind + '_data']);
  const cache = record(record(data.item_cache)[kind]);
  const items = cachedItems(cache, meta.sequence);
  const knownKeys = unique(Object.entries(cache).map(([key, value]) => identity(value, key)?.key)
    .filter((v): v is string => Boolean(v)), key => key);
  const skipped = Object.entries(cache).filter(([key, value]) => !release(value, key)).length;
  const total = count(meta.item_count ?? (kind === 'collection' ? data.collection_count : undefined));
  return { items, knownKeys, skipped, cursor: cursor(meta.last_token), total, more: total > Object.keys(cache).length };
}

function visibleProfileHints(html: string): { totalSharedPurchases?: number; viewerUsername?: string } {
  const dom = parseDocument(html, { decodeEntities: true });
  const sharedCounts: number[] = [];
  for (const node of DomUtils.findAll(el => (el.attribs.class || '').split(/\s+/).includes('genre-wrapper'), dom.children)) {
    let hidden = false;
    for (let ancestor: typeof node | typeof node.parent = node; ancestor; ancestor = ancestor.parent) {
      if ('attribs' in ancestor && (Object.hasOwn(ancestor.attribs, 'hidden') ||
          ancestor.attribs['aria-hidden'] === 'true' || /display\s*:\s*none/i.test(ancestor.attribs.style || ''))) hidden = true;
      if ('name' in ancestor && ['script', 'style', 'template'].includes(ancestor.name)) hidden = true;
    }
    if (hidden) continue;
    const match = DomUtils.textContent(node).match(/(?:^|[^\d.,-])(\d+(?:[, \u00a0\u202f]\d{3})*)\s+items?\s+in\s+common\b/i);
    if (!match) continue;
    const value = Number(match[1].replace(/[, \u00a0\u202f]/g, ''));
    if (Number.isSafeInteger(value) && value >= 0) sharedCounts.push(value);
  }
  // Do not substitute a generic fan-statistics field or a counter from another card.
  const distinctCounts = [...new Set(sharedCounts)];
  const result: { totalSharedPurchases?: number; viewerUsername?: string } =
    distinctCounts.length === 1 ? { totalSharedPurchases: distinctCounts[0] } : {};
  const links = DomUtils.findAll(el => el.name === 'a', dom.children);
  for (const link of links) {
    let inHeader = link.attribs.role === 'menuitem' && Boolean(link.attribs['aria-label']);
    for (let ancestor = link.parent; ancestor; ancestor = ancestor.parent) {
      if (!('attribs' in ancestor)) continue;
      if (['menubar-wrapper', 'user-menu'].includes(ancestor.attribs.id) ||
          (ancestor.attribs.class || '').split(/\s+/).includes('menubar') ||
          ancestor.name === 'header') inHeader = true;
    }
    if (!inHeader || !/^(your )?collection$|^коллекция$/i.test(
      (link.attribs['aria-label'] || DomUtils.textContent(link)).trim())) continue;
    try {
      const url = normalizeProfileUrl(new URL(link.attribs.href || '', 'https://bandcamp.com').toString());
      result.viewerUsername = new URL(url).pathname.slice(1);
      break;
    } catch { /* Other navigation links cannot establish the viewer's identity. */ }
  }
  return result;
}

export function parseProfile(html: string, url: string): ProfilePage {
  const profileUrl = normalizeProfileUrl(url);
  const data = pageData(html, 'data-blob');
  const collection = initialCollection(data, 'collection');
  const wishlist = initialCollection(data, 'wishlist');
  const profile = fan(data.fan_data, profileUrl, collection.total);
  if (!profile || !Object.hasOwn(data, 'collection_data') || !Object.hasOwn(data, 'wishlist_data')) {
    throw new BandcampError('malformed', 'This page does not contain a readable Bandcamp fan collection.');
  }
  const followingMeta = record(data.following_fans_data);
  const followingCache = record(record(data.item_cache).following_fans);
  const followingIds = unique(Object.values(followingCache)
    .map(value => number(record(value).fan_id))
    .filter((v): v is number => Boolean(v)), id => id);
  const currentFan = fan(data.current_fan);
  const viewerFanId = number(record(data.current_fan).fan_id);
  const hints = visibleProfileHints(html);
  const viewerUsername = currentFan?.username || hints.viewerUsername;
  return {
    fan: profile, collection, wishlist, followingIds,
    followingCursor: cursor(followingMeta.last_token),
    followingMore: !Object.hasOwn(data, 'following_fans_data') || count(followingMeta.item_count) > followingIds.length,
    ...(currentFan ? { currentFan } : {}),
    ...(viewerFanId ? { viewerFanId } : {}),
    ...(viewerUsername ? { viewerUsername } : {}),
    ...(hints.totalSharedPurchases !== undefined ? { totalSharedPurchases: hints.totalSharedPurchases } : {}),
  };
}

export function parseReleasePage(html: string, url: string): Release {
  if (!isBandcampUrl(url)) throw new BandcampError('unsupported', 'This version supports bandcamp.com and its subdomains.');
  const data = pageData(html, 'data-tralbum');
  const current = record(data.current);
  const item = release({
    tralbum_id: data.id || current.id,
    tralbum_type: data.item_type || current.type,
    album_id: current.album_id || data.album_id,
    item_title: current.title,
    band_name: data.artist || current.artist,
    band_id: current.band_id,
    item_url: url,
    item_art_id: data.art_id || current.art_id,
    is_subscription_item: data.tralbum_subscriber_only,
  });
  if (!item) throw new BandcampError('malformed', 'This page does not contain a readable Bandcamp album or track.');
  return item;
}

function apiData(value: unknown): RecordData {
  const data = record(value);
  if (data.error) {
    const message = typeof data.error === 'string' ? data.error : 'Bandcamp refused this request.';
    throw new BandcampError(/captcha|challenge/i.test(message) ? 'captcha'
      : /login|sign.?in|permission|auth|access/i.test(message) ? 'access' : 'malformed', message);
  }
  return data;
}

export function parseCollectionResponse(value: unknown): CollectionPage {
  const data = apiData(value);
  if (!Array.isArray(data.items)) throw new BandcampError('malformed', 'Bandcamp returned an invalid collection page.');
  const items = unique(data.items.map(item => release(item)).filter((v): v is Release => Boolean(v)), item => item.key);
  const knownKeys = unique(data.items.map(item => identity(item)?.key).filter((v): v is string => Boolean(v)), key => key);
  const skipped = data.items.filter(item => !release(item)).length;
  const next = cursor(data.last_token);
  const more = data.more_available === true;
  if (more && !next) throw new BandcampError('malformed', 'Bandcamp did not return a continuation cursor.');
  return {
    items, knownKeys, skipped, cursor: next, more,
    ...(data.item_count !== undefined ? { total: count(data.item_count) } : {}),
  };
}

export function parseCollectorsResponse(value: unknown): CollectorsPage {
  const data = apiData(value);
  if (!Array.isArray(data.results)) throw new BandcampError('malformed', 'Bandcamp returned an invalid supporters page.');
  return {
    fans: unique(data.results.map(item => fan(item)).filter((v): v is Fan => Boolean(v)), item => item.id),
    more: data.more_available === true,
  };
}

let transport: Transport = async (url, init) => {
  const response = await fetch(url, { ...init, credentials: 'include' });
  if (!response.ok) throw new BandcampError('access', 'Bandcamp request failed (' + response.status + ').');
  if (response.url && !isBandcampUrl(response.url)) throw new BandcampError('unsupported', 'Bandcamp redirected outside supported domains.');
  return response.text();
};

export function setTransport(next: Transport): void { transport = next; }

async function jsonRequest(url: string, payload: RecordData): Promise<unknown> {
  const response = await transport(url, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  try { return JSON.parse(response) as unknown; }
  catch {
    if (/captcha|just a moment|challenge-platform/i.test(response)) {
      throw new BandcampError('captcha', 'Bandcamp requires a browser verification. Open Bandcamp, complete it, then resume.');
    }
    throw new BandcampError('malformed', 'Bandcamp returned an unreadable API response.');
  }
}

export async function fetchProfile(url: string): Promise<ProfilePage> {
  const normalized = normalizeProfileUrl(url);
  return parseProfile(await transport(normalized, { credentials: 'include' }), normalized);
}

export async function fetchCollectionPage(fanId: number, kind: 'collection' | 'wishlist', olderThan: string | null): Promise<CollectionPage> {
  if (!number(fanId) || !['collection', 'wishlist'].includes(kind)) {
    throw new BandcampError('unsupported', 'Invalid Bandcamp collection request.');
  }
  const value = await jsonRequest('https://bandcamp.com/api/fancollection/1/' + kind + '_items', {
    fan_id: fanId,
    older_than_token: olderThan || String(Math.floor(Date.now() / 1000) + 86400) + ':0:a::',
    count: 20,
  });
  return parseCollectionResponse(value);
}

export async function fetchFollowingPage(fanId: number, olderThan: string | null): Promise<{ ids: number[]; cursor: string | null; more: boolean }> {
  if (!number(fanId)) throw new BandcampError('unsupported', 'Invalid Bandcamp fan ID.');
  const data = apiData(await jsonRequest('https://bandcamp.com/api/fancollection/1/following_fans', {
    fan_id: fanId,
    older_than_token: olderThan || String(Math.floor(Date.now() / 1000) + 86400) + ':0',
    count: 20,
  }));
  // The spelling "followeers" is used by Bandcamp's current first-party endpoint.
  if (!Array.isArray(data.followeers)) throw new BandcampError('malformed', 'Bandcamp returned an invalid following list.');
  const ids = unique(data.followeers.map(item => number(record(item).fan_id))
    .filter((v): v is number => Boolean(v)), id => id);
  const next = cursor(data.last_token);
  const more = data.more_available === true;
  if (more && !next) throw new BandcampError('malformed', 'Bandcamp did not return a following-list cursor.');
  return { ids, cursor: next, more };
}

export async function fetchCollectors(item: Release, excludedIds: number[]): Promise<CollectorsPage> {
  if (!number(item.id) || !['a', 't'].includes(item.type) || !isBandcampUrl(item.url)) {
    throw new BandcampError('unsupported', 'Invalid Bandcamp release.');
  }
  const url = new URL('/api/tralbumcollectors/2/thumbs', item.url).toString();
  return parseCollectorsResponse(await jsonRequest(url, {
    tralbum_type: item.type, tralbum_id: item.id, count: 50, token: null, exclude_gifters: true,
    exclude_fan_ids: unique(excludedIds.filter(id => number(id) !== undefined), id => id),
  }));
}

export async function fetchRelease(url: string): Promise<Release> {
  if (!isBandcampUrl(url) || !/^\/(album|track)\/[^/]+\/?$/.test(new URL(url).pathname)) {
    throw new BandcampError('unsupported', 'Use an album or track URL on bandcamp.com or its subdomains.');
  }
  return parseReleasePage(await transport(url, { credentials: 'include' }), url);
}

export const fetchReleasePage = fetchRelease;
