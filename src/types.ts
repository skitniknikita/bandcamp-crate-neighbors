export type Language = 'ru' | 'en';
export interface Release {
  key: string;
  type: 'a' | 't';
  id: number;
  albumId?: number;
  title: string;
  artist: string;
  artistId?: number;
  url: string;
  artUrl?: string;
  added?: number;
  subscription?: boolean;
}
export interface Fan {
  id: number;
  username: string;
  name: string;
  url: string;
  photoUrl?: string;
  collectionCount: number;
}
export interface CollectionPage { items: Release[]; cursor: string | null; more: boolean; total?: number; knownKeys?: string[]; skipped?: number }
export interface ProfilePage {
  fan: Fan;
  collection: CollectionPage;
  wishlist: CollectionPage;
  followingIds: number[];
  followingCursor: string | null;
  followingMore: boolean;
  currentFan?: Fan;
  totalSharedPurchases?: number;
  viewerFanId?: number;
  viewerUsername?: string;
}
export interface CollectorsPage { fans: Fan[]; more: boolean }
export type JobKind = 'sync-profile' | 'sync-collection' | 'sync-wishlist' | 'sync-following' | 'supporters' | 'fan' | 'fan-counts';
export interface Job {
  id: string;
  kind: JobKind;
  label: string;
  status: 'queued' | 'running' | 'done' | 'cancelled' | 'failed';
  fanId?: number;
  url?: string;
  release?: Release;
  cursor?: string | null;
  target?: number;
  progress: number;
  total?: number;
  error?: string;
  attempts?: number;
}
export interface Candidate {
  fan: Fan;
  items: Record<string, Release>;
  seedKeys: string[];
  cursor: string | null;
  more: boolean;
  fetched: boolean;
  checkedAt: number;
  unavailable?: boolean;
  totalSharedPurchases?: number;
  sharedCounterCheckedAt?: number;
}
export interface Match {
  fan: Fan;
  score: number;
  purchases: Release[];
  wishlist: Release[];
  examined: number;
  total: number;
  complete: boolean;
  discoveries: Release[];
  stale: boolean;
  totalSharedPurchases?: number;
}
export interface Recommendation {
  release: Release;
  score: number;
  fans: { id: number; name: string; url: string }[];
}
export interface Library {
  collection: Record<string, Release>;
  wishlist: Record<string, Release>;
  followingIds: number[];
  collectionComplete: boolean;
  wishlistComplete: boolean;
  followingComplete: boolean;
  collectionTotal: number;
  wishlistTotal: number;
  collectionKeys?: string[];
  wishlistKeys?: string[];
  skippedCount?: number;
}
export interface ProfileState {
  version: 1;
  profile: Fan;
  library: Library;
  seeds: Release[];
  supporters: Record<string, { ids: number[]; more: boolean }>;
  candidates: Record<string, Candidate>;
  jobs: Job[];
  hiddenFans: number[];
  hiddenReleases: string[];
  paused: boolean;
  pauseReason?: string;
  retryAt?: number;
  searchStarted: boolean;
  batchSize: number;
  seedsConfigured?: boolean;
  phase?: 'idle' | 'supporters' | 'quick' | 'deep' | 'done';
}
export interface Settings { language: Language }
export interface Snapshot {
  settings: Settings;
  profile?: Fan;
  library?: Library;
  seeds: Release[];
  matches: Match[];
  recommendations: Recommendation[];
  jobs: Job[];
  paused: boolean;
  pauseReason?: string;
  retryAt?: number;
  searchStarted: boolean;
  hiddenFanCount: number;
  hiddenReleaseCount: number;
  candidateCount: number;
  checkedCount: number;
  error?: string;
}
export type Command =
  | { type: 'snapshot' | 'sync' | 'start-search' | 'continue-search' | 'pause' | 'resume' | 'add-current' | 'restore-hidden' | 'refresh' | 'check-counts' }
  | { type: 'connect'; url?: string }
  | { type: 'set-seeds'; keys: string[] }
  | { type: 'add-release'; url: string }
  | { type: 'deepen'; fanId?: number }
  | { type: 'cancel-job'; id: string }
  | { type: 'hide-fan'; fanId: number }
  | { type: 'hide-release'; key: string }
  | { type: 'settings'; language: Language };
export interface ApiResponse { ok: boolean; snapshot?: Snapshot; error?: string }
