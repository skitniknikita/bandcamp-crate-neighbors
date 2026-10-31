import { describe, it, expect } from 'vitest';
import { createState } from '../src/engine';
import { defaultSeeds, getMatches, getRecommendations, isKnown, scoreCandidate } from '../src/scoring';
import { fan, release } from './helpers';
import type { Candidate } from '../src/types';
function candidate(id: number, ids: number[]): Candidate {
  return { fan: fan(id, ids.length), items: Object.fromEntries(ids.map(id => [release(id).key, release(id)])), seedKeys: [], fetched: true, more: false, cursor: null, checkedAt: Date.now() };
}
describe('evidence based matching', () => {
  it('purchases weigh twice wishlist, with no duplicate intersection', () => {
    const state = createState(fan(1));
    state.library.collection = { 'a:1': release(1) };
    state.library.wishlist = { 'a:1': release(1), 'a:2': release(2) };
    const a = scoreCandidate(candidate(2, [1, 3]), state);
    const b = scoreCandidate(candidate(3, [2, 3]), state);
    expect(a.score).toBeCloseTo(b.score * 2);
    expect(a.wishlist).toHaveLength(0);
  });
  it('single coincidences receive less confidence than several overlaps', () => {
    const state = createState(fan(1));
    for (const id of [1, 2, 3]) state.library.collection['a:' + id] = release(id);
    expect(scoreCandidate(candidate(2, [1, 2, 3]), state).score).toBeGreaterThan(scoreCandidate(candidate(3, [1, 4, 5]), state).score);
  });
  it('reports incomplete samples without a pretend exact percentage', () => {
    const state = createState(fan(1));
    const c = candidate(2, [1, 2]); c.more = true; c.fan.collectionCount = 2000;
    const match = scoreCandidate(c, state);
    expect(match).toMatchObject({ examined: 2, total: 2000, complete: false });
    expect(match).not.toHaveProperty('percentage');
  });
  it('excludes self, hidden people and followed people only when following sync is complete', () => {
    const state = createState(fan(1)); state.library.collection['a:1'] = release(1);
    for (const id of [1, 2, 3, 4]) state.candidates[id] = candidate(id, [1, id + 10]);
    state.hiddenFans = [3]; state.library.followingIds = [2];
    expect(getMatches(state).map(m => m.fan.id)).toEqual([2, 4]);
    state.library.followingComplete = true;
    expect(getMatches(state).map(m => m.fan.id)).toEqual([4]);
  });
  it('combines each distinct contributor once and excludes purchases and wishlist', () => {
    const state = createState(fan(1)); state.library.collection['a:1'] = release(1); state.library.wishlist['a:2'] = release(2);
    state.library.collectionComplete = true; state.library.wishlistComplete = true;
    state.candidates[2] = candidate(2, [1, 2, 3]);
    state.candidates[3] = candidate(3, [1, 3, 4]);
    const recommendations = getRecommendations(state);
    expect(recommendations.map(r => r.release.id)).toEqual([3, 4]);
    expect(recommendations[0].fans).toHaveLength(2);
    state.hiddenReleases = ['a:3'];
    expect(getRecommendations(state).map(r => r.release.id)).toEqual([4]);
  });
  it('recognizes tracks on owned albums without mistaking an owned track for the whole album', () => {
    const state = createState(fan(1)); state.library.collection['a:1'] = release(1);
    expect(isKnown({ ...release(2), key: 't:2', type: 't', albumId: 1 }, state.library)).toBe(true);
    state.library.collection = { 't:2': { ...release(2), key: 't:2', type: 't', albumId: 1 } };
    expect(isKnown(release(1), state.library)).toBe(false);
  });
  it('keeps the first twenty results to two per artist even when fewer diverse results exist', () => {
    const state = createState(fan(1)); state.library.collection['a:1'] = release(1);
    state.library.collectionComplete = true; state.library.wishlistComplete = true;
    const c = candidate(2, [1, 2, 3, 4, 5]);
    for (const id of [2, 3, 4, 5]) c.items['a:' + id].artist = 'Same artist';
    state.candidates[2] = c;
    expect(getRecommendations(state)).toHaveLength(2);
  });
  it('never recommends a possibly owned record while baseline resync is incomplete', () => {
    const state = createState(fan(1)); state.library.collection['a:1'] = release(1);
    state.candidates[2] = candidate(2, [1, 2, 3]);
    expect(getRecommendations(state)).toEqual([]);
    state.library.collectionComplete = true; state.library.wishlistComplete = true;
    expect(getRecommendations(state)).toHaveLength(2);
  });
  it('uses identifier-only purchases to exclude records whose original details were unavailable', () => {
    const state = createState(fan(1)); state.library.collection['a:1'] = release(1);
    state.library.collectionKeys = ['a:1', 'a:2'];
    state.library.collectionComplete = true; state.library.wishlistComplete = true;
    state.candidates[2] = candidate(2, [1, 2, 3]);
    expect(getRecommendations(state).map(r => r.release.id)).toEqual([3]);
    expect(getMatches(state)[0].purchases).toHaveLength(2);
  });
  it('retains full shared purchase evidence beyond a small sample without inventing shared titles', () => {
    const state = createState(fan(1));
    for (let id = 1; id <= 5; id++) state.library.collection['a:' + id] = release(id);
    const c = candidate(2, [1, 8, 9]); c.totalSharedPurchases = 4; c.fan.collectionCount = 1000;
    const match = scoreCandidate(c, state);
    expect(match.totalSharedPurchases).toBe(4);
    expect(match.purchases.map(r => r.id)).toEqual([1]);
    expect(match.total).toBe(1000);
  });
  it('chooses four purchases and two wishlist seeds with artist diversity and stable ordering', () => {
    const state = createState(fan(1));
    for (let i = 1; i <= 8; i++) state.library.collection['a:' + i] = { ...release(i), added: i };
    for (let i = 9; i <= 12; i++) state.library.wishlist['a:' + i] = { ...release(i), added: i };
    expect(defaultSeeds(state.library).map(r => r.id)).toEqual([8, 7, 6, 5, 12, 11]);
  });
});
