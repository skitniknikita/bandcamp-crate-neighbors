import type { Candidate, CollectionPage, Command, Fan, Job, Library, ProfilePage, ProfileState, Release, Snapshot, Language, CollectorsPage } from './types';
import type { Repository } from './store';
import { defaultSeeds, getMatches, getRecommendations } from './scoring';

export interface BandcampClient {
  fetchProfile(url: string): Promise<ProfilePage>;
  fetchCollectionPage(id: number, kind: 'collection' | 'wishlist', cursor: string | null): Promise<CollectionPage>;
  fetchFollowingPage(id: number, cursor: string | null): Promise<{ ids: number[]; cursor: string | null; more: boolean }>;
  fetchCollectors(release: Release, excluded: number[]): Promise<CollectorsPage>;
}
const live = (j: Job) => j.status === 'queued' || j.status === 'running';
const records = (items: Release[]) => Object.fromEntries(items.map(r => [r.key, r]));
const uid = () => crypto.randomUUID();
function newJob(kind: Job['kind'], label: string, values: Partial<Job> = {}): Job {
  return { id: uid(), kind, label, status: 'queued', progress: 0, ...values };
}
export function newLibrary(): Library {
  return { collection: {}, wishlist: {}, followingIds: [], collectionComplete: false, wishlistComplete: false, followingComplete: false, collectionTotal: 0, wishlistTotal: 0 };
}
export function createState(profile: Fan): ProfileState {
  return {
    version: 1, profile, library: newLibrary(), seeds: [], supporters: {}, candidates: {}, jobs: [],
    hiddenFans: [], hiddenReleases: [], paused: false, searchStarted: false, batchSize: 50, phase: 'idle',
  };
}

export class Engine {
  constructor(private repo: Repository, private client: BandcampClient, private now: () => number = Date.now) {}

  async recover() {
    const state = await this.repo.active();
    if (!state) return;
    for (const job of state.jobs) if (job.status === 'running') job.status = 'queued';
    await this.repo.save(state);
  }

  async connect(url: string) {
    const page = await this.client.fetchProfile(url);
    const existing = await this.repo.byId(page.fan.id);
    if (existing) {
      await this.repo.activate(page.fan.id);
      return;
    }
    const state = createState(page.fan);
    this.applyProfile(state, page);
    await this.repo.save(state);
    await this.repo.activate(page.fan.id);
  }

  private applyProfile(state: ProfileState, page: ProfilePage) {
    state.profile = page.fan;
    for (const candidate of Object.values(state.candidates)) {
      candidate.totalSharedPurchases = undefined;
      candidate.sharedCounterCheckedAt = undefined;
    }
    state.library = {
      collection: records(page.collection.items), wishlist: records(page.wishlist.items),
      followingIds: [...new Set(page.followingIds)],
      collectionComplete: !page.collection.more, wishlistComplete: !page.wishlist.more, followingComplete: !page.followingMore,
      collectionTotal: page.collection.total ?? page.fan.collectionCount,
      wishlistTotal: page.wishlist.total ?? page.wishlist.items.length,
      collectionKeys: page.collection.knownKeys || page.collection.items.map(r => r.key),
      wishlistKeys: page.wishlist.knownKeys || page.wishlist.items.map(r => r.key),
      skippedCount: (page.collection.skipped || 0) + (page.wishlist.skipped || 0),
    };
    if (!state.seedsConfigured) state.seeds = defaultSeeds(state.library);
    if (page.collection.more) state.jobs.push(newJob('sync-collection', 'Collection', { cursor: page.collection.cursor, progress: page.collection.items.length, total: state.library.collectionTotal }));
    if (page.wishlist.more) state.jobs.push(newJob('sync-wishlist', 'Wishlist', { cursor: page.wishlist.cursor, progress: page.wishlist.items.length, total: state.library.wishlistTotal }));
    if (page.followingMore) state.jobs.push(newJob('sync-following', 'Following', { cursor: page.followingCursor, progress: page.followingIds.length }));
  }

