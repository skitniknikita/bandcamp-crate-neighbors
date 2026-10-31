import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import {
  BandcampError, fetchCollectionPage, fetchCollectors, fetchFollowingPage, fetchProfile, fetchRelease,
  isBandcampUrl, normalizeProfileUrl, parseCollectionResponse, parseCollectorsResponse,
  parseProfile, parseReleasePage, setTransport,
} from '../src/bandcamp';
import type { Release } from '../src/types';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/profile.json', import.meta.url), 'utf8'));
const profileUrl = 'https://bandcamp.com/example_fan';
function markup(data: unknown, attribute = 'data-blob'): string {
  return '<html><head><script id="pagedata" ' + attribute + '="' +
    JSON.stringify(data).replaceAll('&', '&amp;').replaceAll('"', '&quot;') +
    '"></script></head></html>';
}
const item = (id: number, extra: Record<string, unknown> = {}) => ({
  tralbum_id: id, tralbum_type: 'a', item_title: 'Record ' + id, band_name: 'Artist',
  item_url: 'https://artist.bandcamp.com/album/record-' + id, ...extra,
});
const seed: Release = {
  key: 'a:11', type: 'a', id: 11, title: 'Example', artist: 'Artist',
  url: 'https://artist.bandcamp.com/album/example',
};

describe('Bandcamp URL boundaries', () => {
  it('accepts supported HTTPS domains and rejects lookalikes and credential URLs', () => {
    expect(isBandcampUrl('https://bandcamp.com/example')).toBe(true);
    expect(isBandcampUrl('https://artist.bandcamp.com/album/example')).toBe(true);
    for (const url of ['https://bandcamp.com.evil.test/example', 'https://evilbandcamp.com',
      'http://bandcamp.com/example', 'https://name:password@bandcamp.com/example',
      'javascript:alert(1)', 'https://bandcamp.com:8443/example']) {
      expect(isBandcampUrl(url), url).toBe(false);
    }
  });
  it('normalizes pasted profile links without confusing albums with fan profiles', () => {
    expect(normalizeProfileUrl('example_fan')).toBe(profileUrl);
    expect(normalizeProfileUrl(profileUrl + '/?from=discover#collection')).toBe(profileUrl);
    expect(() => normalizeProfileUrl('https://artist.bandcamp.com/album/example')).toThrow(BandcampError);
    expect(() => normalizeProfileUrl('https://bandcamp.com/api')).toThrow(BandcampError);
  });
});

