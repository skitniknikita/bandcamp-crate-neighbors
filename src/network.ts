import type { Repository } from './store';

export class RequestError extends Error {
  constructor(message: string, public code: 'rate-limit' | 'access' | 'network' | 'captcha' | 'not-found', public retryAt?: number) { super(message); }
}
export function retryAfter(value: string | null, now = Date.now()): number {
  if (value && /^\d+(\.\d+)?$/.test(value.trim())) return now + Math.max(1, Number(value)) * 1000;
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > now ? parsed : now + 60_000;
}
export function createTransport(repo: Repository, fetcher: typeof fetch = fetch) {
  return async (url: string, init?: RequestInit): Promise<string> => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || (parsed.hostname !== 'bandcamp.com' && !parsed.hostname.endsWith('.bandcamp.com')) || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
      throw new Error('Only HTTPS Bandcamp URLs are supported.');
    }
    const wait = Math.max(0, (await repo.networkAt()) - Date.now());
    if (wait > 10_000) throw new RequestError('Bandcamp requests are cooling down.', 'rate-limit', Date.now() + wait);
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    await repo.setNetworkAt(Date.now() + 2000);
    let response: Response;
    try {
      response = await fetcher(url, { ...init, credentials: 'include', signal: AbortSignal.timeout(20_000), redirect: 'error' });
    } catch {
      throw new RequestError('Could not reach Bandcamp. Check your connection and resume.', 'network');
    } finally {
      // Waiting after response headers also covers a slow IndexedDB write before
      // fetch actually starts. This keeps real requests at least two seconds apart.
      await repo.setNetworkAt(Math.max(await repo.networkAt(), Date.now() + 2000));
    }
    if (response.status === 429 || response.status === 503) {
      const at = retryAfter(response.headers.get('Retry-After'));
      await repo.setNetworkAt(at);
      throw new RequestError('Bandcamp asked to slow down. The queue will retry after the cooldown.', 'rate-limit', at);
    }
    if (response.status === 401 || response.status === 403) throw new RequestError('Bandcamp denied access. Open Bandcamp, check your session, then resume.', 'access');
    if (response.status === 404) throw new RequestError('This Bandcamp profile or release is no longer available.', 'not-found');
    if (!response.ok) {
      if (response.status >= 500) throw new RequestError('Bandcamp is temporarily unavailable.', 'network');
      throw new Error('Bandcamp returned HTTP ' + response.status + '.');
    }
    const text = await response.text();
    if (/verify (that )?you are human|checking your browser|cf-chl-|captcha challenge/i.test(text)) {
      throw new RequestError('Bandcamp requires a browser check. Open Bandcamp and resume afterwards.', 'captcha');
    }
    return text;
  };
}