  async addRelease(release: Release) {
    const state = await this.requireState();
    if (!state.seeds.some(r => r.key === release.key)) state.seeds.push(release);
    state.seedsConfigured = true;
    await this.repo.save(state);
  }

  async command(command: Command) {
    if (command.type === 'snapshot' || command.type === 'settings') return;
    const state = await this.requireState();
    switch (command.type) {
      case 'pause':
        state.paused = true; state.pauseReason = 'manual'; break;
      case 'resume':
        state.paused = false;
        if (!state.retryAt || state.retryAt <= this.now()) { state.retryAt = undefined; state.pauseReason = undefined; }
        for (const job of state.jobs) if (live(job)) job.attempts = 0;
        break;
      case 'sync':
        for (const job of state.jobs) if (live(job) && job.kind.startsWith('sync-')) job.status = 'cancelled';
        state.jobs.unshift(newJob('sync-profile', state.profile.name, { url: state.profile.url }));
        state.paused = false; state.pauseReason = undefined; break;
      case 'set-seeds': {
        const available = { ...state.library.wishlist, ...state.library.collection, ...records(state.seeds) };
        state.seeds = [...new Set(command.keys)].map(k => available[k]).filter((r): r is Release => !!r);
        state.seedsConfigured = true;
        break;
      }
      case 'start-search':
        if (!state.library.collectionComplete || !state.library.wishlistComplete) throw new Error('Wait for collection and wishlist sync to finish before starting a search.');
        if (!state.seeds.length) throw new Error('Choose at least one starting release.');
        if (state.jobs.some(j => live(j) && !j.kind.startsWith('sync-'))) throw new Error('A search is already running. Pause it or let it finish.');
        state.searchStarted = true;
        state.phase = 'supporters';
        for (const release of state.seeds) this.queueSupporters(state, release);
        break;
      case 'continue-search':
        if (!state.searchStarted) throw new Error('Start a search first.');
        if (state.jobs.some(j => live(j) && !j.kind.startsWith('sync-'))) throw new Error('The current batch is still running.');
        if (!this.queueQuickBatch(state)) {
          for (const release of state.seeds) {
            const source = state.supporters[release.key];
            if (!source || source.more) this.queueSupporters(state, release);
          }
          state.phase = state.jobs.some(j => live(j) && j.kind === 'supporters') ? 'supporters' : 'done';
        }
        break;
      case 'deepen': {
        const candidates = command.fanId
          ? [state.candidates[String(command.fanId)]].filter(Boolean)
          : getMatches(state, this.now()).slice(0, 10).map(m => state.candidates[String(m.fan.id)]);
        for (const candidate of candidates) {
          if (candidate.more) this.queueFan(state, candidate, Object.keys(candidate.items).length + 200);
        }
        break;
      }
      case 'check-counts':
        for (const candidate of Object.values(state.candidates)) {
          if (!candidate.fetched || candidate.unavailable || candidate.fan.id === state.profile.id || state.hiddenFans.includes(candidate.fan.id)) continue;
          if (!state.jobs.some(j => live(j) && j.kind === 'fan-counts' && j.fanId === candidate.fan.id)) {
            state.jobs.unshift(newJob('fan-counts', candidate.fan.name, { fanId: candidate.fan.id }));
          }
        }
        break;
      case 'cancel-job': {
        const job = state.jobs.find(j => j.id === command.id);
        if (job && live(job)) job.status = 'cancelled';
        break;
      }
      case 'hide-fan':
        state.hiddenFans = [...new Set([...state.hiddenFans, command.fanId])]; break;
      case 'hide-release':
        state.hiddenReleases = [...new Set([...state.hiddenReleases, command.key])]; break;
      case 'restore-hidden':
        state.hiddenFans = []; state.hiddenReleases = []; break;
      case 'refresh':
        await this.repo.invalidateCache(Object.values(state.candidates).map(c => c.fan.id));
        for (const job of state.jobs) if (live(job) && !job.kind.startsWith('sync-')) job.status = 'cancelled';
        for (const candidate of Object.values(state.candidates)) { candidate.fetched = false; candidate.checkedAt = 0; candidate.unavailable = false; }
        this.queueQuickBatch(state);
        break;
      default:
        throw new Error('Unsupported command.');
    }
    await this.repo.save(state);
  }

