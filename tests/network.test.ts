import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTransport, retryAfter } from '../src/network';
import { MemoryRepository } from './helpers';
afterEach(() => vi.useRealTimers());
describe('bounded direct Bandcamp networking', () => {
  it('accepts seconds and dates for Retry-After', () => {
    expect(retryAfter('120', 1000)).toBe(121000);
    expect(retryAfter('Thu, 01 Jan 1970 00:01:00 GMT', 1000)).toBe(60000);
    expect(retryAfter(null, 1000)).toBe(61000);
  });
  it('rejects other hosts, deceptively named hosts and URL credentials before fetch', async () => {
    const fetcher = vi.fn();
    const transport = createTransport(new MemoryRepository(), fetcher);
    for (const url of ['https://evil.test/', 'https://bandcamp.com.evil.test/', 'https://user:pass@bandcamp.com/a', 'http://bandcamp.com/']) {
      await expect(transport(url)).rejects.toThrow('HTTPS Bandcamp');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('persists the two second interval and uses the browser session without reading cookies', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const repo = new MemoryRepository();
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('ok'));
    const transport = createTransport(repo, fetcher);
    await transport('https://bandcamp.com/a');
    const second = transport('https://bandcamp.com/b');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await second;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include', redirect: 'error' });
  });
  it('persists a server cooldown and surfaces it without making another request', async () => {
    const repo = new MemoryRepository();
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    const transport = createTransport(repo, fetcher);
    await expect(transport('https://bandcamp.com/a')).rejects.toMatchObject({ code: 'rate-limit' });
    await expect(transport('https://bandcamp.com/b')).rejects.toMatchObject({ code: 'rate-limit' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(repo.at).toBeGreaterThan(Date.now() + 110_000);
  });
  it('does not mistake a normal recaptcha site key for a blocking challenge', async () => {
    const transport = createTransport(new MemoryRepository(), vi.fn(async () => new Response('recaptcha_public_key normal page')));
    await expect(transport('https://bandcamp.com/a')).resolves.toContain('normal page');
  });
});
