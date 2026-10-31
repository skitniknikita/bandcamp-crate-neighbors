import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'store-assets');
const iconDir = path.join(root, 'public/icons');
const rawDir = path.join(output, 'raw');
for (const folder of [output, iconDir, rawDir, path.join(output, 'en'), path.join(output, 'ru')]) await fs.mkdir(folder, { recursive: true });
const pngData = async (file) => 'data:image/png;base64,' + (await fs.readFile(file)).toString('base64');
const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
function mark(inverse = false) {
  const front = inverse ? '#F6F8FA' : '#4059C7', back = inverse ? '#9BADEB' : '#CBD8E6', shade = inverse ? '#DCE3F8' : '#263C95', disc = inverse ? '#4059C7' : '#F4F6FC';
  return '<rect x="5" y="11" width="33" height="38" rx="3" fill="' + back + '"/>'
    + '<rect x="13" y="6" width="36" height="38" rx="3" fill="' + front + '"/>'
    + '<path d="M13 29 49 17v27H13Z" fill="' + shade + '"/>'
    + '<circle cx="31" cy="24" r="11" fill="' + disc + '"/><circle cx="31" cy="24" r="5" fill="' + front + '"/><circle cx="31" cy="24" r="1.4" fill="' + disc + '"/>'
    + '<path d="M17 36h12" stroke="' + (inverse ? '#9BADEB' : '#A8B8EF') + '" stroke-width="2"/>';
}
const logo = (size = 48, inverse = false) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 56 56" fill="none">' + mark(inverse) + '</svg>';
const normalizedIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none"><g transform="translate(16 16) scale(2.1818181818) translate(-5 -6)">' + mark() + '</g></svg>';
await fs.writeFile(path.join(iconDir, 'icon.svg'), normalizedIcon + '\n');
await fs.writeFile(path.join(output, 'brand-mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56" fill="none">' + mark() + '</svg>\n');
let fontCss = '';
for (const weight of [400, 500, 600]) for (const subset of ['latin', 'cyrillic']) {
  const bytes = await fs.readFile(path.join(root, 'node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-' + subset + '-' + weight + '-normal.woff2'));
  const range = subset === 'latin' ? 'U+0000-024F,U+2000-206F,U+20A0-20CF,U+2190-21FF' : 'U+0400-052F';
  fontCss += '@font-face{font-family:Plex;src:url(data:font/woff2;base64,' + bytes.toString('base64') + ') format("woff2");font-style:normal;font-weight:' + weight + ';unicode-range:' + range + ';}';
}
const baseCss = fontCss + '*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Plex,sans-serif;color:#17243C;-webkit-font-smoothing:antialiased}svg{display:block;flex-shrink:0}h1,h2,p{margin:0}';
const html = (content, css = '') => '<!doctype html><html><head><meta charset="utf-8"><style>' + baseCss + css + '</style></head><body>' + content + '</body></html>';
const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: Number(process.env.STORE_ASSET_PORT || 5186), strictPort: true, open: false } });
await server.listen();
const origin = 'http://127.0.0.1:' + server.config.server.port;
let executablePath = process.env.CHROME_PATH;
if (!executablePath) { const candidate = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; try { await fs.access(candidate); executablePath = candidate; } catch {} }
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const assets = [], errors = [];
function record(file, width, height, field, extra = {}) { assets.push({ file: path.relative(root, file).split(path.sep).join('/'), width, height, field, ...extra }); }
async function render(file, width, height, markup, transparent = false) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(markup, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: transparent });
  await page.close();
}
async function isolate(page) {
  await page.route('**/*', route => { const url = route.request().url(); return url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort(); });
  page.on('pageerror', error => errors.push(error.message));
}
try {
  record(path.join(iconDir, 'icon.svg'), 128, 128, 'Editable SVG master for normalized extension icons', { alpha: true, source: 'Original overlapping record-sleeve mark, same geometry as App.BrandMark.' });
  record(path.join(output, 'brand-mark.svg'), 56, 56, 'Editable SVG mark for website layouts', { alpha: true, source: 'Original App.BrandMark geometry without normalized icon padding.' });
  for (const size of [16, 32, 48, 128, 512]) {
    const file = path.join(iconDir, 'icon-' + size + '.png');
    await render(file, size, size, html(normalizedIcon, 'html,body{background:transparent}svg{width:100vw;height:100vh}'), true);
    record(file, size, size, size === 128 ? 'Chrome Web Store extension icon; manifest icon' : 'Manifest / brand icon', { alpha: true, artworkBounds: size === 128 ? { x: 16, y: 16, width: 96, height: 94 } : 'Normalized 75% footprint' });
  }
  const raw = {};
  for (const language of ['en', 'ru']) {
    const page = await browser.newPage({ viewport: { width: 440, height: 1040 }, deviceScaleFactor: 2 });
    await isolate(page); await page.goto(origin + '/sidepanel.html'); await page.waitForSelector('.music-result');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.evaluate(async lang => {
      const demo = await import('/src/demo.ts');
      demo.demoSnapshot.profile.name = lang === 'en' ? 'Example collection' : 'Пример коллекции';
      demo.demoSnapshot.profile.username = 'example-collection';
      demo.demoSnapshot.profile.collectionCount = Object.keys(demo.demoSnapshot.library.collection).length;
      demo.demoSnapshot.paused = false; demo.demoSnapshot.jobs[0].progress = 4; demo.demoSnapshot.jobs[0].total = 4;
      demo.demoSnapshot.jobs[0].label = lang === 'en' ? 'Example collection' : 'Пример коллекции';
      // Keep example full counts consistent with the four-item example purchase library.
      for (const [index, match] of demo.demoSnapshot.matches.entries()) match.totalSharedPurchases = [4, 3, 2][index];
    }, language);
    await page.getByRole('button', { name: language === 'en' ? 'English' : 'Русский', exact: true }).click();
    await page.evaluate(() => document.fonts.ready); raw[language] = {};
    const capture = async (name, selector) => {
      const file = path.join(rawDir, name + '-' + language + '.png');
      await page.locator(selector).screenshot({ path: file }); raw[language][name] = await pngData(file);
      const bytes = await fs.readFile(file);
      record(file, bytes.readUInt32BE(16), bytes.readUInt32BE(20), 'Source capture — not a store upload', { language, captureScale: 2, source: 'Actual product component captured at 2×, isolated synthetic example collection', demo: true });
    };
    await capture('settings', '.settings-content');
    await page.getByRole('button', { name: language === 'en' ? 'Collectors' : 'Коллекционеры', exact: true }).click(); await capture('collectors', '.results-section');
    await page.getByRole('button', { name: language === 'en' ? 'See shared records' : 'Показать общие релизы', exact: true }).first().click(); await capture('shared', '.collector-list .collector:first-child');
    await page.getByRole('button', { name: language === 'en' ? 'Choose records' : 'Выбрать релизы', exact: true }).click(); await capture('seeds', '.seed-editor');
    await page.getByRole('button', { name: language === 'en' ? 'Close' : 'Закрыть', exact: true }).click();
    await page.getByRole('button', { name: language === 'en' ? 'Music' : 'Музыка', exact: false }).first().click(); await capture('music', '.results-section');
    await page.getByRole('button', { name: language === 'en' ? 'Queue' : 'Очередь', exact: true }).click(); await capture('queue', '.queue-content'); await page.close();
    // Actual onboarding component, empty state, no collection or profile data.
    const onboarding = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }); await isolate(onboarding);
    await onboarding.addInitScript(lang => {
      const empty = { settings: { language: lang }, seeds: [], matches: [], recommendations: [], jobs: [], paused: false, searchStarted: false, hiddenFanCount: 0, hiddenReleaseCount: 0, candidateCount: 0, checkedCount: 0 };
      window.chrome = { runtime: { id: 'isolated-empty-onboarding', sendMessage: async () => ({ ok: true, snapshot: empty }) } };
    }, language);
    await onboarding.goto(origin + '/sidepanel.html'); await onboarding.waitForSelector('.onboarding'); await onboarding.evaluate(() => document.fonts.ready);
    const file = path.join(rawDir, 'onboarding-' + language + '.png'); await onboarding.screenshot({ path: file });
    record(file, 1280, 800, 'Optional raw Chrome Web Store screenshot', { language, source: 'Actual product UI; empty isolated onboarding state; no collection data', demo: false }); await onboarding.close();
  }
  const copy = {
    en: {
      example:'Example collection', footer:'Actual product views. Example records and collectors.',
      collectors:{title:'Find your people.',text:'Meet collectors who share your records. Explore their shelves, then follow them on Bandcamp.',note:'Real overlap. Clear reasons. A profile worth opening.'},
      music:{title:'Discover what they discovered.',text:'Find records from matching collections that are not already in your purchases or wishlist.',note:'Every recommendation shows where it came from.'},
      shared:{title:'See what you share.',text:'Bandcamp’s shared-purchase count stays separate from the titles checked so far.',note:'Full counts when available. Partial coverage stays visible.'},
      seeds:{title:'Your collection. Your wishlist. Your taste.',text:'Start with records you own and records you want. Choose the releases that lead the search.',note:'Change your starting records whenever you like.'},
      privacy:{title:'Your digging stays in your browser.',text:'Collection data is processed locally. Pause the queue and pick up where you left off.',note:'No separate account. No subscription. No daily scan limit.'},
    },
    ru: {
      example:'Пример коллекции',footer:'Настоящий интерфейс. Релизы и коллекционеры — примеры.',
      collectors:{title:'Найди своих.',text:'Познакомься с коллекционерами, у которых есть твои любимые релизы. Исследуй их полки и подпишись на Bandcamp.',note:'Общие релизы, понятные причины и новые знакомства.'},
      music:{title:'Послушай их находки.',text:'Открой музыку из похожих коллекций, которой ещё нет в твоих покупках и wishlist.',note:'У каждой рекомендации есть понятный источник.'},
      shared:{title:'Посмотри, что у вас общего.',text:'Счётчик общих покупок Bandcamp показан отдельно от уже проверенных названий.',note:'Полный счётчик — когда доступен. Охват проверки — всегда виден.'},
      seeds:{title:'Твои покупки. Твой wishlist. Твой вкус.',text:'Начни с того, что любишь и что хочешь купить. Выбери релизы, которые зададут направление поиска.',note:'Стартовые релизы можно менять в любой момент.'},
      privacy:{title:'Весь поиск — в твоём браузере.',text:'Коллекции обрабатываются локально. Поставь очередь на паузу и продолжи с того же места.',note:'Без отдельного аккаунта, подписки и суточного лимита.'},
    },
  };
  const screenCss = '.canvas{position:relative;width:1280px;height:800px;background:#F6F8FA;overflow:hidden}.brand{position:absolute;top:46px;left:56px;display:flex;align-items:center;gap:10px;font-weight:500;font-size:20px;letter-spacing:-.4px}.brand small{display:block;font-size:14px;font-weight:400;color:#6C7A91;margin-top:3px}.copy{position:absolute;left:64px;top:204px;width:472px}.copy h1{font-size:55px;line-height:1.06;letter-spacing:-2.2px;font-weight:500;max-width:475px}.copy p{font-size:21px;line-height:1.48;color:#627087;margin-top:26px;max-width:440px}.copy .note{font-size:17px;line-height:1.45;color:#4059C7;margin-top:30px;max-width:414px}.screen{position:absolute;left:628px;top:45px;width:592px;height:710px;background:white;border:1px solid #CED8E5;border-radius:10px;overflow:hidden;box-shadow:0 12px 35px #17243C0E}.screen-caption{height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;background:#EDF1F8;color:#60738E;font-size:14px;border-bottom:1px solid #D8E0E8}.screen-caption span:last-child{color:#4059C7;font-weight:500}.screen-body{padding:23px 22px;overflow:hidden}.screen img{display:block;width:546px;height:auto}.footnote{position:absolute;left:64px;bottom:42px;font-size:12px;color:#7D8A9E}.shared-screen .screen-body{padding-top:27px}.privacy-screen .screen-body{padding-top:18px}.privacy-screen .queue-image{margin-top:24px;border-top:1px solid #D8E0E8;padding-top:19px}.privacy-screen .privacy-crop{height:300px;overflow:hidden}.privacy-screen .queue-crop{height:285px;overflow:hidden}.seed-screen .screen-body{padding-top:28px}.canvas.ru .copy h1{font-size:53px}.canvas.ru.seeds .copy h1{font-size:49px}.canvas.ru.privacy .copy h1{font-size:50px}';
  const themes = [['01-collectors','collectors'],['02-new-music','music'],['03-shared-counts','shared'],['04-purchases-wishlist','seeds'],['05-local-privacy','privacy']];
  for (const language of ['en','ru']) for (const [filename,theme] of themes) {
    const t=copy[language], item=t[theme];
    const pane=theme==='privacy'?'<div class="privacy-crop"><img src="'+raw[language].settings+'" alt=""></div><div class="queue-crop queue-image"><img src="'+raw[language].queue+'" alt=""></div>':'<img src="'+raw[language][theme]+'" alt="">';
    const content='<div class="canvas '+language+' '+theme+'"><div class="brand">'+logo(47)+'<div>Crate Neighbors<small>for Bandcamp</small></div></div><div class="copy"><h1>'+escape(item.title)+'</h1><p>'+escape(item.text)+'</p><p class="note">'+escape(item.note)+'</p></div><div class="screen '+theme+'-screen"><div class="screen-caption"><span>Crate Neighbors for Bandcamp</span><span>'+t.example+'</span></div><div class="screen-body">'+pane+'</div></div><p class="footnote">'+t.footer+'</p></div>';
    const file=path.join(output,language,filename+'.png'); await render(file,1280,800,html(content,screenCss));
    record(file,1280,800,'Chrome Web Store screenshot '+Number(filename.slice(0,2)),{language,caption:item.title,description:item.text,demo:true,source:'Actual product UI rendered from current src/App.tsx using isolated src/demo.ts example data. Shared-count values are labelled examples. No real user profile or authorization artifacts.'});
  }
  function miniSleeve(index,size=75) {
    const palettes=[['#223745','#C8DCD3','#D5A769'],['#9C472F','#EDC28C','#F2E6C4'],['#E4E8DF','#2A6164','#9CB6A6'],['#33446F','#A8BED9','#DFB199'],['#B6C2CC','#3B4770','#F2EDED'],['#D6B98C','#685968','#F6E1BF']];
    const [a,b,c]=palettes[index%palettes.length];
    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 200 200"><rect width="200" height="200" fill="'+a+'"/><path d="M0 150L200 45V200H0Z" fill="'+b+'"/><circle cx="'+(62+index*8)+'" cy="70" r="42" fill="'+c+'"/><path d="M10 175H190M10 182H190" stroke="'+a+'" stroke-width="2"/></svg>';
  }
  const smallFile=path.join(output,'promo-small-440x280.png');
  const smallContent='<div class="promo"><div class="sleeve s1">'+miniSleeve(0,71)+'</div><div class="sleeve s2">'+miniSleeve(2,71)+'</div><div class="sleeve s3">'+miniSleeve(3,71)+'</div><div class="sleeve s4">'+miniSleeve(5,71)+'</div><div class="central">'+logo(198,true)+'</div><div class="wordmark">Crate Neighbors<span>for Bandcamp</span></div></div>';
  await render(smallFile,440,280,html(smallContent,'.promo{position:relative;width:440px;height:280px;background:#4059C7;overflow:hidden}.central{position:absolute;left:122px;top:18px;z-index:2}.sleeve{position:absolute;box-shadow:0 7px 20px #17243C18}.s1{left:24px;top:29px;transform:rotate(-11deg)}.s2{right:23px;top:41px;transform:rotate(9deg)}.s3{left:30px;top:127px;transform:rotate(6deg)}.s4{right:30px;top:139px;transform:rotate(-8deg)}.wordmark{position:absolute;bottom:22px;left:0;width:100%;color:#fff;font-size:24px;font-weight:500;letter-spacing:-.6px;text-align:center}.wordmark span{display:block;font-size:12px;font-weight:400;letter-spacing:0;color:#D6DEF8;margin-top:1px}'));
  record(smallFile,440,280,'Chrome Web Store small promotional image',{language:'Non-localized English wordmark',source:'Original code-native brand illustration. No product-result claims.'});
  const marqueeFile=path.join(output,'promo-marquee-1400x560.png');
  const marqueeContent='<div class="marquee"><div class="wordmark"><span>Crate Neighbors</span><small>for Bandcamp</small></div><div class="records"><div class="rear rear1">'+miniSleeve(0,172)+'</div><div class="rear rear2">'+miniSleeve(1,142)+'</div><div class="rear rear3">'+miniSleeve(4,148)+'</div><div class="rear rear4">'+miniSleeve(2,128)+'</div><div class="main-mark">'+logo(410,true)+'</div></div><div class="small-mark">'+logo(62,true)+'</div></div>';
  await render(marqueeFile,1400,560,html(marqueeContent,'.marquee{width:1400px;height:560px;position:relative;background:#4059C7;overflow:hidden}.wordmark{position:absolute;left:76px;top:210px;color:#fff;z-index:3}.wordmark>span{font-size:65px;font-weight:500;letter-spacing:-2.4px}.wordmark small{display:block;font-size:27px;color:#D6DEF8;margin-top:8px}.records{position:absolute;right:30px;top:0;width:640px;height:560px}.main-mark{position:absolute;top:64px;left:112px;z-index:3}.rear{position:absolute;box-shadow:0 10px 26px #17243C18}.rear1{left:18px;top:49px;transform:rotate(-11deg)}.rear2{right:14px;top:43px;transform:rotate(9deg)}.rear3{right:25px;bottom:34px;transform:rotate(-7deg)}.rear4{left:29px;bottom:35px;transform:rotate(7deg)}.small-mark{position:absolute;top:56px;left:69px}'));
  record(marqueeFile,1400,560,'Chrome Web Store marquee promotional image',{language:'Non-localized English wordmark',source:'Original code-native brand illustration. No product-result claims.'});
  const ogFile=path.join(output,'social-og-1200x630.png');
  const ogContent='<div class="og"><div class="og-brand">'+logo(49)+'<span>Crate Neighbors for Bandcamp</span></div><div class="og-copy"><h1>Find your people.<br>Discover their records.</h1><p>Music discovery through the collections<br>of people with taste like yours.</p></div><div class="og-free">Free Chrome extension. Runs locally.</div><div class="og-right"><div class="og-label">Example collection</div><div class="og-ui"><img src="'+raw.en.music+'" alt=""></div></div></div>';
  await render(ogFile,1200,630,html(ogContent,'.og{width:1200px;height:630px;background:#F6F8FA;position:relative;overflow:hidden}.og-brand{position:absolute;left:53px;top:43px;display:flex;align-items:center;gap:10px;font-size:20px;font-weight:500;letter-spacing:-.4px}.og-copy{position:absolute;top:197px;left:62px;width:600px}.og-copy h1{font-size:56px;line-height:1.1;font-weight:500;letter-spacing:-2px}.og-copy p{font-size:23px;line-height:1.5;color:#627087;margin-top:27px}.og-free{position:absolute;left:62px;bottom:54px;color:#4059C7;font-size:18px}.og-right{position:absolute;right:0;top:0;width:458px;height:630px;background:#4059C7;padding:43px 32px 0}.og-label{color:#D6DEF8;font-size:14px;margin-bottom:15px}.og-ui{background:#F6F8FA;padding:23px;overflow:hidden;height:600px;border-radius:7px 7px 0 0;box-shadow:0 8px 28px #17243C20}.og-ui img{display:block;width:348px;height:auto}'));
  record(ogFile,1200,630,'GitHub Pages / social Open Graph image',{language:'en',demo:true,source:'Original brand layout and actual product UI with clearly labelled example collection.'});
  const manifest={product:'Crate Neighbors for Bandcamp',generatedBy:'node scripts/store-assets.mjs',sourcePolicy:'Only local brand vectors, locally packaged IBM Plex Sans and isolated example/empty UI states are used. No authorized-check artifacts, browsing profile, real collection, cookies or downloaded album artwork are read.',guidelines:'https://developer.chrome.com/docs/webstore/images',uploads:{extensionIcon:'public/icons/icon-128.png',smallPromotional:'store-assets/promo-small-440x280.png',marquee:'store-assets/promo-marquee-1400x560.png',screenshots:'Upload en/01–05 to English and ru/01–05 to Russian. Do not upload raw component crops; optional raw/onboarding-*.png are standalone 1280×800 product screenshots.'},assets};
  await fs.writeFile(path.join(output,'assets-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await fs.writeFile(path.join(output,'README.md'),'# Store images\n\nRun node scripts/store-assets.mjs from the project root after npm ci. Playwright uses installed Google Chrome on macOS, or its Chromium otherwise. CHROME_PATH selects an executable; STORE_ASSET_PORT overrides isolated Vite port 5186.\n\n- en/01–05 and ru/01–05: localized 1280×800 screenshots in upload order.\n- promo-small-440x280.png: small promotional tile.\n- promo-marquee-1400x560.png: marquee image.\n- social-og-1200x630.png: website/social preview.\n- raw/onboarding-en.png and raw/onboarding-ru.png: unmodified product onboarding, empty isolated state, no collection data.\n- Other raw/ files are component captures used in compositions, not store uploads.\n- ../public/icons/icon-128.png: transparent icon with 16px horizontal padding and 96px artwork. Other sizes share the mark and normalized padding.\n\nCollection views are explicitly labelled examples. No private profiles, authorization artifacts, external artwork, fabricated ratings or testimonials are used. The full-count example separates the Bandcamp purchase count from sampled titles and does not claim a global wishlist counter. See assets-manifest.json for dimensions, captions, provenance and store fields.\n');
  if(errors.length)throw new Error('Product UI errors: '+errors.join('; '));
  console.log(JSON.stringify({generated:assets.length,output,errors}));
} finally { await browser.close(); await server.close(); }
