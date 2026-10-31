import * as bandcamp from './bandcamp';
import { Engine } from './engine';
import { BrowserRepository } from './store';
import { createTransport } from './network';
import type { ApiResponse, Command, Language } from './types';

const repository = new BrowserRepository();
const transport = createTransport(repository);
bandcamp.setTransport(transport);
const engine = new Engine(repository, bandcamp);
let language: Language = chrome.i18n.getUILanguage().startsWith('ru') ? 'ru' : 'en';
let sequence: Promise<unknown> = Promise.resolve();
let pumping = false;

function exclusive<T>(action: () => Promise<T>): Promise<T> {
  const next = sequence.then(action);
  sequence = next.catch(() => undefined);
  return next;
}
const ready = (async () => {
  const settings = await chrome.storage.local.get('language');
  if (settings.language === 'ru' || settings.language === 'en') language = settings.language;
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await engine.recover();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  if (!await chrome.alarms.get('crate-queue')) await chrome.alarms.create('crate-queue', { periodInMinutes: 0.5 });
})();

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    await ready;
    while (await exclusive(() => engine.step())) {
      // Yield between persisted units so UI commands can pause the queue.
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } catch (error) {
    // No response bodies or URLs containing credentials are logged.
    console.error('Crate Neighbors queue:', error instanceof Error ? error.message : 'Unexpected error');
  } finally { pumping = false; }
}
async function activeContext(): Promise<{ profileUrl?: string; releaseUrl?: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('Open a Bandcamp page in the active tab.');
  const url = new URL(tab.url);
  if (url.protocol !== 'https:' || (url.hostname !== 'bandcamp.com' && !url.hostname.endsWith('.bandcamp.com'))) throw new Error('Open a page on bandcamp.com. Custom shop domains are not supported yet.');
  try { return await chrome.tabs.sendMessage(tab.id, { type: 'crate-page-context' }); }
  catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tab.id, { type: 'crate-page-context' });
  }
}
const commandTypes = new Set(['snapshot', 'connect', 'sync', 'start-search', 'continue-search', 'pause', 'resume', 'add-current', 'restore-hidden', 'refresh', 'check-counts', 'set-seeds', 'add-release', 'deepen', 'cancel-job', 'hide-fan', 'hide-release', 'settings']);
function validate(command: Command) {
  if (!command || !commandTypes.has(command.type)) throw new Error('Unknown command.');
  if ('url' in command && command.url !== undefined && typeof command.url !== 'string') throw new Error('Invalid URL.');
  if (command.type === 'set-seeds' && (!Array.isArray(command.keys) || command.keys.some(k => typeof k !== 'string'))) throw new Error('Invalid starting releases.');
  if ('fanId' in command && command.fanId !== undefined && (!Number.isSafeInteger(command.fanId) || command.fanId <= 0)) throw new Error('Invalid collector.');
  if (command.type === 'hide-release' && typeof command.key !== 'string') throw new Error('Invalid release.');
  if (command.type === 'cancel-job' && typeof command.id !== 'string') throw new Error('Invalid job.');
}
async function dispatch(command: Command): Promise<ApiResponse> {
  try {
    await ready;
    validate(command);
    if (command.type === 'settings') {
      if (!['ru', 'en'].includes(command.language)) throw new Error('Unsupported language.');
      language = command.language;
      await chrome.storage.local.set({ language });
    } else if (command.type === 'connect') {
      const url = command.url?.trim() || (await activeContext()).profileUrl;
      if (!url) throw new Error('Could not identify your account. Paste your Bandcamp profile URL.');
      await engine.connect(url);
    } else if (command.type === 'add-current' || command.type === 'add-release') {
      const url = command.type === 'add-release' ? command.url.trim() : (await activeContext()).releaseUrl;
      if (!url) throw new Error('Open a Bandcamp album or track, then try again.');
      await engine.addRelease(await bandcamp.fetchRelease(url));
    } else await engine.command(command);
    return { ok: true, snapshot: await engine.snapshot(language) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unexpected error.' };
  }
}
chrome.runtime.onMessage.addListener((command, sender, respond) => {
  if (sender.id !== chrome.runtime.id || (sender.url && !sender.url.startsWith(chrome.runtime.getURL('')))) {
    respond({ ok: false, error: 'Extension pages only.' });
    return false;
  }
  exclusive(() => dispatch(command)).then(response => {
    respond(response);
    if (command?.type !== 'snapshot') void pump();
  }, () => respond({ ok: false, error: 'Could not open the local database.' }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'crate-queue') void pump(); });
chrome.runtime.onStartup.addListener(() => { void pump(); });
chrome.runtime.onInstalled.addListener(() => { void pump(); });
void ready.then(() => pump());
