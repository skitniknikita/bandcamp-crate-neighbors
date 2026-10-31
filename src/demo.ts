import type { ApiResponse, Command, Fan, Match, Release, Snapshot } from './types';

function sleeve(index: number) {
  const palettes = [
    ['#223745', '#c8dcd3', '#d5a769'], ['#9c472f', '#edc28c', '#f2e6c4'],
    ['#e4e8df', '#2a6164', '#9cb6a6'], ['#33446f', '#a8bed9', '#dfb199'],
    ['#b6c2cc', '#3b4770', '#f2eded'], ['#d6b98c', '#685968', '#f6e1bf'],
  ];
  const [a,b,c] = palettes[index % palettes.length];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="'+a+'"/><path d="M0 150L200 45V200H0Z" fill="'+b+'"/><circle cx="'+(62+index*8)+'" cy="70" r="42" fill="'+c+'"/><path d="M10 175H190M10 182H190" stroke="'+a+'" stroke-width="2"/></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function release(id: number, title: string, artist: string, index: number): Release {
  return { key:'a:'+id, type:'a', id, title, artist, artistId: Math.floor(id / 10), url:'https://bandcamp.com', artUrl:sleeve(index) };
}
const own = [
  release(11, 'A place between', 'Morrow Patterns', 0),
  release(21, 'Soft focus', 'Still Current', 1),
  release(31, 'Window music', 'Field Archive', 2),
  release(41, 'Long way home', 'Inner Coast', 3),
];
const wished = [release(51,'Night gardens','Asa North',4), release(61,'Small hours','Low Season',5)];
const discoveries = [
  release(71, 'Tidal memory', 'Lena Sol', 2),
  release(81, 'Rooms without doors', 'North of Here', 0),
  release(91, 'After the last train', 'Sora Fields', 3),
  release(101, 'Things left in the light', 'Slow Assembly', 1),
  release(111, 'A map of quiet places', 'Moss Index', 4),
  release(121, 'Warm currents', 'Isla Veil', 5),
];
const fans: Fan[] = [
  {id:1001, username:'sleevenotes',name:'Sleeve Notes',url:'https://bandcamp.com',collectionCount:342},
  {id:1002, username:'lateafternoon',name:'Late Afternoon',url:'https://bandcamp.com',collectionCount:126},
  {id:1003, username:'quietcorners',name:'Quiet Corners',url:'https://bandcamp.com',collectionCount:719},
];
const matches: Match[] = fans.map((fan,i)=>({
  fan,score:0.32-i*.07,purchases:own.slice(0,3-i),wishlist:wished.slice(0,i===0?2:1),
  examined:[200,126,200][i],total:fan.collectionCount,complete:i===1,discoveries:discoveries.slice(i,i+3),stale:false,
}));
const base: Snapshot = {
  settings:{language:'ru'},
  profile:{id:1,username:'yourcollection',name:'Твоя коллекция',url:'https://bandcamp.com',collectionCount:184},
  library:{
    collection:Object.fromEntries(own.map(x=>[x.key,x])),
    wishlist:Object.fromEntries(wished.map(x=>[x.key,x])),
    followingIds:[],collectionComplete:true,wishlistComplete:true,followingComplete:true,
    collectionTotal:4,wishlistTotal:2,
  },
  seeds:[...own,...wished],matches,
  recommendations:discoveries.map((release,i)=>({release,score:.5-i*.03,fans:fans.slice(0,3-i%3).map(({id,name,url})=>({id,name,url}))})),
  jobs:[
    {id:'demo1',kind:'sync-collection',label:'Твоя коллекция',status:'done',progress:184,total:184},
    {id:'demo2',kind:'supporters',label:'A place between',status:'done',progress:50,total:50},
    {id:'demo3',kind:'fan',label:'Quiet Corners',status:'queued',progress:200,total:719,fanId:1003},
  ],
  paused:true,pauseReason:undefined,searchStarted:true,hiddenFanCount:0,hiddenReleaseCount:0,candidateCount:76,checkedCount:50,
};
export let demoSnapshot: Snapshot = structuredClone(base);

export function runDemoCommand(command: Command): ApiResponse {
  switch(command.type) {
    case 'settings': demoSnapshot.settings.language=command.language; break;
    case 'pause': demoSnapshot.paused=true; break;
    case 'resume': demoSnapshot.paused=false; demoSnapshot.pauseReason=undefined; break;
    case 'hide-fan': demoSnapshot.matches=demoSnapshot.matches.filter(x=>x.fan.id!==command.fanId); demoSnapshot.hiddenFanCount++; break;
    case 'hide-release': demoSnapshot.recommendations=demoSnapshot.recommendations.filter(x=>x.release.key!==command.key); demoSnapshot.hiddenReleaseCount++; break;
    case 'restore-hidden':
      demoSnapshot.matches=structuredClone(base.matches);demoSnapshot.recommendations=structuredClone(base.recommendations);
      demoSnapshot.hiddenFanCount=0;demoSnapshot.hiddenReleaseCount=0;break;
    case 'cancel-job': demoSnapshot.jobs=demoSnapshot.jobs.map(x=>x.id===command.id?{...x,status:'cancelled'}:x);break;
    case 'set-seeds': {
      const available=[...Object.values(demoSnapshot.library?.collection||{}),...Object.values(demoSnapshot.library?.wishlist||{}),...demoSnapshot.seeds];
      demoSnapshot.seeds=command.keys.map(key=>available.find(x=>x.key===key)).filter((x):x is Release=>!!x);
      break;
    }
    case 'connect': {
      demoSnapshot=structuredClone(base);
      if(command.url) {
        try { const username=new URL(command.url).pathname.split('/').filter(Boolean)[0];if(username&&demoSnapshot.profile)demoSnapshot.profile={...demoSnapshot.profile,username,name:username}; }
        catch { return {ok:false,error:'Use a Bandcamp profile URL.'}; }
      }
      break;
    }
    case 'deepen':
      demoSnapshot.matches=demoSnapshot.matches.map(x=>!command.fanId||x.fan.id===command.fanId?{...x,examined:x.total,complete:true}:x);break;
    case 'start-search': demoSnapshot.searchStarted=true;demoSnapshot.paused=false;break;
    case 'continue-search': demoSnapshot.checkedCount+=20;demoSnapshot.candidateCount+=30;demoSnapshot.paused=false;break;
    case 'sync':
    case 'refresh': demoSnapshot.jobs.push({id:'demo'+Date.now(),kind:'sync-collection',label:'Demo refresh',status:'done',progress:4,total:4});break;
    case 'add-current':
    case 'add-release': return {ok:false,error:demoSnapshot.settings.language==='ru'?'В демо можно выбирать релизы из примера коллекции. В установленном расширении будут доступны реальные страницы Bandcamp.':'In the demo, choose records from the example collection. Install the extension to add real Bandcamp releases.'};
    case 'snapshot': break;
  }
  return {ok:true,snapshot:structuredClone(demoSnapshot)};
}

export function demoOnboarding(): Snapshot {
  return {settings:{language:'ru'},seeds:[],matches:[],recommendations:[],jobs:[],paused:false,searchStarted:false,hiddenFanCount:0,hiddenReleaseCount:0,candidateCount:0,checkedCount:0};
}