describe('profile HTML adapter', () => {
  it('reads public profile, total coverage, and following IDs from structured data', () => {
    const result = parseProfile(markup(fixture), profileUrl);
    expect(result.fan).toMatchObject({ id: 101, username: 'example_fan', name: 'Example Listener', collectionCount: 3 });
    expect(result.collection.items.map(item => item.key)).toEqual(['a:11', 'a:12']);
    expect(result.collection).toMatchObject({ total: 3, more: true, cursor: '1700000000:12:a::' });
    expect(result.followingIds).toEqual([201, 202]);
    expect(result.followingMore).toBe(false);
    expect(result.currentFan?.id).toBe(101);
  });
  it('keeps preloaded wishlist records even when its visible sequence is empty', () => {
    const result = parseProfile(markup(fixture), profileUrl);
    expect(result.wishlist.items.map(item => item.key)).toEqual(['a:21']);
    expect(result.wishlist).toMatchObject({ total: 2, more: true, cursor: '1690000000:21:a::' });
  });
  it('decodes HTML entities and uses tralbum IDs rather than physical sale item IDs', () => {
    const result = parseProfile(markup(fixture), profileUrl);
    expect(result.collection.items[0]).toMatchObject({ key: 'a:11', title: 'A & B', id: 11, albumId: 11 });
    expect(result.collection.items[0].artUrl).toBe('https://f4.bcbits.com/img/a1001_16.jpg');
  });
  it('does not persist download, payment, gift or arbitrary source fields', () => {
    const result = parseProfile(markup(fixture), profileUrl);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('redownload');
    expect(serialized).not.toContain('purchase_infos');
    expect(serialized).not.toContain('gift_sender');
    expect(serialized).not.toContain('Not retained');
    expect(Object.keys(result.collection.items[0])).toEqual(expect.arrayContaining(['key', 'type', 'id', 'title', 'artist', 'url']));
  });
  it('handles a genuinely empty collection and logged-out current_fan', () => {
    const empty = {
      fan_data: { fan_id: 101, username: 'example_fan' },
      current_fan: { fan_id: null, username: null },
      collection_data: { item_count: 0 },
      wishlist_data: { item_count: 0 },
      following_fans_data: { item_count: 0 },
      item_cache: {},
    };
    const result = parseProfile(markup(empty), profileUrl);
    expect(result.collection).toMatchObject({ items: [], total: 0, more: false, cursor: null });
    expect(result.currentFan).toBeUndefined();
    expect(result.followingIds).toEqual([]);
  });
  it('marks the following list incomplete when only part is cached', () => {
    const partial = structuredClone(fixture);
    partial.following_fans_data.item_count = 30;
    expect(parseProfile(markup(partial), profileUrl).followingMore).toBe(true);
  });
  it('reports incompatible pages and actual verification pages, but permits normal recaptcha configuration', () => {
    expect(() => parseProfile('<html><title>Missing</title></html>', profileUrl)).toThrow(/data is unavailable/);
    expect(() => parseProfile('<title>Just a moment</title>Complete CAPTCHA', profileUrl))
      .toThrow(expect.objectContaining({ code: 'captcha' }));
    expect(() => parseProfile('<title>Log in | Bandcamp</title>', profileUrl))
      .toThrow(expect.objectContaining({ code: 'access' }));
    expect(() => parseProfile(markup({ ...fixture, recaptcha_public_key: 'public-configuration' }), profileUrl)).not.toThrow();
  });
  it('rejects malformed embedded JSON and non-profile data', () => {
    expect(() => parseProfile('<script data-blob="{bad}"></script>', profileUrl)).toThrow(/unreadable/);
    expect(() => parseProfile(markup({ fan_data: { fan_id: 101, username: 'example_fan' } }), profileUrl)).toThrow(/readable/);
  });
});

describe('release and collection adapters', () => {
  it('parses both album and track pages and keeps their IDs distinct', () => {
    const album = parseReleasePage(markup({
      id: 11, item_type: 'album', artist: 'Artist', art_id: 77,
      current: { id: 11, type: 'album', title: 'Record', band_id: 5 },
    }, 'data-tralbum'), seed.url);
    const track = parseReleasePage(markup({
      id: 11, item_type: 'track', artist: 'Artist',
      current: { id: 11, type: 'track', title: 'Track', band_id: 5, album_id: 100 },
    }, 'data-tralbum'), 'https://artist.bandcamp.com/track/example');
    expect(album).toMatchObject({ key: 'a:11', type: 'a', albumId: 11 });
    expect(track).toMatchObject({ key: 't:11', type: 't', albumId: 100 });
  });
  it('deduplicates collection pages and preserves their continuation cursor', () => {
    const result = parseCollectionResponse({ items: [item(11), item(11), item(12)], last_token: 'next:12:a::', more_available: true });
    expect(result.items.map(item => item.key)).toEqual(['a:11', 'a:12']);
    expect(result.cursor).toBe('next:12:a::');
    expect(result.more).toBe(true);
  });
  it('handles the final empty page and rejects broken pagination metadata', () => {
    expect(parseCollectionResponse({ items: [], more_available: false, last_token: null }))
      .toEqual({ items: [], knownKeys: [], skipped: 0, more: false, cursor: null });
    expect(() => parseCollectionResponse({ items: [item(11)], more_available: true })).toThrow(/cursor/);
    expect(() => parseCollectionResponse({ results: [] })).toThrow(/invalid collection/);
  });
  it('canonicalizes custom store URLs using Bandcamp subdomain hints and drops unsafe images', () => {
    const result = parseCollectionResponse({
      items: [item(11, {
        item_url: 'https://custom-store.example/album/example',
        url_hints: { subdomain: 'artist', slug: 'example' },
        item_art_url: 'https://tracking.example/image.png',
      })],
      more_available: false,
    });
    expect(result.items[0].url).toBe(seed.url);
    expect(result.items[0].artUrl).toBeUndefined();
  });
  it('drops inaccessible and unusable entries rather than storing arbitrary URLs', () => {
    const result = parseCollectionResponse({
      items: [item(11, { is_private: true }), item(12, { hidden: true }), item(13, { item_url: 'javascript:alert(1)' }), item(14)],
      more_available: false,
    });
    expect(result.items.map(item => item.key)).toEqual(['a:14']);
    expect(result.knownKeys).toEqual(['a:11', 'a:12', 'a:13', 'a:14']);
    expect(result.skipped).toBe(3);
  });
  it('preserves subscription evidence as metadata', () => {
    expect(parseCollectionResponse({ items: [item(11, { is_subscription_item: true })], more_available: false }).items[0].subscription).toBe(true);
  });
  it('surfaces API errors without treating them as an empty successful page', () => {
    expect(() => parseCollectionResponse({ error: 'login required' })).toThrow(expect.objectContaining({ code: 'access' }));
    expect(() => parseCollectionResponse({ error: 'captcha required' })).toThrow(expect.objectContaining({ code: 'captcha' }));
  });
});

