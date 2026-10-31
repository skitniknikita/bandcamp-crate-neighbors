import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Candidate, ProfileState } from './types';

interface Database extends DBSchema {
  profiles: { key: number; value: ProfileState };
  meta: { key: string; value: string | number };
  fanCache: { key: number; value: Candidate };
}
export interface Repository {
  active(): Promise<ProfileState | undefined>;
  byId(id: number): Promise<ProfileState | undefined>;
  activate(id: number): Promise<void>;
  save(state: ProfileState): Promise<void>;
  cached(id: number): Promise<Candidate | undefined>;
  cache(candidate: Candidate): Promise<void>;
  invalidateCache(ids: number[]): Promise<void>;
  networkAt(): Promise<number>;
  setNetworkAt(time: number): Promise<void>;
}
export class BrowserRepository implements Repository {
  private database: Promise<IDBPDatabase<Database>>;
  constructor() {
    this.database = openDB<Database>('crate-neighbors', 1, {
      upgrade(db) {
        db.createObjectStore('profiles');
        db.createObjectStore('meta');
        db.createObjectStore('fanCache');
      },
    });
  }
  async active() {
    const db = await this.database;
    const id = await db.get('meta', 'activeProfileId');
    return typeof id === 'number' ? db.get('profiles', id) : undefined;
  }
  async byId(id: number) { return (await this.database).get('profiles', id); }
  async activate(id: number) { await (await this.database).put('meta', id, 'activeProfileId'); }
  async save(state: ProfileState) { await (await this.database).put('profiles', state, state.profile.id); }
  async cached(id: number) { return (await this.database).get('fanCache', id); }
  async cache(candidate: Candidate) { await (await this.database).put('fanCache', candidate, candidate.fan.id); }
  async invalidateCache(ids: number[]) {
    const tx = (await this.database).transaction('fanCache', 'readwrite');
    for (const id of ids) await tx.store.delete(id);
    await tx.done;
  }
  async networkAt() { return Number(await (await this.database).get('meta', 'networkAt')) || 0; }
  async setNetworkAt(time: number) { await (await this.database).put('meta', time, 'networkAt'); }
}
