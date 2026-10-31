import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = resolve(root, 'dist');
const liveMode = process.argv.includes('--live');
const output = resolve(root, liveMode ? 'artifacts/browser-live-test' : 'artifacts/browser-test');
await readFile(resolve(dist, 'manifest.json'), 'utf8');
await mkdir(output, { recursive: true });
const profileDir = await mkdtemp(resolve(tmpdir(), 'crate-neighbors-browser-'));
const report = { kind: liveMode ? 'live-public' : 'controlled-fixture', authorizedBandcampProfileTested: false, passed: [], screenshots: [], errors: [] };
let context;
let page;
let worker;
let extensionId;
const fixtureProfile = 'https://bandcamp.com/crate-neighbors-test';

async function launch() {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 430, height: 920 },
    args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
  extensionId = new URL(worker.url()).host;
  page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  if (!liveMode) await context.route('https://*.bcbits.com/**', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#4059C7"/><circle cx="50" cy="50" r="30" fill="#17243C"/><circle cx="50" cy="50" r="6" fill="#F6F8FA"/></svg>',
  }));
  await page.goto('chrome-extension://' + extensionId + '/sidepanel.html');
  await page.locator('#root').waitFor({ state: 'visible' });
}

async function command(value) {
  return page.evaluate(async (message) => {
    return await chrome.runtime.sendMessage(message);
  }, value);
}
async function send(value) {
  const response = await command(value);
  assert.equal(response.ok, true, response.error || 'Command failed: ' + value.type);
  return response.snapshot;
}
async function until(predicate, label, timeout = 120000) {
  const started = Date.now();
  let snapshot;
  do {
    snapshot = await send({ type: 'snapshot' });
    if (predicate(snapshot)) return snapshot;
    await new Promise((done) => setTimeout(done, 600));
  } while (Date.now() - started < timeout);
  throw new Error(label + ': ' + JSON.stringify({
    paused: snapshot?.paused, reason: snapshot?.pauseReason, error: snapshot?.error,
    jobs: snapshot?.jobs.map((job) => ({ kind: job.kind, status: job.status, error: job.error, progress: job.progress })),
  }));
}
async function screenshot(name) {
  await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
  report.screenshots.push(name + '.png');
}
async function clickSection(expression) {
  const tab = page.getByRole('tab', { name: expression });
  if (await tab.count()) await tab.first().click();
  else await page.getByRole('button', { name: expression }).first().click();
}