describe('supporters and network adapter', () => {
  it('reads and deduplicates real supporter field names, rejecting external profiles', () => {
    const result = parseCollectorsResponse({
      results: [
        { fan_id: 101, username: 'example_fan', name: 'Example', image_id: 50 },
        { fan_id: 101, url: profileUrl, name: 'Example' },
        { fan_id: 102, url: 'https://external.example/profile' },
      ],
      more_available: true,
    });
    expect(result.fans).toHaveLength(1);
    expect(result.fans[0]).toMatchObject({ id: 101, url: profileUrl });
    expect(result.more).toBe(true);
  });
  it('requests the exact continuation for wishlist, with sanitized API output', async () => {
    const transport = vi.fn(async () => JSON.stringify({ items: [item(21)], last_token: 'last', more_available: false }));
    setTransport(transport);
    await fetchCollectionPage(101, 'wishlist', 'previous:20:a::');
    expect(transport).toHaveBeenCalledOnce();
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://bandcamp.com/api/fancollection/1/wishlist_items');
    expect(JSON.parse(String(init.body))).toEqual({ fan_id: 101, count: 20, older_than_token: 'previous:20:a::' });
  });
  it('reads the first-party following endpoint misspelling and deduplicates IDs', async () => {
    const transport = vi.fn(async () => JSON.stringify({
      followeers: [{ fan_id: 201 }, { fan_id: 201 }, { fan_id: 202 }, { band_id: 5 }],
      more_available: false, last_token: 'following-next',
    }));
    setTransport(transport);
    expect(await fetchFollowingPage(101, 'following-previous'))
      .toEqual({ ids: [201, 202], more: false, cursor: 'following-next' });
  });
  it('requests supporters in batches of fifty from the release origin', async () => {
    const transport = vi.fn(async () => JSON.stringify({ results: [], more_available: false }));
    setTransport(transport);
    await fetchCollectors(seed, [101, 101, -1]);
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://artist.bandcamp.com/api/tralbumcollectors/2/thumbs');
    expect(JSON.parse(String(init.body))).toEqual({
      tralbum_type: 'a', tralbum_id: 11, count: 50, token: null, exclude_gifters: true, exclude_fan_ids: [101],
    });
  });
  it('normalizes profile URLs before requesting and never fetches unsupported domains', async () => {
    const transport = vi.fn(async (_url: string, _init?: RequestInit) => markup(fixture));
    setTransport(transport);
    expect((await fetchProfile(profileUrl + '?from=discover#collection')).fan.id).toBe(101);
    expect(transport.mock.calls[0][0]).toBe(profileUrl);
    await expect(fetchProfile('https://other.example/profile')).rejects.toThrow(BandcampError);
    await expect(fetchRelease('https://custom-store.example/album/example')).rejects.toThrow(BandcampError);
    expect(transport).toHaveBeenCalledOnce();
  });
  it('recognizes HTML challenge responses from JSON endpoints', async () => {
    setTransport(async () => '<title>Just a moment</title>Challenge-platform');
    await expect(fetchCollectionPage(101, 'collection', 'previous'))
      .rejects.toThrow(expect.objectContaining({ code: 'captcha' }));
  });
  it('treats missing following metadata as unknown until the following endpoint is checked', () => {
    const data = structuredClone(fixture);
    delete data.following_fans_data;
    expect(parseProfile(markup(data), profileUrl).followingMore).toBe(true);
  });
  it('retains only IDs for unavailable metadata and does not restart pagination for skipped records', () => {
    const data = structuredClone(fixture);
    data.collection_data.item_count = 2;
    data.item_cache.collection.a11.item_url = 'https://unsupported.example/album/record';
    const result = parseProfile(markup(data), profileUrl);
    expect(result.collection.items.map(item => item.key)).toEqual(['a:12']);
    expect(result.collection.knownKeys).toEqual(['a:11', 'a:12']);
    expect(result.collection.skipped).toBe(1);
    expect(result.collection.more).toBe(false);
  });
});