  private queueSupporters(state: ProfileState, release: Release) {
    if (state.jobs.some(j => live(j) && j.kind === 'supporters' && j.release?.key === release.key)) return;
    const count = state.supporters[release.key]?.ids.length || 0;
    state.jobs.push(newJob('supporters', release.title, { release, target: count + 50, progress: count }));
  }

  private queueFan(state: ProfileState, candidate: Candidate, target: number) {
    if (candidate.fan.id === state.profile.id || state.hiddenFans.includes(candidate.fan.id)) return;
    if (state.library.followingComplete && state.library.followingIds.includes(candidate.fan.id)) return;
    const existing = state.jobs.find(j => live(j) && j.kind === 'fan' && j.fanId === candidate.fan.id);
    if (existing) existing.target = Math.max(existing.target || 20, target);
    else state.jobs.push(newJob('fan', candidate.fan.name, { fanId: candidate.fan.id, target }));
  }

  private queueQuickBatch(state: ProfileState): boolean {
    const followed = new Set(state.library.followingComplete ? state.library.followingIds : []);
    const candidates = Object.values(state.candidates)
      .filter(c => (!c.fetched || this.now() - c.checkedAt >= 86_400_000) && !c.unavailable && c.fan.id !== state.profile.id && !state.hiddenFans.includes(c.fan.id) && !followed.has(c.fan.id))
      .sort((a, b) => b.seedKeys.length - a.seedKeys.length || a.fan.id - b.fan.id).slice(0, state.batchSize);
    for (const candidate of candidates) this.queueFan(state, candidate, 20);
    if (candidates.length) state.phase = 'quick';
    return candidates.length > 0;
  }

  private advance(state: ProfileState) {
    if (!state.searchStarted || state.jobs.some(j => live(j) && (j.kind === 'fan' || j.kind === 'supporters'))) return;
    if (state.phase === 'supporters') {
      if (!this.queueQuickBatch(state)) state.phase = 'done';
    } else if (state.phase === 'quick') {
      for (const match of getMatches(state, this.now()).slice(0, 10)) {
        const candidate = state.candidates[String(match.fan.id)];
        if (candidate.more && Object.keys(candidate.items).length < 200) this.queueFan(state, candidate, 200);
      }
      state.phase = state.jobs.some(j => live(j) && j.kind === 'fan') ? 'deep' : 'done';
    } else if (state.phase === 'deep') state.phase = 'done';
  }

  async step(): Promise<boolean> {
    const state = await this.repo.active();
    if (!state || state.paused || (state.retryAt && state.retryAt > this.now())) return false;
    if (state.retryAt) { state.retryAt = undefined; state.pauseReason = undefined; }
    this.advance(state);
    const job = state.jobs.find(j => live(j));
    if (!job) { await this.repo.save(state); return false; }
    job.status = 'running';
    await this.repo.save(state);
    try {
      await this.perform(state, job);
      job.error = undefined;
      job.attempts = 0;
      if (job.status === 'running') job.status = 'queued';
      // Give other sync and scan jobs a turn between pages.
      state.jobs = [...state.jobs.filter(j => j.id !== job.id), job];
      this.advance(state);
    } catch (error) {
      const e = error as Error & { code?: string; retryAt?: number };
      job.error = e.message || 'Unexpected Bandcamp response.';
      job.attempts = (job.attempts || 0) + 1;
      job.status = 'queued';
      if (e.code === 'not-found') {
        job.status = 'failed';
        if (job.fanId && state.candidates[String(job.fanId)]) state.candidates[String(job.fanId)].unavailable = true;
        this.advance(state);
      } else if (e.code === 'rate-limit') {
        state.retryAt = e.retryAt || this.now() + 60_000;
        state.pauseReason = 'rate-limit';
      } else if (e.code === 'network' && job.attempts < 3) {
        state.retryAt = this.now() + 10_000 * job.attempts;
        state.pauseReason = 'network';
      } else {
        state.paused = true;
        state.pauseReason = ['captcha', 'access', 'network'].includes(e.code || '') ? e.code : job.error;
      }
    }
    // Limit only completed history, never queued work or user preferences.
    const history = state.jobs.filter(j => !live(j)).slice(-150);
    state.jobs = [...history, ...state.jobs.filter(live)];
    await this.repo.save(state);
    return !state.paused && !state.retryAt && state.jobs.some(live);
  }