async function installFixtureTransport() {
  {
    const item = (id, title, artist = 'Fixture Artist ' + id) => ({
      item_id: id, item_type: 'album', tralbum_id: id, tralbum_type: 'a', album_id: id,
      item_title: title, band_id: id + 1000, band_name: artist,
      item_url: 'https://crate-fixture.bandcamp.com/album/release-' + id,
      item_art_id: id + 10000, added: 1700000000 + id,
    });
    const records = {
      101: item(101, 'Shared record one'), 102: item(102, 'Shared record two'),
      103: item(103, 'Shared record three'), 104: item(104, 'On the wishlist'),
      201: item(201, 'A new discovery'), 202: item(202, 'Another new discovery'),
    };
    for (let id = 203; id <= 399; id++) records[id] = item(id, 'Fixture discovery ' + id);
    // The third shared purchase is older than the first 200 records examined.
    const collectorOnePurchases = [101, 102, 201, ...Array.from({ length: 197 }, (_, index) => 203 + index), 103];
    const profile = (id, username, purchases, wishlist = [], options = {}) => {
      const cache = (ids) => Object.fromEntries(ids.map((key) => ['a' + key, records[key]]));
      const allPurchases = options.total || purchases.length;
      const following = id === 1 ? [{ fan_id: 4, username: 'fixture-followed', name: 'Already followed', fan_url: 'https://bandcamp.com/fixture-followed' }] : [];
      const blob = {
        fan_data: { fan_id: id, username, name: username, trackpipe_url: 'https://bandcamp.com/' + username },
        current_fan: { fan_id: 1 },
        collection_count: allPurchases,
        collection_data: {
          item_count: allPurchases, batch_size: 20, sequence: purchases.map((key) => 'a' + key),
          last_token: options.cursor || null,
        },
        wishlist_data: { item_count: wishlist.length, batch_size: 20, sequence: wishlist.map((key) => 'a' + key), last_token: null },
        following_fans_data: { item_count: following.length, batch_size: 20, sequence: [], last_token: following.length ? 'following-page-one' : null },
        item_cache: {
          collection: cache(purchases), wishlist: cache(wishlist),
          following_fans: {},
        },
      };
      const counter = options.shared === undefined ? '' : '<div class="genre-wrapper">' + options.shared + ' items in common</div>';
      return '<!doctype html><html><head><title>Fixture collection</title></head><body>' + counter + '<div id="pagedata" data-blob="' +
        JSON.stringify(blob).replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '"></div></body></html>';
    };
    const pages = {
      '/crate-neighbors-test': profile(1, 'crate-neighbors-test', [101, 102], [104], { total: 3, cursor: 'own-page-two' }),
      '/fixture-collector-one': profile(2, 'fixture-collector-one', collectorOnePurchases.slice(0, 20), [], { total: 201, cursor: 'collector-one:20', shared: 3 }),
      '/fixture-collector-two': profile(3, 'fixture-collector-two', [101, 104, 201, 202], [], { shared: 1 }),
      '/fixture-followed': profile(4, 'fixture-followed', [101, 201]),
      '/crate-neighbors-other': profile(9, 'crate-neighbors-other', [103]),
    };
    const fans = [
      { fan_id: 1, username: 'crate-neighbors-test', name: 'Self', url: 'https://bandcamp.com/crate-neighbors-test' },
      { fan_id: 2, username: 'fixture-collector-one', name: 'Collector One', url: 'https://bandcamp.com/fixture-collector-one' },
      { fan_id: 3, username: 'fixture-collector-two', name: 'Collector Two', url: 'https://bandcamp.com/fixture-collector-two' },
      { fan_id: 4, username: 'fixture-followed', name: 'Already followed', url: 'https://bandcamp.com/fixture-followed' },
    ];
    globalThis.__crateFixture = { requests: [], records, pages, fans, mode: 'normal' };
    const fixtureFetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const state = globalThis.__crateFixture;
      state.requests.push({ path: url.pathname, at: Date.now(), method: init.method || 'GET' });
      if (url.hostname !== 'bandcamp.com' && !url.hostname.endsWith('.bandcamp.com')) throw new Error('Unexpected fixture network host: ' + url.hostname);
      if (state.mode === 'rate-limit') {
        state.mode = 'normal';
        return new Response('Too many requests', { status: 429, headers: { 'Retry-After': '3' } });
      }
      if (state.mode === 'captcha') {
        state.mode = 'normal';
        return new Response('<html><body>captcha challenge</body></html>', { headers: { 'Content-Type': 'text/html' } });
      }
      if (pages[url.pathname]) return new Response(pages[url.pathname], { headers: { 'Content-Type': 'text/html' } });
      let payload = {};
      if (init.body) {
        try { payload = JSON.parse(String(init.body)); }
        catch { payload = Object.fromEntries(new URLSearchParams(String(init.body))); }
      }
      if (url.pathname.endsWith('/collection_items')) {
        if (Number(payload.fan_id) === 2) {
          const offset = Number(String(payload.older_than_token).split(':').at(-1));
          const ids = collectorOnePurchases.slice(offset, offset + 20);
          const end = offset + ids.length;
          return Response.json({ items: ids.map((id) => records[id]), last_token: 'collector-one:' + end,
            more_available: end < collectorOnePurchases.length, item_lookup: {}, tracklists: {} });
        }
        return Response.json({
          items: Number(payload.fan_id) === 1 ? [records[103]] : [], last_token: null, more_available: false,
          item_lookup: {}, tracklists: {},
        });
      }
      if (url.pathname.endsWith('/wishlist_items')) return Response.json({ items: [], more_available: false, last_token: null });
      if (url.pathname.includes('/following_fans')) return Response.json({
        followeers: Number(payload.fan_id) === 1 ? [fans.find((fan) => fan.fan_id === 4)] : [],
        more_available: false, last_token: null,
      });
      if (url.pathname.includes('/tralbumcollectors/')) {
        const owns = { 1: [101, 102, 103], 2: collectorOnePurchases, 3: [101, 104, 201, 202], 4: [101, 201] };
        return Response.json({ results: fans.filter((fan) => owns[fan.fan_id].includes(Number(payload.tralbum_id))), more_available: false });
      }
      if (url.pathname.startsWith('/album/')) {
        const id = Number(url.pathname.split('-').at(-1));
        const record = records[id] || records[101];
        const data = { id: record.tralbum_id, item_type: 'album', artist: record.band_name, url: record.item_url,
          art_id: record.item_art_id, current: { id: record.tralbum_id, title: record.item_title, type: 'album', band_id: record.band_id } };
        return new Response('<script data-tralbum="' + JSON.stringify(data).replaceAll('"', '&quot;') + '"></script>', { headers: { 'Content-Type': 'text/html' } });
      }
      throw new Error('Unexpected fixture request: ' + url.pathname);
    };
    await context.route(/^https:\/\/(?:[^/]+\.)?bandcamp\.com\//, async (route) => {
      try {
        const request = route.request();
        const response = await fixtureFetch(request.url(), { method: request.method(), body: request.postData() });
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
      } catch (error) {
        report.errors.push(String(error));
        await route.abort();
      }
    });
  }
}

