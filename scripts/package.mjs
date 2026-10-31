import { readFile, stat, readdir, mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = resolve(root, 'dist');
const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));
const defaultMessages = JSON.parse(await readFile(resolve(dist, '_locales', manifest.default_locale, 'messages.json'), 'utf8'));
const localize = (value) => value.replace(/__MSG_(\w+)__/g, (_match, key) => {
  if (!defaultMessages[key]?.message) throw new Error('Missing default message: ' + key);
  return defaultMessages[key].message;
});
const displayName = localize(manifest.name);
for (const language of ['en', 'ru']) {
  const messages = JSON.parse(await readFile(resolve(dist, '_locales', language, 'messages.json'), 'utf8'));
  if (!messages.extensionName?.message.includes('Bandcamp')) throw new Error('The extension title must include Bandcamp.');
  if (!messages.extensionDescription?.message || messages.extensionDescription.message.length > 132) throw new Error('The store summary must be 1–132 characters: ' + language);
}
const expectedHosts = ['https://bandcamp.com/*', 'https://*.bandcamp.com/*'];
if (manifest.manifest_version !== 3 || manifest.background?.type !== 'module') throw new Error('Expected Manifest V3 and a module service worker.');
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(expectedHosts)) throw new Error('Unexpected host permissions. Only Bandcamp is allowed.');
if (manifest.permissions.some((permission) => !['storage', 'alarms', 'sidePanel', 'activeTab', 'scripting'].includes(permission))) throw new Error('Unexpected extension permission.');
const required = [manifest.background.service_worker, manifest.side_panel.default_path, ...manifest.content_scripts.flatMap((entry) => entry.js), ...Object.values(manifest.icons)];
for (const name of required) await stat(resolve(dist, name));
await mkdir(resolve(dist, 'licenses'), { recursive: true });
const thirdParty = [];
for (const name of ['react', 'react-dom', 'scheduler', 'idb', 'htmlparser2', 'domutils', 'domhandler', 'domelementtype', 'dom-serializer', 'entities', '@fontsource/ibm-plex-sans', 'rolldown']) {
  const packageDir = resolve(root, 'node_modules', name);
  const metadata = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'));
  const licenseName = name.replaceAll('/', '-') + '.txt';
  await copyFile(resolve(packageDir, 'LICENSE'), resolve(dist, 'licenses', licenseName));
  thirdParty.push({ name, version: metadata.version, license: metadata.license, notice: 'licenses/' + licenseName });
}
await writeFile(resolve(dist, 'third-party-notices.json'), JSON.stringify(thirdParty, null, 2) + '\n');
await copyFile(resolve(root, 'docs/privacy.md'), resolve(dist, 'privacy.md'));
await writeFile(resolve(dist, 'INSTALL.txt'), [
  displayName + ' ' + manifest.version,
  '',
  'RU: Распакуйте ZIP в постоянную папку. Откройте chrome://extensions, включите',
  'режим разработчика, нажмите «Загрузить распакованное расширение» и выберите эту',
  'папку с manifest.json. Закрепите значок Crate Neighbors for Bandcamp и нажмите его.',
  'Требуется Chrome 120+. Не перемещайте папку после установки.',
  '',
  'EN: Unzip into a permanent folder. Open chrome://extensions, enable Developer',
  'mode, click Load unpacked, and choose this folder containing manifest.json.',
  'Pin and click the Crate Neighbors for Bandcamp icon. Requires Chrome 120+.',
  'Keep this folder in place after installation.',
  '',
  'Local processing; no subscription or analytics. See privacy.md.',
].join('\n') + '\n');
async function list(dir) {
  const items = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of items) {
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in the extension package.');
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...await list(path));
    else files.push(relative(dist, path));
  }
  return files;
}
const files = (await list(dist)).sort();
if (files.some((file) => /(^|\/)(node_modules|\.git)(\/|$)|(^|\/)\.env([./]|$)|\.map$|\.tsx?$/.test(file))) throw new Error('Development files or secrets found in the distribution directory.');
const contentScript = await readFile(resolve(dist, 'content.js'), 'utf8');
if (/(?:^|[;\n])\s*import\s*(?:["'{*]|[A-Za-z_$])/.test(contentScript)) throw new Error('Static content scripts cannot contain module imports.');
await mkdir(resolve(root, 'artifacts'), { recursive: true });
const zipPath = resolve(root, 'artifacts', 'bandcamp-crate-neighbors-' + manifest.version + '.zip');
await rm(zipPath, { force: true });
execFileSync('/usr/bin/zip', ['-q', '-r', zipPath, '.', '-x', '*.DS_Store'], { cwd: dist });
const { size } = await stat(zipPath);
await writeFile(resolve(root, 'artifacts', 'package-report.json'), JSON.stringify({
  name: displayName, version: manifest.version, manifestVersion: manifest.manifest_version,
  minimumChromeVersion: manifest.minimum_chrome_version, permissions: manifest.permissions,
  hostPermissions: manifest.host_permissions, files, zipBytes: size,
}, null, 2) + '\n');
console.log('Packaged ' + relative(root, zipPath) + ' (' + Math.ceil(size / 1024) + ' KiB, ' + files.length + ' files).');
