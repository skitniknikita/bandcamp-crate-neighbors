import type { Candidate, Fan, ProfileState, Release } from '../src/types';
import type { Repository } from '../src/store';
export const release = (id: number, artist = 'Artist ' + id): Release => ({
  key: 'a:' + id, id, type: 'a', title: 'Record ' + id, artist,
  url: 'https://artist.bandcamp.com/album/record-' + id,
});
export const fan = (id: number, count = 2): Fan => ({
  id, name: 'Collector ' + id, username: 'collector' + id,
  url: 'https://bandcamp.com/collector' + id, collectionCount: count,
});
export class MemoryRepository implements Repository {
  profiles = new Map<number, ProfileState>();
  caches = new Map<number, Candidate>();
  activeId?: number;
  at = 0;
  async active() { return this.activeId ? this.byId(this.activeId) : undefined; }
  async byId(id: number) { const state = this.profiles.get(id); return state && structuredClone(state); }
  async activate(id: number) { this.activeId = id; }
  async save(state: ProfileState) { this.profiles.set(state.profile.id, structuredClone(state)); }
  async cached(id: number) { const c = this.caches.get(id); return c && structuredClone(c); }
  async cache(c: Candidate) { this.caches.set(c.fan.id, structuredClone(c)); }
  async invalidateCache(ids: number[]) { ids.forEach(id => this.caches.delete(id)); }
  async networkAt() { return this.at; }
  async setNetworkAt(time: number) { this.at = time; }
}