try {
  await launch();
  await send({ type: 'settings', language: 'en' });
  await screenshot('01-onboarding');
  report.passed.push('Installed MV3 build starts and renders onboarding in isolated Chromium.');
  if (liveMode) {
    let snapshot = await send({ type: 'connect', url: 'https://bandcamp.com/fractalwizz' });
    await send({ type: 'pause' });
    snapshot = await send({ type: 'snapshot' });
    assert.equal(snapshot.profile.id, 1986167);
    assert.ok(Object.keys(snapshot.library.collection).length >= 20);
    assert.ok(Object.keys(snapshot.library.wishlist).length >= 20);
    assert.equal(snapshot.paused, true);
    report.passed.push('Compiled extension fetches and parses a live public Bandcamp profile, collection and wishlist; queue paused to avoid a large crawl.');
    snapshot = await send({ type: 'add-release', url: 'https://sonnovdrone.bandcamp.com/album/jedaluqam' });
    const liveSeed = snapshot.seeds.find((release) => release.title.toLowerCase() === 'jedaluqam');
    assert.ok(liveSeed);
    report.passed.push('Compiled extension fetches and identifies a live Bandcamp release.');
    await new Promise((done) => setTimeout(done, 2100));
    const supporterCheck = await page.evaluate(async (release) => {
      const endpoint = new URL('/api/tralbumcollectors/2/thumbs', release.url).href;
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ tralbum_type: release.type, tralbum_id: release.id, count: 5, token: null, exclude_fan_ids: [] }),
      });
      const data = await response.json();
      return { status: response.status, resultCount: Array.isArray(data.results) ? data.results.length : null, error: !!data.error };
    }, liveSeed);
    assert.equal(supporterCheck.status, 200);
    assert.equal(supporterCheck.error, false);
    assert.ok(supporterCheck.resultCount > 0);
    report.passed.push('Real public supporters POST succeeds from the installed extension origin with Bandcamp-only host permissions; no broad crawl performed.');
    await page.reload();
    await page.getByText('fractalwizz', { exact: true }).first().waitFor();
    await screenshot('02-live-public-profile');
    await clickSection(/Queue|Очередь/i);
    await screenshot('03-live-public-queue-paused');
    assert.deepEqual(report.errors, [], 'Unexpected live UI runtime errors.');
    console.log('Live public smoke passed: ' + report.passed.length + ' scenarios. Authorized account scenario remains unverified.');
  } else {
  await installFixtureTransport();
  await send({ type: 'connect', url: fixtureProfile });
  let state = await until((snapshot) => snapshot.library?.collectionComplete && snapshot.library?.wishlistComplete && snapshot.library?.followingComplete, 'Library did not finish');
  assert.equal(state.profile.id, 1);
  assert.equal(Object.keys(state.library.collection).length, 3);
  assert.equal(Object.keys(state.library.wishlist).length, 1);
  assert.ok(state.library.followingIds.includes(4));
  report.passed.push('Profile, paginated purchases, wishlist and existing following list load through the compiled worker.');
  await send({ type: 'set-seeds', keys: ['a:101', 'a:102', 'a:104'] });
  await send({ type: 'start-search' });
  state = await until((snapshot) => snapshot.matches.length >= 2 && !snapshot.jobs.some((job) => ['queued', 'running'].includes(job.status)), 'Search did not finish');
  assert.deepEqual(state.matches.map((match) => match.fan.id).sort(), [2, 3]);
  assert.deepEqual(state.matches.find((match) => match.fan.id === 2).purchases.map((release) => release.id).sort(), [101, 102]);
  assert.equal(state.matches.find((match) => match.fan.id === 2).wishlist.length, 0);
  assert.deepEqual(state.matches.find((match) => match.fan.id === 3).purchases.map((release) => release.id), [101]);
  assert.deepEqual(state.matches.find((match) => match.fan.id === 3).wishlist.map((release) => release.id), [104]);
  const sampledMatch = state.matches.find((match) => match.fan.id === 2);
  assert.equal(sampledMatch.examined, 200);
  assert.equal(sampledMatch.totalSharedPurchases, 3);
  assert.ok(sampledMatch.totalSharedPurchases > sampledMatch.purchases.length);
  assert.equal(state.matches.find((match) => match.fan.id === 3).totalSharedPurchases, 1);
  await send({ type: 'check-counts' });
  state = await until((snapshot) => !snapshot.jobs.some((job) => job.kind === 'fan-counts' && ['queued', 'running'].includes(job.status)), 'Full count refresh did not finish');
  assert.equal(state.matches.find((match) => match.fan.id === 2).examined, 200, 'Counter refresh must retain previously examined deep data.');
  assert.equal(state.matches.find((match) => match.fan.id === 2).totalSharedPurchases, 3);
  report.passed.push('ID-only viewer identity trusts the full Bandcamp purchase count beyond the 200-item sample; refreshing counts preserves deep data.');
  assert.ok(state.recommendations.length >= 2);
  assert.ok(state.recommendations.every((recommendation) => ![101, 102, 103, 104].includes(recommendation.release.id)));
  const sharedDiscovery = state.recommendations.find((recommendation) => recommendation.release.id === 201);
  assert.equal(sharedDiscovery.fans.length, 2);
  const gaps = globalThis.__crateFixture.requests.slice(1).map((request, index) => request.at - globalThis.__crateFixture.requests[index].at);
  report.minimumObservedRequestGapMs = Math.min(...gaps);
  assert.ok(gaps.every((gap) => gap >= 1950), 'Requests are unexpectedly concurrent or too tightly spaced.');
  const dispatches = await worker.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => entry.initiatorType === 'fetch' && /^https:\/\/(?:[^/]+\.)?bandcamp\.com\//.test(entry.name))
    .map((entry) => entry.startTime).sort((a, b) => a - b));
  const dispatchGaps = dispatches.slice(1).map((at, index) => at - dispatches[index]);
  report.minimumObservedFetchDispatchGapMs = dispatchGaps.length ? Math.min(...dispatchGaps) : null;
  if (dispatchGaps.length) assert.ok(dispatchGaps.every((gap) => gap >= 1950), 'Fetch dispatches are unexpectedly concurrent or too tightly spaced.');
  report.passed.push('Search excludes self/followed collectors and known releases, merges duplicate recommendations, and preserves two distinct reasons.');
  await page.reload();
  await page.getByRole('article', { name: 'A new discovery', exact: true }).waitFor();
  await screenshot('02-music-fixture');
  assert.equal(await page.locator('.music-list > article').count(), 20, 'Initial music render must be paginated.');
  await page.getByRole('button', { name: 'Show 20 more records', exact: true }).click();
  assert.equal(await page.locator('.music-list > article').count(), 40);
  await clickSection(/Collectors|Коллекционеры|People/i);
  await page.getByRole('checkbox', { name: '2+ shared purchases', exact: true }).check();
  assert.equal(await page.locator('.collector-list > article').count(), 1);
  assert.equal(await page.locator('.collector-list > article').getAttribute('aria-label'), 'fixture-collector-one');
  assert.equal(await page.locator('.collector-list > article .evidence-number').first().innerText(), '3');
  await screenshot('03-collectors-fixture');
  report.passed.push('The 2+ purchases filter uses the trusted full counter; music renders 20 results and loads the next 20 on request.');
  await clickSection(/Queue|Очередь/i);
  await screenshot('04-queue-fixture');
  await page.setViewportSize({ width: 320, height: 820 });
  await screenshot('05-narrow-fixture');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(overflow, false, 'Panel overflows horizontally at 320px.');
  report.passed.push('Music, collectors and queue render; 320px panel has no horizontal overflow.');
  await send({ type: 'hide-release', key: sharedDiscovery.release.key });
  state = await send({ type: 'snapshot' });
  assert.ok(!state.recommendations.some((recommendation) => recommendation.release.id === 201));
  await send({ type: 'hide-fan', fanId: 2 });
  state = await send({ type: 'snapshot' });
  assert.ok(!state.matches.some((match) => match.fan.id === 2));
  await send({ type: 'start-search' });
  await send({ type: 'pause' });
  state = await send({ type: 'snapshot' });
  const pendingBeforeRestart = state.jobs.filter((job) => ['queued', 'running'].includes(job.status)).length;
  assert.ok(pendingBeforeRestart > 0, 'Restart scenario requires unfinished work.');
  await context.close();
  await launch();
  await installFixtureTransport();
  state = await send({ type: 'snapshot' });
  assert.equal(state.profile.id, 1);
  assert.equal(state.paused, true);
  assert.equal(state.hiddenFanCount, 1);
  assert.equal(state.hiddenReleaseCount, 1);
  assert.equal(state.jobs.filter((job) => ['queued', 'running'].includes(job.status)).length, pendingBeforeRestart);
  assert.ok(!state.matches.some((match) => match.fan.id === 2));
  await send({ type: 'resume' });
  await until((snapshot) => !snapshot.jobs.some((job) => ['queued', 'running'].includes(job.status)), 'Saved queue did not resume');
  report.passed.push('Browser and worker restart preserve and resume unfinished queue, profile, pause, hidden people and releases.');
  await send({ type: 'connect', url: 'https://bandcamp.com/crate-neighbors-other' });
  state = await until((snapshot) => snapshot.profile?.id === 9 && snapshot.library?.collectionComplete, 'Second profile did not load');
  assert.equal(state.hiddenFanCount, 0);
  assert.equal(state.matches.length, 0);
  await send({ type: 'start-search' });
  state = await until((snapshot) => snapshot.matches.some((match) => match.fan.id === 2) && !snapshot.jobs.some((job) => ['queued', 'running'].includes(job.status)), 'Other-profile search did not finish');
  await send({ type: 'check-counts' });
  state = await until((snapshot) => !snapshot.jobs.some((job) => job.kind === 'fan-counts' && ['queued', 'running'].includes(job.status)), 'Other-profile count refresh did not finish');
  assert.equal(state.matches.find((match) => match.fan.id === 2).totalSharedPurchases, undefined, 'A different viewer must not supply account-relative counters or inherit them from global cache.');
  report.passed.push('Account-relative full counters are ignored for a different connected profile and never leak through the shared collection cache.');
  await send({ type: 'connect', url: fixtureProfile });
  state = await until((snapshot) => snapshot.profile?.id === 1, 'Original profile did not return');
  assert.equal(state.hiddenFanCount, 1);
  await send({ type: 'restore-hidden' });
  state = await send({ type: 'snapshot' });
  assert.equal(state.hiddenFanCount, 0);
  assert.equal(state.hiddenReleaseCount, 0);
  report.passed.push('Connected profiles are isolated; switching back preserves choices and restore-hidden works.');
  globalThis.__crateFixture.mode = 'rate-limit';
  await send({ type: 'sync' });
  state = await until((snapshot) => snapshot.pauseReason === 'rate-limit' && snapshot.retryAt > Date.now(), 'Retry-After was not honored');
  const requestCount = globalThis.__crateFixture.requests.length;
  await send({ type: 'resume' });
  assert.equal(globalThis.__crateFixture.requests.length, requestCount, 'Resume must not bypass Retry-After.');
  await new Promise((done) => setTimeout(done, Math.max(0, state.retryAt - Date.now()) + 100));
  await send({ type: 'resume' });
  await until((snapshot) => snapshot.library?.collectionComplete && !snapshot.jobs.some((job) => ['queued', 'running'].includes(job.status)), 'Rate-limited queue did not resume');
  globalThis.__crateFixture.mode = 'captcha';
  await send({ type: 'sync' });
  state = await until((snapshot) => snapshot.paused && snapshot.pauseReason === 'captcha', 'CAPTCHA did not pause the queue');
  await send({ type: 'resume' });
  await until((snapshot) => snapshot.library?.collectionComplete && !snapshot.jobs.some((job) => ['queued', 'running'].includes(job.status)), 'CAPTCHA recovery did not resume');
  report.passed.push('Retry-After prevents early requests; CAPTCHA pauses the queue and recovery resumes it.');
  assert.deepEqual(report.errors, [], 'Unexpected UI runtime errors.');
  console.log('Browser fixture smoke passed: ' + report.passed.length + ' scenarios.');
  }
} catch (error) {
  report.errors.push(error.stack || String(error));
  console.error(error);
  if (page && !page.isClosed()) await screenshot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  if (!report.errors.length) await rm(resolve(output, 'failure.png'), { force: true });
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(profileDir, { recursive: true, force: true });
}
