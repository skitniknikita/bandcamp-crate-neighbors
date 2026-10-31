import { describe, it, expect, vi } from 'vitest';
import { Engine, createState, type BandcampClient } from '../src/engine';
import { RequestError } from '../src/network';
import { fan, release, MemoryRepository } from './helpers';
import type { ProfilePage } from '../src/types';
function profile(id: number, more = false): ProfilePage {
  return {
    fan: fan(id, more ? 40 : 2),
    collection: { items: [release(1), release(id + 10)], cursor: more ? 'page-2' : null, more, total: more ? 40 : 2 },
    wishlist: { items: [release(2)], cursor: null, more: false, total: 1 },
    followingIds: [], followingCursor: null, followingMore: false,
  };
}
function setup() {
  const repo = new MemoryRepository();
  const client: BandcampClient = {
    fetchProfile: vi.fn(async url => profile(Number(url.match(/\d+$/)?.[0]) || 1)),
    fetchCollectionPage: vi.fn(async () => ({ items: [release(3)], cursor: null, more: false })),
    fetchFollowingPage: vi.fn(async () => ({ ids: [99], cursor: null, more: false })),
    fetchCollectors: vi.fn(async () => ({ fans: [fan(2), fan(3)], more: false })),
  };
  const engine = new Engine(repo, client, () => 100_000_000);
  return { repo, client, engine };
}
async function drain(engine: Engine, max = 40) {
  for (let i = 0; i < max; i++) if (!await engine.step()) return;
  throw new Error('Queue did not settle');
}
describe('persistent scan engine', () => {
  it('connects, reads both taste sources and accumulates deduplicated evidence across seeds', async () => {
    const { engine, repo } = setup();
    await engine.connect(fan(1).url);
    await engine.command({ type: 'start-search' });
    await drain(engine);
    const state = (await repo.active())!;
    expect(Object.keys(state.candidates)).toEqual(['2', '3']);
    expect(state.candidates[2].seedKeys).toHaveLength(3);
    const snapshot = await engine.snapshot('en');
    expect(snapshot.matches).toHaveLength(2);
    expect(snapshot.recommendations.map(r => r.release.id)).toContain(12);
    expect(snapshot.recommendations.some(r => r.release.id === 1 || r.release.id === 2)).toBe(false);
    expect(state.phase).toBe('done');
  });
  it('deduplicates collection pages and keeps wishlist paging independent', async () => {
    const { engine, repo, client } = setup();
    vi.mocked(client.fetchProfile).mockResolvedValue({ ...profile(1, true), wishlist: { items: [release(2)], cursor: 'w2', more: true, total: 2 } });
    vi.mocked(client.fetchCollectionPage).mockImplementation(async (_id, kind) => ({ items: kind === 'collection' ? [release(1), release(3)] : [release(2), release(4)], cursor: null, more: false }));
    await engine.connect(fan(1).url);
    await expect(engine.command({ type: 'start-search' })).rejects.toThrow('sync');
    await drain(engine);
    const state = (await repo.active())!;
    expect(Object.keys(state.library.collection)).toHaveLength(3);
    expect(Object.keys(state.library.wishlist)).toHaveLength(2);
    expect(state.library.collectionComplete && state.library.wishlistComplete).toBe(true);
  });
  it('pauses and recovers a running worker job without losing its cursor', async () => {
    const { engine, repo, client } = setup();
    vi.mocked(client.fetchProfile).mockResolvedValue(profile(1, true));
    await engine.connect(fan(1).url);
    const state = (await repo.active())!;
    state.jobs[0].status = 'running';
    await repo.save(state);
    await engine.recover();
    expect((await repo.active())!.jobs[0]).toMatchObject({ status: 'queued', cursor: 'page-2' });
    await engine.command({ type: 'pause' });
    expect(await engine.step()).toBe(false);
    expect(client.fetchCollectionPage).not.toHaveBeenCalled();
    await engine.command({ type: 'resume' });
    await drain(engine);
    expect(client.fetchCollectionPage).toHaveBeenCalledWith(1, 'collection', 'page-2');
  });
  it('preserves a rate-limit deadline even when the user presses resume', async () => {
    const { engine, repo, client } = setup();
    await engine.connect(fan(1).url);
    vi.mocked(client.fetchCollectors).mockRejectedValue(new RequestError('Slow down', 'rate-limit', 100_060_000));
    await engine.command({ type: 'start-search' });
    expect(await engine.step()).toBe(false);
    await engine.command({ type: 'resume' });
    expect(await engine.step()).toBe(false);
    expect(client.fetchCollectors).toHaveBeenCalledTimes(1);
    expect((await repo.active())!.retryAt).toBe(100_060_000);
  });
  it('stops at CAPTCHA and does not repeatedly send requests', async () => {
    const { engine, repo, client } = setup();
    await engine.connect(fan(1).url);
    vi.mocked(client.fetchCollectors).mockRejectedValue(new RequestError('Browser check', 'captcha'));
    await engine.command({ type: 'start-search' });
    await engine.step(); await engine.step();
    expect((await repo.active())!.paused).toBe(true);
    expect(client.fetchCollectors).toHaveBeenCalledTimes(1);
  });
  it('rejects non-advancing pagination and marks baseline incomplete', async () => {
    const { engine, repo, client } = setup();
    vi.mocked(client.fetchProfile).mockResolvedValue(profile(1, true));
    vi.mocked(client.fetchCollectionPage).mockResolvedValue({ items: [release(1)], cursor: 'page-2', more: true });
    await engine.connect(fan(1).url);
    await engine.step();
    const state = (await repo.active())!;
    expect(state.paused).toBe(true);
    expect(state.library.collectionComplete).toBe(false);
  });
  it('cancelling a baseline job leaves its incompleteness visible', async () => {
    const { engine, repo, client } = setup();
    vi.mocked(client.fetchProfile).mockResolvedValue(profile(1, true));
    await engine.connect(fan(1).url);
    await engine.command({ type: 'cancel-job', id: (await repo.active())!.jobs[0].id });
    await drain(engine);
    expect((await engine.snapshot('en')).library!.collectionComplete).toBe(false);
  });
  it('keeps profile data, hidden choices and pending work isolated across switches', async () => {
    const { engine, repo } = setup();
    await engine.connect(fan(1).url);
    await engine.command({ type: 'hide-release', key: 'a:55' });
    await engine.connect(fan(8).url);
    expect((await repo.active())!.hiddenReleases).toEqual([]);
    await engine.connect(fan(1).url);
    expect((await repo.active())!.hiddenReleases).toEqual(['a:55']);
  });
  it('refreshing generated results preserves user hides and baseline', async () => {
    const { engine, repo } = setup();
    await engine.connect(fan(1).url);
    await engine.command({ type: 'start-search' }); await drain(engine);
    await engine.command({ type: 'hide-release', key: 'a:12' });
    await engine.command({ type: 'refresh' }); await drain(engine);
    const state = (await repo.active())!;
    expect(state.hiddenReleases).toEqual(['a:12']);
    expect(state.library.collection['a:1']).toBeDefined();
  });
  it('empty taste libraries produce honest empty results', async () => {
    const { engine, client } = setup();
    vi.mocked(client.fetchProfile).mockResolvedValue({ ...profile(1), collection: { items: [], cursor: null, more: false, total: 0 }, wishlist: { items: [], cursor: null, more: false, total: 0 } });
    await engine.connect(fan(1).url);
    await expect(engine.command({ type: 'start-search' })).rejects.toThrow('starting release');
    expect((await engine.snapshot('en')).matches).toEqual([]);
  });
  it('skips a deleted collector without stopping every other collector', async () => {
    const { engine, repo, client } = setup();
    await engine.connect(fan(1).url);
    vi.mocked(client.fetchProfile).mockImplementation(async url => {
      if (url === fan(2).url) throw new RequestError('Deleted', 'not-found');
      return profile(3);
    });
    await engine.command({ type: 'start-search' }); await drain(engine);
    const state = (await repo.active())!;
    expect(state.paused).toBe(false);
    expect(state.candidates[2].unavailable).toBe(true);
    expect(state.candidates[3].fetched).toBe(true);
    expect((await engine.snapshot('en')).matches.map(m => m.fan.id)).toEqual([3]);
  });
  it('expired collector data is fetched again rather than treated as a valid cache', async () => {
    const { engine, repo, client } = setup();
    await engine.connect(fan(1).url);
    await engine.command({ type: 'start-search' }); await drain(engine);
    const state = (await repo.active())!;
    state.candidates[2].checkedAt = 1;
    state.candidates[3].checkedAt = 1;
    for (const id of [2, 3]) {
      const cached = (await repo.cached(id))!; cached.checkedAt = 1; await repo.cache(cached);
    }
    await repo.save(state);
    vi.mocked(client.fetchProfile).mockClear();
    await engine.command({ type: 'continue-search' }); await drain(engine);
    expect(client.fetchProfile).toHaveBeenCalledTimes(2);
  });
  it('uses Bandcamp full counts only for the connected viewer and keeps them out of public cache', async () => {
    const { engine, repo, client } = setup();
    await engine.connect(fan(1).url);
    await engine.command({ type: 'set-seeds', keys: ['a:1'] });
    vi.mocked(client.fetchCollectors).mockResolvedValue({ fans: [fan(2)], more: false });
    vi.mocked(client.fetchProfile).mockResolvedValue({ ...profile(2), viewerFanId: 1, totalSharedPurchases: 2 });
    await engine.command({ type: 'start-search' }); await drain(engine);
    const match = (await engine.snapshot('en')).matches[0];
    expect(match.totalSharedPurchases).toBe(2);
    expect(match.purchases).toHaveLength(1);
    expect((await repo.cached(2))!.totalSharedPurchases).toBeUndefined();
    expect((await repo.cached(2))!.sharedCounterCheckedAt).toBeUndefined();
  });
  it('never applies the logged-in account count to a different connected public profile', async () => {
    const { engine, client } = setup();
    await engine.connect(fan(1).url);
    vi.mocked(client.fetchProfile).mockResolvedValue({ ...profile(2), viewerFanId: 99, totalSharedPurchases: 12 });
    await engine.command({ type: 'start-search' }); await drain(engine);
    expect((await engine.snapshot('en')).matches.every(m => m.totalSharedPurchases === undefined)).toBe(true);
  });
  it('refreshes exact counts without throwing away deeper collection pages or preferences', async () => {
    const { engine, repo, client } = setup();
    await engine.connect(fan(1).url);
    await engine.command({ type: 'start-search' }); await drain(engine);
    await engine.command({ type: 'hide-release', key: 'a:12' });
    const before = (await repo.active())!;
    vi.mocked(client.fetchProfile).mockResolvedValue({ ...profile(2), viewerFanId: 1, totalSharedPurchases: 2 });
    await engine.command({ type: 'check-counts' }); await drain(engine);
    const after = (await repo.active())!;
    expect(after.candidates[2].items).toEqual(before.candidates[2].items);
    expect(after.candidates[2].totalSharedPurchases).toBe(2);
    expect(after.hiddenReleases).toEqual(['a:12']);
  });
});
