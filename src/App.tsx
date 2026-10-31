import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ApiResponse, Command, Job, Language, Match, Release, Snapshot } from './types';
import { count, translator } from './i18n';
import type { CopyKey } from './i18n';
import { demoOnboarding, demoSnapshot, runDemoCommand } from './demo';
import { APP_NAME, APP_VERSION } from './brand';

const isDemo = !(typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function');
type View = 'music' | 'collectors' | 'queue' | 'settings';
type Translate = ReturnType<typeof translator>;
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    settings: <><path d="m9.5 3 .7-1h3.6l.7 1 .6 2.2 2.2.6 2.1-.5 1.8 3.1-1.4 1.6-.5 2.2 1.5 1.7-1.8 3.1-2.1-.5-2.2.6-.7 2.2-.7 1h-3.6l-.7-1-.6-2.2-2.2-.6-2.1.5-1.8-3.1 1.4-1.7.5-2.2-1.5-1.6 1.8-3.1 2.1.5 2.2-.6Z"/><circle cx="12" cy="11" r="3"/></>,
    music: <><path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="5.5" cy="18" rx="3.5" ry="3"/><ellipse cx="16.5" cy="16" rx="3.5" ry="3"/></>,
    people: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/></>,
    queue: <><path d="M7 5h14M7 12h14M7 19h14"/><circle cx="3" cy="5" r=".5"/><circle cx="3" cy="12" r=".5"/><circle cx="3" cy="19" r=".5"/></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    pause: <path d="M8 5v14M16 5v14"/>,
    play: <path d="m8 4 12 8-12 8Z"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    local: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></>,
    refresh: <><path d="M20 9a8 8 0 0 0-14-4L3 8M3 3v5h5M4 15a8 8 0 0 0 14 4l3-3M21 21v-5h-5"/></>,
    down: <path d="m6 9 6 6 6-6"/>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.info}</svg>;
}
function BrandMark({ large = false }: { large?: boolean }) {
  return <svg className={large ? 'brand-mark brand-mark-large' : 'brand-mark'} viewBox="0 0 56 56" fill="none" aria-hidden="true">
    <rect x="5" y="11" width="33" height="38" rx="3" fill="#CBD8E6"/>
    <rect x="13" y="6" width="36" height="38" rx="3" fill="#4059C7"/>
    <path d="M13 29 49 17v27H13Z" fill="#263C95"/>
    <circle cx="31" cy="24" r="11" fill="#F4F6FC"/><circle cx="31" cy="24" r="5" fill="#4059C7"/><circle cx="31" cy="24" r="1.4" fill="#F4F6FC"/>
    <path d="M17 36h12" stroke="#A8B8EF" strokeWidth="2"/>
  </svg>;
}
function safeLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'bandcamp.com' || url.hostname.endsWith('.bandcamp.com')) ? url.href : 'https://bandcamp.com';
  } catch { return 'https://bandcamp.com'; }
}
function Cover({ release, small = false }: { release: Release; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [release.artUrl]);
  const allowed = release.artUrl && (/^https:\/\/[^/]+\.bcbits\.com\//.test(release.artUrl) || (isDemo && release.artUrl.startsWith('data:image/svg+xml')));
  return <span className={'cover' + (small ? ' cover-small' : '')}>
    {allowed && !failed ? <img src={release.artUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : <span className="cover-fallback"><span/></span>}
  </span>;
}
function ExternalLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return <a className={className} href={safeLink(href)} target="_blank" rel="noopener noreferrer">{children}</a>;
}
function EmptyState({ title, text, icon = 'music' }: { title: string; text: string; icon?: string }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name={icon} size={28}/></div><h3>{title}</h3><p>{text}</p></div>;
}
function StatProgress({ label, loaded, total, complete, language }: { label: string; loaded: number; total: number; complete: boolean; language: Language }) {
  const expected = Math.max(total, loaded);
  return <div className="sync-progress">
    <div><span>{label}</span><span>{count(loaded,language)} / {count(expected,language)} {complete && <Icon name="check" size={13}/>}</span></div>
    <progress value={complete ? 1 : Math.min(loaded,expected)} max={complete ? 1 : Math.max(expected,1)} aria-label={label}/>
  </div>;
}
function ReleaseLine({ release, children }: { release: Release; children?: ReactNode }) {
  return <div className="release-line"><Cover release={release} small/><span className="release-line-copy"><ExternalLink href={release.url}>{release.title}</ExternalLink><span>{release.artist}</span></span>{children}</div>;
}
function MatchCard({ match, t, language, busy, send }: { match: Match; t: Translate; language: Language; busy: boolean; send: (command: Command) => Promise<boolean> }) {
  const [expanded, setExpanded] = useState(false);
  const { fan } = match;
  const initials = fan.name.split(/\s+/).map(x=>x[0]).join('').slice(0,2);
  return <article className="collector" aria-label={fan.name}>
    <header className="collector-head"><span className="avatar">{initials}</span><div className="collector-name"><h3><ExternalLink href={fan.url}>{fan.name}</ExternalLink></h3><span>@{fan.username}</span></div><button className="icon-button hide-button" title={t('hideFan')} aria-label={t('hideFan') + ': ' + fan.name} onClick={()=>void send({type:'hide-fan',fanId:fan.id})} disabled={busy}><Icon name="close" size={16}/></button></header>
    <div className="match-evidence"><span><span className="evidence-number">{match.totalSharedPurchases===undefined?'≥ ':''}{count(match.totalSharedPurchases??match.purchases.length,language)}</span>{t('sharedPurchasesLabel')}</span><span><span className="evidence-number">{count(match.wishlist.length,language)}</span>{t('wishlistMatchesLabel')}</span></div>
    <p className="small muted count-source">{match.totalSharedPurchases===undefined?t('sampleCountHint'):t('bandcampCountHint')}</p>
    <button className="text-button shared-toggle" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>{expanded?t('hideShared'):t('showShared')}<span className={expanded?'chevron-open':''}><Icon name="down" size={14}/></span></button>
    {expanded && <div className="shared-releases">
      {match.purchases.length>0 && <><h4>{t('commonPurchases',{n:match.purchases.length})}</h4>{match.purchases.map(release=><ReleaseLine release={release} key={'p'+release.key}/>)}</>}
      {match.wishlist.length>0 && <><h4>{t('commonWishlist',{n:match.wishlist.length})}</h4>{match.wishlist.map(release=><ReleaseLine release={release} key={'w'+release.key}/>)}</>}
    </div>}
    <div className="coverage"><Icon name={match.complete?'check':'info'} size={13}/><span>{match.complete?t('completeCollection',{n:count(match.examined,language)}):t('checkedCollection',{checked:count(match.examined,language),total:count(Math.max(match.total,match.examined),language)})}</span>{match.stale&&<span title={t('stale')} className="stale-dot"/>}</div>
    <div className="collector-discoveries"><h4>{t('discoveries')}</h4>{match.discoveries.length?match.discoveries.slice(0,3).map(release=><ReleaseLine key={release.key} release={release}/>):<p className="muted small">{t('noDiscovery')}</p>}</div>
    <footer className="collector-actions"><ExternalLink className="button button-primary button-small" href={fan.url}>{t('openProfile')}<Icon name="arrow" size={14}/></ExternalLink>{!match.complete&&<button className="text-button" onClick={()=>void send({type:'deepen',fanId:fan.id})} disabled={busy}>{t('deepen')}</button>}</footer>
  </article>;
}
const kindLabels: Record<Job['kind'], CopyKey> = {
  'sync-profile':'jobSyncProfile','sync-collection':'jobSyncCollection','sync-wishlist':'jobSyncWishlist',
  'sync-following':'jobSyncFollowing',supporters:'jobSupporters',fan:'jobFan','fan-counts':'jobFanCounts',
};
const statusLabels: Record<Job['status'], CopyKey> = {
  queued:'statusQueued',running:'statusRunning',done:'statusDone',cancelled:'statusCancelled',failed:'statusFailed',
};

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot|null>(()=>isDemo?(new URLSearchParams(location.search).has('onboarding')?demoOnboarding():structuredClone(demoSnapshot)):null);
  const [view, setView] = useState<View>('music');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [releaseUrl, setReleaseUrl] = useState('');
  const [seedEditor, setSeedEditor] = useState(false);
  const [seedKeys, setSeedKeys] = useState<string[]>([]);
  const [seedQuery, setSeedQuery] = useState('');
  const [musicLimit, setMusicLimit] = useState(20);
  const [collectorLimit, setCollectorLimit] = useState(20);
  const [minShared, setMinShared] = useState(0);
  const polling = useRef(false);
  const mounted = useRef(true);
  const language = snapshot?.settings.language || (navigator.language.startsWith('ru')?'ru':'en');
  const t = useMemo(()=>translator(language),[language]);
  const send = useCallback(async (command: Command):Promise<boolean>=>{
    setBusy(true);setError('');
    try {
      const response: ApiResponse = isDemo ? runDemoCommand(command) : await chrome.runtime.sendMessage(command);
      if(!mounted.current)return false;
      if(!response || !response.ok) throw new Error(response?.error || 'The extension did not respond. Reload it on chrome://extensions.');
      if(response.snapshot)setSnapshot(response.snapshot);
      return true;
    } catch(err) { if(mounted.current)setError(err instanceof Error?err.message:String(err));return false; }
    finally { if(mounted.current)setBusy(false); }
  },[]);
  useEffect(()=>{
    mounted.current=true;
    if(isDemo)return ()=>{mounted.current=false;};
    const load=async()=>{
      if(polling.current)return;
      polling.current=true;
      try {
        const response: ApiResponse = await chrome.runtime.sendMessage({type:'snapshot'});
        if(mounted.current) {
          if(response?.ok&&response.snapshot)setSnapshot(response.snapshot);
          else if(response?.error)setError(response.error);
        }
      } catch(err) { if(mounted.current)setError(err instanceof Error?err.message:String(err)); }
      finally { polling.current=false; }
    };
    void load();
    const timer=window.setInterval(()=>void load(),2000);
    return ()=>{mounted.current=false;window.clearInterval(timer);};
  },[]);
  useEffect(()=>{document.documentElement.lang=language;},[language]);
  useEffect(()=>{setMusicLimit(20);setCollectorLimit(20);},[snapshot?.profile?.id]);
  const library=snapshot?.library;
  const ready=!!library?.collectionComplete&&!!library?.wishlistComplete;
  const activeJobs=snapshot?.jobs.filter(job=>job.status==='queued'||job.status==='running')||[];
  const scanActive=activeJobs.some(job=>job.kind==='fan'||job.kind==='supporters');
  const checkingCounts=activeJobs.some(job=>job.kind==='fan-counts');
  const shownMatches=(snapshot?.matches||[]).filter(match=>(match.totalSharedPurchases??match.purchases.length)>=minShared);
  const allSeedOptions=useMemo(()=>{
    const merged=new Map<string,Release>();
    for(const release of [...Object.values(library?.collection||{}),...Object.values(library?.wishlist||{}),...(snapshot?.seeds||[])])merged.set(release.key,release);
    return Array.from(merged.values());
  },[library,snapshot?.seeds]);
  const filteredSeeds=useMemo(()=>{
    const query=seedQuery.trim().toLocaleLowerCase();
    return allSeedOptions.filter(release=>!query||(release.artist+' '+release.title).toLocaleLowerCase().includes(query));
  },[allSeedOptions,seedQuery]);
  const toggleSeed=(key:string)=>setSeedKeys(keys=>keys.includes(key)?keys.filter(x=>x!==key):[...keys,key]);
  const openSeedEditor=()=>{setSeedKeys(snapshot?.seeds.map(x=>x.key)||[]);setSeedQuery('');setSeedEditor(true);};
  const connect=async(event:FormEvent)=>{
    event.preventDefault();
    if(await send({type:'connect',url:profileUrl.trim()})){setProfileUrl('');setView('music');}
  };
  const renderConnectForm=()=> <form className="connect-form" onSubmit={event=>void connect(event)}>
    <label htmlFor="profile-url">{t('profileUrl')}</label>
    <input id="profile-url" type="url" placeholder={t('profilePlaceholder')} value={profileUrl} onChange={event=>setProfileUrl(event.target.value)} required autoComplete="off" spellCheck={false}/>
    <button className="button button-primary" type="submit" disabled={busy||!profileUrl.trim()}>{busy?<span className="spinner"/>:<Icon name="plus" size={16}/>} {t('connect')}</button>
    <button className="text-button auto-connect" type="button" onClick={()=>void send({type:'connect'})} disabled={busy}><Icon name="search" size={15}/>{t('detect')}</button>
  </form>;
  const initialError=error||snapshot?.error;
  const reasonLabels: Record<string,CopyKey> = {manual:'reasonManual','rate-limit':'reasonRateLimit',network:'reasonNetwork',captcha:'reasonCaptcha',access:'reasonAccess'};
  const cooldown=!!snapshot?.retryAt&&snapshot.retryAt>Date.now();
  const renderSeedEditor=()=> <section className="seed-editor" aria-labelledby="seed-editor-title">
    <div className="section-heading"><h2 id="seed-editor-title">{t('editSeeds')}</h2><button className="icon-button" aria-label={t('close')} onClick={()=>setSeedEditor(false)}><Icon name="close"/></button></div>
    <label className="search-input"><Icon name="search" size={16}/><input autoFocus type="search" placeholder={t('searchLibrary')} aria-label={t('searchLibrary')} value={seedQuery} onChange={event=>setSeedQuery(event.target.value)}/></label>
    <div className="seed-options">
      {filteredSeeds.slice(0,60).map(release=><label className={'seed-option'+(seedKeys.includes(release.key)?' selected':'')} key={release.key}>
        <input type="checkbox" checked={seedKeys.includes(release.key)} onChange={()=>toggleSeed(release.key)}/>
        <Cover release={release} small/><span className="release-line-copy"><strong>{release.title}</strong><span>{release.artist}</span></span>
        <span className="seed-source">{library?.collection[release.key]?t('fromPurchases'):library?.wishlist[release.key]?t('fromWishlist'):''}</span>
      </label>)}
      {filteredSeeds.length===0&&<p className="muted">{t('noLibraryMatches')}</p>}
    </div>
    {filteredSeeds.length>60&&<p className="small muted">{t('seedListLimit')}</p>}
    <footer className="seed-editor-actions"><span className="small muted">{t('selected')}: {seedKeys.length}</span><button className="button button-primary button-small" disabled={busy} onClick={async()=>{if(await send({type:'set-seeds',keys:seedKeys}))setSeedEditor(false);}}>{t('saveSeeds')}</button></footer>
  </section>;
  return <div className={'app'+(!snapshot?.profile?' app-onboarding':'')}>
    {isDemo&&<div className="demo-banner" title={t('demoNotice')}><span>{t('demo')}</span><span>{t('free')}</span></div>}
    <header className="app-header">
      <a href="#music" className="brand" aria-label={APP_NAME} onClick={event=>{event.preventDefault();setView('music');}}><BrandMark/><span><strong>Crate Neighbors</strong><span>{t('appSubtitle')}</span></span></a>
      <button className={'icon-button settings-button'+(view==='settings'?' selected':'')} title={t('settings')} aria-label={t('settings')} aria-pressed={view==='settings'} onClick={()=>{setSeedEditor(false);setView(view==='settings'?'music':'settings');}}><Icon name="settings" size={20}/></button>
    </header>
    {initialError&&<div className="error-banner" role="alert"><Icon name="info"/><div><strong>{t('errorTitle')}</strong><p>{initialError}</p></div><button className="icon-button" aria-label={t('dismiss')} onClick={()=>{setError('');if(snapshot?.error)setSnapshot({...snapshot,error:undefined});}}><Icon name="close" size={15}/></button></div>}
    {!snapshot?<main className="loading-state" aria-live="polite"><span className="spinner"/><p>{t('loading')}</p></main>:
      !snapshot.profile&&view!=='settings'?<main className="onboarding">
        <div className="onboarding-intro"><BrandMark large/><h1>{t('welcomeTitle')}</h1><p>{t('welcomeText')}</p></div>
        <section className="connect-section"><h2>{t('connectTitle')}</h2><p>{t('connectText')}</p>{renderConnectForm()}</section>
        <aside className="privacy-note"><Icon name="shield" size={21}/><div><h3>{t('privacyTitle')}</h3><p>{t('privacyText')}</p></div></aside>
        <p className="compatibility">{t('supported')}</p>
      </main>:<>
      {snapshot.profile&&<div className="profile-strip"><div className="profile-avatar">{snapshot.profile.name.slice(0,1).toUpperCase()}</div><div className="profile-copy"><span>{t('profile')}</span><ExternalLink href={snapshot.profile.url}>{snapshot.profile.name}</ExternalLink></div><span className="local-note" title={t('privacyTitle')}><Icon name="local" size={14}/><span>{t('local')}</span></span></div>}
      {snapshot.profile&&<nav className="main-nav" aria-label="Crate Neighbors"><button aria-current={view==='music'?'page':undefined} onClick={()=>{setView('music');setSeedEditor(false);}}><Icon name="music" size={16}/>{t('music')}{snapshot.recommendations.length>0&&<span className="nav-count">{snapshot.recommendations.length}</span>}</button><button aria-current={view==='collectors'?'page':undefined} onClick={()=>{setView('collectors');setSeedEditor(false);}}><Icon name="people" size={16}/>{t('collectors')}</button><button aria-current={view==='queue'?'page':undefined} onClick={()=>{setView('queue');setSeedEditor(false);}}><Icon name="queue" size={16}/>{t('queue')}{activeJobs.length>0&&<span className="queue-dot"/>}</button></nav>}
      <main className={'main-content view-'+view}>
        {view==='settings'?<section className="settings-content">
          <div className="section-intro"><h1>{t('settingsTitle')}</h1></div>
          <div className="settings-group"><h2>{t('language')}</h2><div className="language-switch" role="group" aria-label={t('language')}><button aria-pressed={language==='ru'} onClick={()=>void send({type:'settings',language:'ru'})} disabled={busy}>Русский</button><button aria-pressed={language==='en'} onClick={()=>void send({type:'settings',language:'en'})} disabled={busy}>English</button></div></div>
          <div className="settings-group"><h2><Icon name="local" size={18}/>{t('dataTitle')}</h2><p>{t('dataText')}</p><p className="small muted">{t('hiddenCounts',{fans:snapshot.hiddenFanCount,releases:snapshot.hiddenReleaseCount})}</p>{snapshot.profile&&<div className="settings-actions"><button className="button button-secondary" disabled={busy} onClick={()=>void send({type:'sync'})}><Icon name="refresh" size={15}/>{t('syncProfile')}</button><button className="button button-secondary" title={t('refreshHint')} disabled={busy} onClick={()=>void send({type:'refresh'})}>{t('refresh')}</button><button className="text-button" disabled={busy||!(snapshot.hiddenFanCount+snapshot.hiddenReleaseCount)} onClick={()=>void send({type:'restore-hidden'})}>{t('restore')}</button></div>}</div>
          <div className="settings-group"><h2>{snapshot.profile?t('switchProfile'):t('connectTitle')}</h2><p>{t('connectText')}</p>{renderConnectForm()}</div>
          <div className="settings-note"><Icon name="shield" size={18}/><p>{t('free')}<br/>{t('supported')}</p></div>
        </section>:<>
        {library&&!ready&&<section className="library-sync" aria-label={t('syncing')}><div className="sync-title"><span className={snapshot.paused?'status-dot':'status-dot status-dot-active'}/><h2>{t('syncing')}</h2></div><p>{t('syncingHint')}</p><StatProgress label={t('purchases')} loaded={Object.keys(library.collection).length} total={library.collectionTotal} complete={library.collectionComplete} language={language}/><StatProgress label={t('wishlist')} loaded={Object.keys(library.wishlist).length} total={library.wishlistTotal} complete={library.wishlistComplete} language={language}/>{!activeJobs.length&&<button className="text-button" disabled={busy} onClick={()=>void send({type:'sync'})}>{t('syncAgain')}</button>}</section>}
        {(snapshot.paused||cooldown)&&<div className="pause-notice" role="status"><Icon name={snapshot.paused?'pause':'refresh'} size={15}/><div><strong>{snapshot.paused?t('paused'):t('waitingRetry')}</strong>{snapshot.pauseReason&&<p>{reasonLabels[snapshot.pauseReason]?t(reasonLabels[snapshot.pauseReason]):snapshot.pauseReason}</p>}{cooldown&&snapshot.retryAt&&<p>{t('retryAt',{time:new Intl.DateTimeFormat(language,{hour:'2-digit',minute:'2-digit'}).format(snapshot.retryAt)})}</p>}</div>{activeJobs.length>0&&snapshot.paused&&<button className="text-button" disabled={busy||cooldown} onClick={()=>void send({type:'resume'})}>{t('resume')}</button>}</div>}
        {!!library?.skippedCount&&<p className="following-note"><Icon name="info" size={14}/>{t('unavailableRecords',{n:library.skippedCount})}</p>}
        {view!=='queue'&&<>
          {seedEditor?renderSeedEditor():<section className="search-start" aria-labelledby="sources-title"><div className="sources-heading"><h2 id="sources-title">{t('sourcesTitle')}</h2><button className="text-button" onClick={openSeedEditor} disabled={busy||!allSeedOptions.length}>{t('editSeeds')}</button></div><p className="small muted">{t('sourcesHint')}</p>
          <div className="seed-strip">{snapshot.seeds.map(release=><span className="seed-sleeve" title={release.artist+' — '+release.title} key={release.key}><Cover release={release}/></span>)}{!snapshot.seeds.length&&<p className="small muted">{t('noSeeds')}</p>}</div>
          <div className="source-actions"><button className="text-button" disabled={busy} onClick={()=>void send({type:'add-current'})}><Icon name="plus" size={14}/>{t('addCurrent')}</button><details className="add-url"><summary>{t('addUrl')}</summary><form onSubmit={async event=>{event.preventDefault();if(await send({type:'add-release',url:releaseUrl.trim()}))setReleaseUrl('');}}><input type="url" aria-label={t('releaseUrl')} placeholder="https://artist.bandcamp.com/album/…" value={releaseUrl} onChange={event=>setReleaseUrl(event.target.value)} required spellCheck={false}/><button className="button button-secondary button-small" disabled={busy||!releaseUrl.trim()}>{t('add')}</button></form></details></div>
          <button className="button button-primary search-button" disabled={busy||!ready||!snapshot.seeds.length||scanActive} title={!ready?t('notReady'):undefined} onClick={()=>void send({type:snapshot.searchStarted?'continue-search':'start-search'})}>{busy?<span className="spinner"/>:<Icon name="search" size={16}/>} {scanActive?t('searching'):snapshot.searchStarted?t('continue'):t('search')}</button>
          </section>}
          {snapshot.searchStarted&&<div className="search-status"><span className={activeJobs.length&&!snapshot.paused?'status-dot status-dot-active':'status-dot'}/><span>{t('checked',{checked:count(snapshot.checkedCount,language),total:count(snapshot.candidateCount,language)})}</span>{activeJobs.length>0&&!snapshot.paused&&<button className="text-button" disabled={busy} onClick={()=>void send({type:'pause'})}>{t('pause')}</button>}</div>}
        </>}
        {view==='music'&&<section className="results-section" aria-labelledby="music-title"><div className="section-intro"><h1 id="music-title">{t('newMusicTitle')}</h1><p>{t('newMusicSubtitle')}</p></div>
          {snapshot.recommendations.length?<><div className="music-list">{snapshot.recommendations.slice(0,musicLimit).map(({release,fans})=><article className="music-result" key={release.key} aria-label={release.title}><ExternalLink className="cover-link" href={release.url}><Cover release={release}/></ExternalLink><div className="music-result-copy"><h3><ExternalLink href={release.url}>{release.title}</ExternalLink></h3><p className="artist">{release.artist}</p><div className="recommendation-reason"><span className="reason-dot"/><span>{t('foundIn',{n:fans.length})}</span></div><div className="contributor-names">{fans.slice(0,3).map((fan,i)=><span key={fan.id}>{i>0?', ':''}<ExternalLink href={fan.url}>{fan.name}</ExternalLink></span>)}{fans.length>3&&' +'+(fans.length-3)}</div><ExternalLink className="listen-link" href={release.url}>{t('listen')}<Icon name="arrow" size={13}/></ExternalLink></div><button className="icon-button hide-button" title={t('hideRelease')} aria-label={t('hideRelease')+': '+release.title} disabled={busy} onClick={()=>void send({type:'hide-release',key:release.key})}><Icon name="close" size={15}/></button></article>)}</div>{musicLimit<snapshot.recommendations.length&&<button className="button button-secondary more-depth" onClick={()=>setMusicLimit(n=>n+20)}>{t('moreMusic')}</button>}</>:<EmptyState title={t('musicEmptyTitle')} text={!snapshot.searchStarted?t('musicEmptyText'):activeJobs.length?t('musicPending'):t('musicNone')}/>}
        </section>}
        {view==='collectors'&&<section className="results-section" aria-labelledby="collectors-title"><div className="section-intro"><h1 id="collectors-title">{t('peopleTitle')}</h1><p>{t('peopleSubtitle')}</p></div>{library&&!library.followingComplete&&<p className="following-note"><Icon name="info" size={14}/>{t('followingIncomplete')}</p>}
          {snapshot.checkedCount>0&&<div className="collector-filters"><label><input type="checkbox" checked={minShared===2} onChange={event=>{setMinShared(event.target.checked?2:0);setCollectorLimit(20);}}/>{t('twoPlusPurchases')}</label><button className="text-button" disabled={busy||checkingCounts} onClick={()=>void send({type:'check-counts'})}>{checkingCounts?t('checkingFullCounts'):t('checkFullCounts')}</button></div>}
          {shownMatches.length?<><div className="collector-list">{shownMatches.slice(0,collectorLimit).map(match=><MatchCard key={match.fan.id} match={match} t={t} language={language} busy={busy} send={send}/>)}</div>{collectorLimit<shownMatches.length&&<button className="button button-secondary more-depth" onClick={()=>setCollectorLimit(n=>n+20)}>{t('moreCollectors')}</button>}<button className="button button-secondary more-depth" disabled={busy} onClick={()=>void send({type:'deepen'})}>{t('deepenBest')}</button></>:<EmptyState icon="people" title={minShared?t('twoPlusEmpty'):t('peopleEmptyTitle')} text={minShared?t('twoPlusHint'):!snapshot.searchStarted?t('peopleEmptyText'):activeJobs.length?t('peoplePending'):t('peopleNone')}/>}
        </section>}
        {view==='queue'&&<section className="queue-content"><div className="section-intro"><h1>{t('queueTitle')}</h1><p>{t('queueSubtitle')}</p></div>{activeJobs.length>0&&<div className="queue-toolbar"><span className="small muted">{t('queueActive',{n:activeJobs.length})}</span><button className="button button-secondary button-small" disabled={busy} onClick={()=>void send({type:snapshot.paused?'resume':'pause'})}><Icon name={snapshot.paused?'play':'pause'} size={14}/>{snapshot.paused?t('resume'):t('pause')}</button></div>}
          {snapshot.jobs.length?<ol className="job-list">{[...snapshot.jobs].sort((a,b)=>{const order={running:0,failed:1,queued:2,done:3,cancelled:4};return order[a.status]-order[b.status];}).map(job=><li key={job.id} className={'job job-'+job.status}><span className="job-status-icon">{job.status==='done'?<Icon name="check" size={16}/>:job.status==='failed'?<Icon name="info" size={16}/>:job.status==='running'&&!snapshot.paused?<span className="spinner"/>:<Icon name="queue" size={15}/>}</span><div className="job-copy"><span className="job-kind">{t(kindLabels[job.kind])}</span><h3>{job.label}</h3><div className="job-meta"><span>{t(statusLabels[job.status])}</span>{(job.progress>0||job.total!==undefined)&&<span>{count(job.progress,language)}{job.total!==undefined?' / '+count(job.total,language):''}</span>}</div>{job.error&&<p className="job-error">{job.error}</p>}</div>{(job.status==='queued'||job.status==='running')&&<button className="icon-button" disabled={busy} aria-label={t('cancelJob')+': '+job.label} title={t('cancelJob')} onClick={()=>void send({type:'cancel-job',id:job.id})}><Icon name="close" size={15}/></button>}</li>)}</ol>:<EmptyState icon="queue" title={t('queueEmpty')} text={t('queueSubtitle')}/>}
        </section>}
        </>}
      </main>
      </>}
    <footer className="app-footer"><span><Icon name="local" size={12}/>{t('local')}</span><span>Crate Neighbors <span className="version">{APP_VERSION}</span></span></footer>
  </div>;
}