  private async perform(state: ProfileState, job: Job) {
    if (job.kind === 'fan-counts' && job.fanId) {
      const candidate = state.candidates[String(job.fanId)];
      if (!candidate) { job.status = 'cancelled'; return; }
      const page = await this.client.fetchProfile(candidate.fan.url);
      this.applySharedCounter(state, candidate, page);
      job.progress = 1; job.total = 1; job.status = 'done';
      return;
    }
    if (job.kind === 'sync-profile') {
      this.applyProfile(state, await this.client.fetchProfile(state.profile.url));
      job.status = 'done'; job.progress = 1;
      return;
    }
    if (job.kind === 'sync-collection' || job.kind === 'sync-wishlist') {
      const kind = job.kind === 'sync-collection' ? 'collection' : 'wishlist';
      const page = await this.client.fetchCollectionPage(state.profile.id, kind, job.cursor || null);
      const before = job.cursor;
      Object.assign(state.library[kind], records(page.items));
      const keyField = kind === 'collection' ? 'collectionKeys' : 'wishlistKeys';
      state.library[keyField] = [...new Set([...(state.library[keyField] || Object.keys(state.library[kind])), ...(page.knownKeys || page.items.map(r => r.key))])];
      state.library.skippedCount = (state.library.skippedCount || 0) + (page.skipped || 0);
      job.cursor = page.cursor;
      job.progress = Object.keys(state.library[kind]).length;
      if (page.more && (!page.cursor || page.cursor === before)) throw new Error('Bandcamp pagination did not advance. Sync paused to avoid an endless loop.');
      if (!page.more) { state.library[kind === 'collection' ? 'collectionComplete' : 'wishlistComplete'] = true; job.status = 'done'; }
      if (!state.seedsConfigured) state.seeds = defaultSeeds(state.library);
      return;
    }
    if (job.kind === 'sync-following') {
      const page = await this.client.fetchFollowingPage(state.profile.id, job.cursor || null);
      const before = job.cursor;
      state.library.followingIds = [...new Set([...state.library.followingIds, ...page.ids])];
      job.cursor = page.cursor; job.progress = state.library.followingIds.length;
      if (page.more && (!page.cursor || page.cursor === before)) throw new Error('Bandcamp following pagination did not advance.');
      if (!page.more) { state.library.followingComplete = true; job.status = 'done'; }
      return;
    }
    if (job.kind === 'supporters' && job.release) {
      const source = state.supporters[job.release.key] || { ids: [], more: true };
      if (!source.more) { job.status = 'done'; return; }
      const page = await this.client.fetchCollectors(job.release, source.ids);
      let added = 0;
      for (const fan of page.fans) {
        if (!source.ids.includes(fan.id)) { source.ids.push(fan.id); added++; }
        const candidate = state.candidates[String(fan.id)] ||= {
          fan, items: {}, seedKeys: [], cursor: null, more: true, fetched: false, checkedAt: 0,
        };
        if (!candidate.seedKeys.includes(job.release.key)) candidate.seedKeys.push(job.release.key);
      }
      if (page.more && !added) throw new Error('Bandcamp returned no new collectors. Search paused to prevent repeated requests.');
      source.more = page.more;
      state.supporters[job.release.key] = source;
      job.progress = source.ids.length;
      if (!source.more || job.progress >= (job.target || 50)) job.status = 'done';
      return;
    }
    if (job.kind === 'fan' && job.fanId) {
      const candidate = state.candidates[String(job.fanId)];
      if (!candidate || state.hiddenFans.includes(job.fanId)) { job.status = 'cancelled'; return; }
      if (!candidate.fetched || this.now() - candidate.checkedAt >= 86_400_000) {
        const cached = await this.repo.cached(job.fanId);
        if (cached && cached.fetched && this.now() - cached.checkedAt < 86_400_000) {
          Object.assign(candidate, cached, { seedKeys: [...new Set([...candidate.seedKeys, ...cached.seedKeys])] });
        } else {
          const page = await this.client.fetchProfile(candidate.fan.url);
          candidate.fan = page.fan;
          candidate.items = records(page.collection.items);
          candidate.cursor = page.collection.cursor;
          candidate.more = page.collection.more;
          candidate.fetched = true;
          candidate.checkedAt = this.now();
          this.applySharedCounter(state, candidate, page);
        }
      } else if (candidate.more && Object.keys(candidate.items).length < (job.target || 20)) {
        const before = candidate.cursor;
        const page = await this.client.fetchCollectionPage(candidate.fan.id, 'collection', candidate.cursor);
        if (page.more && (!page.cursor || page.cursor === before)) throw new Error('Bandcamp collector pagination did not advance.');
        Object.assign(candidate.items, records(page.items));
        candidate.cursor = page.cursor;
        candidate.more = page.more;
        candidate.checkedAt = this.now();
      }
      job.progress = Object.keys(candidate.items).length;
      job.total = Math.min(candidate.fan.collectionCount, job.target || 20);
      // Exact counts belong to the signed-in viewer, never to the shared public cache.
      await this.repo.cache({ ...candidate, seedKeys: [], totalSharedPurchases: undefined, sharedCounterCheckedAt: undefined });
      if (!candidate.more || job.progress >= (job.target || 20)) job.status = 'done';
    }
  }