describe('whole-collection shared-purchase counter', () => {
  it.each([
    ['Electronic, 1 item in common', 1],
    ['Electronic, 27 items in common', 27],
    ['Electronic, 1,234 items in common', 1234],
    ['Electronic, 1\u00a0234 items in common', 1234],
    ['Electronic, 0 items in common', 0],
  ])('parses the visible profile summary: %s', (label, expected) => {
    const result = parseProfile(markup(fixture) + '<ul><li class="genre-wrapper">' + label + '</li></ul>', profileUrl);
    expect(result.totalSharedPurchases).toBe(expected);
    expect(result.viewerFanId).toBe(101);
  });
  it('reads viewer fan ID even when current_fan has no usable username', () => {
    const data = structuredClone(fixture);
    data.current_fan = { fan_id: 999 };
    const result = parseProfile(markup(data) + '<li class="genre-wrapper">Electronic, 2 items in common</li>', profileUrl);
    expect(result.currentFan).toBeUndefined();
    expect(result.viewerFanId).toBe(999);
    expect(result.totalSharedPurchases).toBe(2);
  });
  it('can recover the viewer username only from the signed-in header Collection link', () => {
    const data = structuredClone(fixture);
    data.current_fan = { fan_id: 999 };
    const result = parseProfile(markup(data) +
      '<nav id="menubar-wrapper"><a href="https://bandcamp.com/viewer_name">Collection</a></nav>' +
      '<nav class="collection-tabs"><a href="https://bandcamp.com/wrong_person">Collection</a></nav>', profileUrl);
    expect(result.viewerUsername).toBe('viewer_name');
    expect(result.viewerFanId).toBe(999);
  });
  it('does not mistake unrelated cards or fan statistics for the profile summary', () => {
    const data = { ...fixture, fan_stats: { num_items_in_common: 99 } };
    const result = parseProfile(markup(data) +
      '<div class="fan-num-in-common">99 items in common</div>' +
      '<div class="bio">37 items in common</div>', profileUrl);
    expect(result.totalSharedPurchases).toBeUndefined();
  });
  it('does not turn a missing guest counter into zero', () => {
    const data = structuredClone(fixture);
    data.current_fan = { fan_id: null, username: null };
    const result = parseProfile(markup(data), profileUrl);
    expect(result.viewerFanId).toBeUndefined();
    expect(result.viewerUsername).toBeUndefined();
    expect(result.totalSharedPurchases).toBeUndefined();
  });
  it('ignores hidden, ambiguous and malformed summary counters', () => {
    for (const summary of [
      '<li class="genre-wrapper" hidden>9 items in common</li>',
      '<div style="display:none"><li class="genre-wrapper">9 items in common</li></div>',
      '<li class="genre-wrapper">1.5 items in common</li>',
      '<li class="genre-wrapper">1 item in common</li><li class="genre-wrapper">2 items in common</li>',
    ]) expect(parseProfile(markup(fixture) + summary, profileUrl).totalSharedPurchases).toBeUndefined();
  });
  it('retains only counter and viewer identity, not the raw page or account details', () => {
    const data = { ...fixture, current_fan: { fan_id: 999, account_info: 'private-source-data' } };
    const result = parseProfile(markup(data) + '<li class="genre-wrapper">4 items in common</li>', profileUrl);
    expect(result.viewerFanId).toBe(999);
    expect(result.totalSharedPurchases).toBe(4);
    expect(JSON.stringify(result)).not.toContain('private-source-data');
    expect(JSON.stringify(result)).not.toContain('genre-wrapper');
  });
});