  private applySharedCounter(state: ProfileState, candidate: Candidate, page: ProfilePage) {
    const sameViewer = page.viewerFanId === state.profile.id ||
      (page.viewerFanId === undefined && page.viewerUsername?.toLowerCase() === state.profile.username.toLowerCase());
    candidate.totalSharedPurchases = sameViewer ? page.totalSharedPurchases : undefined;
    candidate.sharedCounterCheckedAt = this.now();
  }

  async snapshot(language: Language): Promise<Snapshot> {
    const state = await this.repo.active();
    if (!state) return {
      settings: { language }, seeds: [], matches: [], recommendations: [], jobs: [], paused: false,
      searchStarted: false, hiddenFanCount: 0, hiddenReleaseCount: 0, candidateCount: 0, checkedCount: 0,
    };
    const matches = getMatches(state, this.now());
    return {
      settings: { language }, profile: state.profile, library: state.library, seeds: state.seeds,
      matches, recommendations: getRecommendations(state, matches), jobs: state.jobs,
      paused: state.paused, pauseReason: state.pauseReason, retryAt: state.retryAt, searchStarted: state.searchStarted,
      hiddenFanCount: state.hiddenFans.length, hiddenReleaseCount: state.hiddenReleases.length,
      candidateCount: Object.keys(state.candidates).length,
      checkedCount: Object.values(state.candidates).filter(c => c.fetched).length,
    };
  }
  private async requireState() {
    const state = await this.repo.active();
    if (!state) throw new Error('Connect a Bandcamp profile first.');
    return state;
  }
}
