import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, onSnapshot, collection, getDocs }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
const APP_VERSION = 'v0.4.3';
// Firebase Storage kullanÄ±lmÄ±yor â€” fotoÄŸraflar Firestore'da saklanÄ±yor

// â”€â”€ FIREBASE YAPILANDIRMA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const firebaseConfig = {
  apiKey: "AIzaSyDnlmt4l0o8dBZ4ygX0iiKmBpcgtKn9s1k",
  authDomain: "lichess-takip.firebaseapp.com",
  projectId: "lichess-takip",
  storageBucket: "lichess-takip.firebasestorage.app",
  messagingSenderId: "293092721340",
  appId: "1:293092721340:web:4baa61bad8ba68c60c46b9"
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// â”€â”€ SYNC DURUM GÃ–STERGESI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function setSyncStatus(state, msg){
  const dot=document.getElementById('syncDot'), txt=document.getElementById('syncStatus');
  dot.className='sync-dot '+state; txt.textContent=msg;
}

// â”€â”€ FIRESTORE OKUMA / YAZMA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Veri yapÄ±sÄ±:
//   /panel/config  â†’ { groups, activeGid, criteria }
//   /panel/activity â†’ { [username]: { [date]: { games, puzzles } } }

async function fbLoad(){
  setSyncStatus('syncing','YÃ¼kleniyorâ€¦');
  try{
    // APP.users yÃ¼klenmemiÅŸse son bir kez daha dene
    if(!APP.users){
      try {
        const uSnap = await getDoc(doc(db,'panel','users'));
        if(uSnap.exists()) APP.users = uSnap.data();
      } catch(e) { console.warn('fbLoad users fetch error:', e); }
    }

    // EÄŸer bir kullanÄ±cÄ± seÃ§ilmemiÅŸse (izleme modu), uygun kullanÄ±cÄ±yÄ± seÃ§
    if(!APP.currentUser) {
      const savedUser = localStorage.getItem('lastViewedCoach');
      if (APP.users) {
        const uids = Object.keys(APP.users);
        if (uids.length > 0) {
          if (savedUser && uids.includes(savedUser)) {
            APP.currentUser = savedUser;
          } else {
            // Verisi olan ilk koÃ§u bulmaya Ã§alÄ±ÅŸ
            for (const uid of uids) {
              const checkSnap = await getDoc(doc(db, 'panel', 'config_' + uid));
              if (checkSnap.exists() && checkSnap.data().groups && checkSnap.data().groups.length > 0) {
                APP.currentUser = uid;
                break;
              }
            }
            if(!APP.currentUser) APP.currentUser = uids[0]; // Fallback
          }
        }
      } else if (savedUser) {
        // APP.users yÃ¼klenemese bile (offline/cache), local'den biliyorsak kullan
        APP.currentUser = savedUser;
      }
    }

    // SeÃ§ilen kullanÄ±cÄ±yÄ± her zaman kaydet
    if(APP.currentUser) localStorage.setItem('lastViewedCoach', APP.currentUser);

    // currentUser varsa ona Ã¶zel config yÃ¼kle, yoksa genel 'config' yÃ¼kle
    const cfgKey = APP.currentUser ? 'config_' + APP.currentUser : 'config';
    let cfgSnap = await getDoc(doc(db,'panel',cfgKey));
    
    // Fallback: KullanÄ±cÄ±ya Ã¶zel config yoksa ama kullanÄ±cÄ± varsa, varsayÄ±lan deÄŸerlerle devam et
    const cfg = cfgSnap.exists() ? cfgSnap.data() : null;

    // EÄžER hala boÅŸsa ve APP.currentUser varsa, belki de daha migrate edilmemiÅŸtir, 
    // legacy 'config'i kontrol etmeyi deneyebiliriz.
    let finalCfg = cfg;
    if (!finalCfg && APP.currentUser) {
      const legacySnap = await getDoc(doc(db,'panel','config'));
      if (legacySnap.exists() && legacySnap.data().groups && legacySnap.data().groups.length > 0) {
        finalCfg = legacySnap.data();
      }
    }

    const actSnap = await getDoc(doc(db,'panel','activity'));
    const act = actSnap.exists() ? actSnap.data() : {};

    if(finalCfg && finalCfg.criteria){
      APP.crit = { ...APP.crit, ...finalCfg.criteria };
    }
    APP.configUpdatedAt = finalCfg?.updatedAt || 0;

    if(finalCfg && finalCfg.groups && finalCfg.groups.length > 0){
      APP.groups = finalCfg.groups;
      APP.activeGid = null;
    } else {
      // VarsayÄ±lan grup ayarlarÄ±
      const defaultGid = APP.currentUser ? 'g' + APP.currentUser : 'default';
      APP.groups = [{ id: defaultGid, name: 'A Grubu' }];
      APP.activeGid = null;
    }

    // Ã–ÄŸrenci listelerini yÃ¼kle
    const prefix = APP.currentUser ? APP.currentUser + '_' : '';
    await Promise.all(APP.groups.map(async g => {
      try{
        const key = 'students_' + prefix + g.id;
        let snap = await getDoc(doc(db,'panel',key));
        
        // EÄŸer prefix varsa ama bulunamadÄ±ysa prefix'siz hali (eski veri) dene
        if(!snap.exists() && prefix){
          snap = await getDoc(doc(db,'panel','students_' + g.id));
        }
        
        // HALA bulunamadÄ±ysa ve view-only moddaysak (prefix yoksa), 
        // herhangi bir hocanÄ±n bu g.id'ye sahip listesi var mÄ± diye bakamayÄ±z (gÃ¼venlik/yapÄ± gereÄŸi)
        // Ancak APP.studentLists'i her durumda bir dizi olarak baÅŸlatmalÄ±yÄ±z
        APP.studentLists[g.id] = normalizeStudentList(snap.exists() ? (snap.data().list || []) : (APP.studentLists[g.id] || []));
      } catch(e){
        console.warn(`Grup ${g.id} yÃ¼klenemedi:`, e);
        APP.studentLists[g.id] = normalizeStudentList(APP.studentLists[g.id] || []);
      }
    }));

    APP.actLog = act;
    setSyncStatus('ok','Firebase baÄŸlÄ± âœ“');
    return true;
  } catch(e){
    console.error('Firebase yÃ¼kleme hatasÄ±:',e);
    setSyncStatus('err','BaÄŸlantÄ± hatasÄ±');
    return false;
  }
}

async function fbSaveConfig(){
  try{
    const saveKey=APP.currentUser?'config_'+APP.currentUser:'config';
    APP.configUpdatedAt = Date.now();
    await setDoc(doc(db,'panel',saveKey),{
      groups: APP.groups,
      criteria: APP.crit,
      updatedAt: APP.configUpdatedAt
    });
  }catch(e){ console.warn('Config kayÄ±t hatasÄ±:',e); setSyncStatus('err','KayÄ±t hatasÄ±'); }
}

async function fbSaveStudents(gid){
  try{
    const prefix=APP.currentUser?APP.currentUser+'_':'';
    const list = normalizeStudentList(APP.studentLists[gid] || []);
    APP.studentLists[gid] = list;
    await setDoc(doc(db,'panel','students_'+prefix+gid),{ list, updatedAt: Date.now() });
  }catch(e){ console.warn('Ã–ÄŸrenci kayÄ±t hatasÄ±:',e); }
}

async function fbSaveActivity(){
  try{
    await setDoc(doc(db,'panel','activity'), APP.actLog);
  }catch(e){ console.warn('Aktivite kayÄ±t hatasÄ±:',e); }
}

// GerÃ§ek zamanlÄ± dinleyici â€” baÅŸka cihazdan deÄŸiÅŸiklik olunca gÃ¼ncelle
// students_ dokÃ¼manlari iÃ§in aktif dinleyicileri takip et
const _studentsUnsubMap = {};

function fbListenStudents(groups){
  const prefix = APP.currentUser ? APP.currentUser + '_' : '';
  const neededKeys = new Set(groups.map(g => 'students_' + prefix + g.id));

  // Artik gerekli olmayan dinleyicileri kapat
  for(const key of Object.keys(_studentsUnsubMap)){
    if(!neededKeys.has(key)){ _studentsUnsubMap[key](); delete _studentsUnsubMap[key]; }
  }

  // Yeni gruplar iÃ§in dinleyici ekle
  groups.forEach(g => {
    const key = 'students_' + prefix + g.id;
    if(_studentsUnsubMap[key]) return;

    let _firstSnap = true; // fbLoad zaten yÃ¼kledi, ilk snapshot'Ä± atla
    const unsub = onSnapshot(doc(db,'panel',key), snap => {
      if(_firstSnap){ _firstSnap = false; return; } // ilk tetiklenmeyi atla
      if(!snap.exists()) return;
      const newList = normalizeStudentList(snap.data().list || []);
      const oldList = getStudentList(g.id);
      if(JSON.stringify(newList) === JSON.stringify(oldList)) return;

      APP.studentLists[g.id] = newList;
      renderGroupBar(); renderGrid();
      if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
    });
    _studentsUnsubMap[key] = unsub;
  });
}

function fbListen(){
  const cfgKey = APP.currentUser ? 'config_' + APP.currentUser : 'config';
  let _cfgFirstSnap = true; // ilk snapshot fbLoad'dan gelen veriyle aynÄ±dÄ±r, atla
  onSnapshot(doc(db,'panel',cfgKey), snap=>{
    if(!snap.exists()) return;
    if(_cfgFirstSnap){ _cfgFirstSnap = false; return; } // ilk tetiklenmeyi atla
    const d=snap.data();
    const remoteUpdatedAt = d.updatedAt || 0;
    const changed = JSON.stringify(d.groups)!==JSON.stringify(APP.groups);
    const remoteRefresh = remoteUpdatedAt && remoteUpdatedAt !== APP.configUpdatedAt;
    if(changed || remoteRefresh){
      APP.groups    = d.groups;
      APP.crit      = {...APP.crit,...(d.criteria||{})};
      APP.configUpdatedAt = remoteUpdatedAt;
      Promise.all(APP.groups.map(async g=>{
        try{
          const prefix = APP.currentUser ? APP.currentUser + '_' : '';
          const s = await getDoc(doc(db,'panel','students_'+prefix+g.id));
          if(s.exists()) APP.studentLists[g.id]=normalizeStudentList(s.data().list||[]);
        }catch(e){ console.warn('fbListen grup yuklenemedi:',g.id); }
      })).then(()=>{ 
        renderGroupBar(); 
        renderGrid(); 
        if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
        fbListenStudents(APP.groups);
      });
      renderHeader(); buildCritPanel();
      setSyncStatus('ok','Baska cihazdan guncelleme alindi');
      setTimeout(()=>setSyncStatus('ok','Firebase bagli \u2713'),3000);
    }
  });
  fbListenStudents(APP.groups);
  onSnapshot(doc(db,'panel','activity'), snap=>{
    if(!snap.exists()) return;
    const newAct=snap.data();
    // Mevcut ile birleÅŸtir (en bÃ¼yÃ¼k deÄŸeri koru)
    for(const [u,days] of Object.entries(newAct)){
      if(!APP.actLog[u]) APP.actLog[u]={};
      for(const [d,v] of Object.entries(days)){
        const p=APP.actLog[u][d]||{games:0,puzzles:0};
        APP.actLog[u][d]={games:Math.max(p.games,v.games||0),puzzles:Math.max(p.puzzles,v.puzzles||0)};
      }
    }
    renderGrid(); renderChamps(); renderScoreTable();
    if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
  });
}

// â”€â”€ UYGULAMA DURUMU â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const APP = {
  groups: [{id:'default',name:'A Grubu'}],
  activeGid: null,
  studentLists: {},  // { [gid]: [{ u, n?, ukd?, lic? }, ...] }
  actLog: {},
  activityCache: {},
  liveData: {},
  stats: {}, // { [date]: count }
  crit: {
    minDailyGames:3, minWinRate:50, streakDays:3,
    minPuzzleDaily:5, streakPuzzleDays:3,
    ptWin:3, ptPlay:1, ptPuzzle:0.5,
    ptDailyBonus:5, ptPuzzleBonus:3, ptStreak:2,
    minWeeklyScore:50,
    countBullet:0  // 0=bullet sayma, 1=bullet say
  },
  curSort: 'score',
  curFilters: new Set(),
  scorePeriod: 'week',
  refreshId: 0,
  configUpdatedAt: 0
};

function normalizeStudentRecord(student){
  if(typeof student === 'string') return { u: student.trim().toLowerCase() };
  if(student && typeof student === 'object'){
    const u = String(student.u || student.username || '').trim().toLowerCase();
    if(!u) return null;
    const out = { ...student, u };
    delete out.username;
    return out;
  }
  return null;
}

function normalizeStudentList(list){
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(normalizeStudentRecord).filter(student => {
    if(!student || seen.has(student.u)) return false;
    seen.add(student.u);
    return true;
  });
}

function getStudentList(gid=APP.activeGid){
  if(!gid) return [];
  const list = normalizeStudentList(APP.studentLists[gid] || []);
  APP.studentLists[gid] = list;
  return list;
}

function studentUsername(student){
  return normalizeStudentRecord(student)?.u || '';
}

function findStudent(u, gid=APP.activeGid){
  return getStudentList(gid).find(student => student.u === u);
}

function levelSlug(level){
  return level === 'Ä°leri' ? 'ileri' : level === 'Orta' ? 'orta' : level === 'BaÅŸlangÄ±Ã§' ? 'baslangic' : 'genel';
}

function getStudentLevelInfo(u){
  const activeGroup = APP.groups.find(g => g.id === APP.activeGid);
  const activeStudent = findStudent(u);
  if(activeStudent?.level) return { level: activeStudent.level, group: activeStudent.groupName || activeGroup?.name || '' };
  if(activeStudent?.lvl) return { level: activeStudent.lvl, group: activeStudent.groupName || activeGroup?.name || '' };
  if(activeGroup && activeGroup.name !== "Haftanın En İyileri" && !activeGroup.name.startsWith("Haftanın En İyileri - ") && activeGroup.name !== "HaftanÄ±n En Ä°yileri" && !activeGroup.name.startsWith("HaftanÄ±n En Ä°yileri - ")){
    return { level: activeGroup.level || 'Genel', group: activeGroup.name };
  }
  for(const g of APP.groups){
    if(g.name === "Haftanın En İyileri" || g.name.startsWith("Haftanın En İyileri - ") || g.name === "HaftanÄ±n En Ä°yileri" || g.name.startsWith("HaftanÄ±n En Ä°yileri - ")) continue;
    if(getStudentList(g.id).some(student => student.u === u)){
      return { level: g.level || 'Genel', group: g.name };
    }
  }
  return { level: 'Genel', group: activeGroup?.name || '' };
}

function getStudents(){ 
  return getStudentList().map(s => s.u);
}
function getStudentDisplayName(u){
  const s = findStudent(u);
  if(s && s.n) return s.n;
  const d = APP.liveData[u];
  return d ? (d.displayName || u) : u;
}
function getStudentUkd(u){
  const s = findStudent(u);
  if (s) {
    return { val: s.ukd || 'â€”', prev: s.pUkd || null };
  }
  return { val: 'â€”', prev: null };
}
function getStudentLic(u){
  const s = findStudent(u);
  return s ? (s.lic || '') : '';
}
function setStudents(arr){
  if(!APP.activeGid){ showToast('Ã–nce bir grup seÃ§',true); return; }
  // Mevcut isimleri koru
  const currentList = getStudentList();
  const newList = arr.map(raw => {
    const u = studentUsername(raw);
    const existing = currentList.find(x => x.u === u);
    return existing || normalizeStudentRecord(raw);
  });
  APP.studentLists[APP.activeGid] = normalizeStudentList(newList);
  fbSaveStudents(APP.activeGid);
}

// â”€â”€ TARÄ°H YARDIMCILARI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function dateStr(off){
  const d=new Date(); d.setDate(d.getDate()+(off||0));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayStr(){ return dateStr(0); }
function weekStart(){
  const d=new Date(), day=d.getDay(), diff=(day===0?-6:1-day);
  d.setDate(d.getDate()+diff);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function daysBetween(a,b){
  const p=s=>{ const[y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
  return Math.round((p(a)-p(b))/86400000);
}

// â”€â”€ AKTÄ°VÄ°TE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function logActivity(username, games, puzzles, wins){
  if(!APP.actLog[username]) APP.actLog[username]={};
  const key=todayStr(), prev=APP.actLog[username][key]||{games:0,puzzles:0,wins:0};
  APP.actLog[username][key]={
    games:   Math.max(prev.games,   games),
    puzzles: Math.max(prev.puzzles, puzzles),
    wins:    Math.max(prev.wins||0, wins||0)
  };
  const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-14);
  for(const d of Object.keys(APP.actLog[username])) if(new Date(d)<cutoff) delete APP.actLog[username][d];
  fbSaveActivity();
}

function getStreak(username,type='games'){
  const log=APP.actLog[username]||{}, thr=type==='games'?APP.crit.minDailyGames:APP.crit.minPuzzleDaily;
  let s=0;
  for(let i=0;i<14;i++){ const e=log[dateStr(-i)]; const v=e?(type==='games'?e.games:e.puzzles):0; if(v>=thr)s++; else break; }
  return s;
}

function get14Days(username){
  const log=APP.actLog[username]||{}, out=[];
  for(let i=13;i>=0;i--){ const k=dateStr(-i); out.push({date:k,...(log[k]||{games:0,puzzles:0})}); }
  return out;
}

// â”€â”€ PUAN SÄ°STEMÄ° â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DÃ¶nem bazlÄ± istatistik Ã¶zeti (actLog'dan)
function periodStats(username, period){
  const log = APP.actLog[username]||{};
  const d   = APP.liveData[username];
  let totalGames=0, totalPuzzles=0, activeDays=0;

  for(const [date,entry] of Object.entries(log)){
    if(period==='week' && daysBetween(todayStr(),date)>6) continue;
    if(daysBetween(todayStr(),date)>13) continue;
    let g = entry.games||0;
    const p = entry.puzzles||0;
    if(date===todayStr() && d && !d.error){
      const todayTotal=(d.wins||0)+(d.losses||0)+(d.draws||0);
      if(todayTotal>g) g=todayTotal;
    }
    totalGames   += g;
    totalPuzzles += p;
    if(g>0) activeDays++;
  }

  // BugÃ¼n actLog'da yoksa liveData'dan ekle
  if(!log[todayStr()] && d && !d.error){
    const todayTotal=(d.wins||0)+(d.losses||0)+(d.draws||0);
    if(todayTotal>0){ totalGames+=todayTotal; activeDays++; }
    if((d.puzzlesSolved||0)>0) totalPuzzles+=(d.puzzlesSolved||0);
  }

  const streak = getStreak(username,'games');
  return { totalGames, totalPuzzles, activeDays, streak };
}

function calcScore(username, period='week'){
  const log=APP.actLog[username]||{};
  let pts=0;
  for(const [date,entry] of Object.entries(log)){
    if(period==='week' && daysBetween(todayStr(),date)>6) continue;
    const games=entry.games||0, puzzles=entry.puzzles||0;
    const d=APP.liveData[username];
    const wins=(date===todayStr()&&d&&!d.error)?(d.wins||0):0;
    pts += wins*APP.crit.ptWin + Math.max(0,games-wins)*APP.crit.ptPlay;
    pts += puzzles*APP.crit.ptPuzzle;
    if(games>=APP.crit.minDailyGames)   pts+=APP.crit.ptDailyBonus;
    if(puzzles>=APP.crit.minPuzzleDaily) pts+=APP.crit.ptPuzzleBonus;
  }
  const streak=getStreak(username,'games');
  pts+=streak*APP.crit.ptStreak;
  const d=APP.liveData[username];
  if(d&&!d.error){ const t=(d.wins||0)+(d.losses||0)+(d.draws||0); const wr=t>0?(d.wins/t)*100:0; if(wr>=60)pts+=5;else if(wr>=50)pts+=2; }
  return Math.round(pts);
}

function scoreBreakdown(username){
  const d=APP.liveData[username]; if(!d||d.error) return '';
  const tot=(d.wins||0)+(d.losses||0)+(d.draws||0), puz=d.puzzlesSolved||0, streak=getStreak(username,'games');
  const parts=[];
  if(tot>0) parts.push(`âš”${tot}`);
  if(puz>0) parts.push(`ðŸ§©${puz}`);
  if(streak>0) parts.push(`ðŸ”¥${streak}g`);
  return parts.join(' ');
}

// â”€â”€ GRUP YÃ–NETÄ°MÄ° â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderGroupBar(){
  const bar=document.getElementById('groupBar');
  // Seviyelere gÃ¶re grupla
  const levels = ['Ä°leri', 'Orta', 'BaÅŸlangÄ±Ã§', 'Genel'];
  const grouped = {};
  APP.groups.forEach(g => {
    const l = g.level || 'Genel';
    if(!grouped[l]) grouped[l] = [];
    grouped[l].push(g);
  });

  let html = '';
  levels.forEach(lvl => {
    const groupsInLvl = grouped[lvl];
    if(groupsInLvl && groupsInLvl.length > 0) {
      const lvlClass = lvl.toLowerCase().replace('i','i').replace('ÅŸ','s').replace('Ã§','c').replace('ÄŸ','g').replace('Ã¼','u').replace('Ã¶','o');
      // TÃ¼rkÃ§e karakter dÃ¼zeltme (basitleÅŸtirilmiÅŸ)
      const safeLvl = lvl === 'Ä°leri' ? 'ileri' : lvl === 'Orta' ? 'orta' : lvl === 'BaÅŸlangÄ±Ã§' ? 'baslangic' : 'genel';
      
      html += `<div class="group-level-section">
        <div class="group-level-tabs">`;
      html += groupsInLvl.map(g => {
        const n=getStudentList(g.id).length;
        const activeCls = g.id===APP.activeGid ? `active lvl-${safeLvl}` : '';
        return `<button class="group-tab ${activeCls}" onclick="switchGroup('${g.id}')" title="Seviye: ${lvl}">
          <span class="group-level-indicator bg-${safeLvl}"></span>
          ${escHtml(g.name)}
          <span class="tab-count">${n}</span>
        </button>`;
      }).join('');
      html += `</div></div>`;
    }
  });

  bar.innerHTML = html + `<button class="new-group-btn edit-only" onclick="openNewGroupModal()" style="margin-top:10px;">ï¼‹ Yeni Grup</button>`;
  setTimeout(updateGroupScrollState, 0);
}

function updateGroupScrollState(){
  const bar=document.getElementById('groupBar');
  const nav=bar?.closest('.group-nav');
  if(!bar||!nav) return;
  const max=bar.scrollWidth-bar.clientWidth;
  nav.classList.toggle('can-left', bar.scrollLeft>4);
  nav.classList.toggle('can-right', max>4 && bar.scrollLeft<max-4);
}

window.scrollGroupBar=function(dir){
  const bar=document.getElementById('groupBar');
  if(!bar) return;
  const amount=Math.max(220, Math.round(bar.clientWidth*.65));
  const max=bar.scrollWidth-bar.clientWidth;
  const next=Math.max(0, Math.min(max, bar.scrollLeft + dir*amount));
  bar.scrollTo({left:next, behavior:'smooth'});
  setTimeout(updateGroupScrollState, 220);
};

window.switchGroup = async function switchGroup(id){
  if(id===APP.activeGid) return;
  APP.refreshId++;
  APP.activeGid=id;
  APP.curFilters.clear();
  document.querySelectorAll('.ctrl-btn[data-filter]').forEach(b=>b.classList.remove('active'));
  renderGroupBar(); renderHeader();
  // Ã–ÄŸrenci listesi bellekte yoksa Firebase'den Ã§ek
  if(APP.studentLists[id] === undefined || APP.studentLists[id] === null){
    setSyncStatus('syncing','Grup yÃ¼kleniyorâ€¦');
    try{
      const prefix2 = APP.currentUser ? APP.currentUser + '_' : '';
      const skey = 'students_' + prefix2 + id;
      let snap = await getDoc(doc(db,'panel',skey));
      if(!snap.exists() && prefix2) snap = await getDoc(doc(db,'panel','students_'+id));
      APP.studentLists[id] = normalizeStudentList(snap.exists() ? (snap.data().list||[]) : []);
      setSyncStatus('ok','Firebase baÄŸlÄ± âœ“');
    }catch(e){
      APP.studentLists[id] = [];
      setSyncStatus('err','Grup yÃ¼klenemedi');
    }
  }
  renderGroupBar();
  renderGrid();
  if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
  if(getStudents().length>0) refreshAll();
}

window.openNewGroupModal=()=>{ document.getElementById('newGroupName').value=''; document.getElementById('modalNewGroup').style.display='flex'; setTimeout(()=>document.getElementById('newGroupName').focus(),50); };
window.createGroup=()=>{
  if(!PIN.getIsAdmin()){ showToast('Bu iÅŸlem iÃ§in yÃ¶netici giriÅŸi gerekli',true); return; }
  const name=document.getElementById('newGroupName').value.trim(); if(!name) return;
  const level=document.getElementById('newGroupLevel').value;
  const g={id:'g'+Date.now(),name,level};
  APP.groups.push(g); APP.activeGid=g.id;
  APP.studentLists[g.id]=[];
  fbSaveConfig(); fbSaveStudents(g.id);
  closeModal('modalNewGroup'); renderGroupBar(); renderHeader(); renderGrid();
  showToast(`"${name}" (${level}) grubu oluÅŸturuldu âœ“`);
};
window.openRenameModal=()=>{
  const g=APP.groups.find(x=>x.id===APP.activeGid); if(!g) return;
  document.getElementById('renameInput').value=g.name;
  document.getElementById('renameLevel').value=g.level || 'Genel';
  document.getElementById('modalRename').style.display='flex';
  setTimeout(()=>document.getElementById('renameInput').focus(),50);
};
window.renameGroup=()=>{
  if(!PIN.getIsAdmin()){ showToast('Bu iÅŸlem iÃ§in yÃ¶netici giriÅŸi gerekli',true); return; }
  const name=document.getElementById('renameInput').value.trim(); if(!name) return;
  const level=document.getElementById('renameLevel').value;
  const g=APP.groups.find(x=>x.id===APP.activeGid); if(!g) return;
  g.name=name; g.level=level; fbSaveConfig(); closeModal('modalRename'); renderGroupBar(); renderHeader();
  showToast(`Grup gÃ¼ncellendi âœ“`);
};
window.confirmDeleteGroup=()=>{
  if(!PIN.getIsAdmin()){ showToast('Bu iÅŸlem iÃ§in yÃ¶netici giriÅŸi gerekli',true); return; }
  if(!APP.activeGid){ showToast('Ã–nce bir grup seÃ§',true); return; }
  if(APP.groups.length<=1){ showToast('Son grubu silemezsiniz!',true); return; }
  const g=APP.groups.find(x=>x.id===APP.activeGid);
  if(!confirm(`"${g?.name}" grubunu silmek istiyor musunuz?`)) return;
  APP.groups=APP.groups.filter(x=>x.id!==APP.activeGid);
  delete APP.studentLists[APP.activeGid];
  APP.activeGid=null;
  fbSaveConfig(); renderGroupBar(); renderHeader(); renderGrid();
  showToast('Grup silindi',true);
};
window.closeModal=id=>document.getElementById(id).style.display='none';
function renderHeader(){
  const g=APP.groups.find(x=>x.id===APP.activeGid);
  const name = g ? g.name : 'â€”';
  const safeLvl = g ? (g.level === 'Ä°leri' ? 'ileri' : g.level === 'Orta' ? 'orta' : g.level === 'BaÅŸlangÄ±Ã§' ? 'baslangic' : 'genel') : 'genel';
  const levelIndicator = g ? `<span class="group-level-indicator bg-${safeLvl}" style="width:10px; height:10px; margin-right:8px; vertical-align:middle;"></span>` : '';
  
  document.getElementById('groupNameDisplay').innerHTML = levelIndicator + name;
  document.title=(g?g.name+' â€” ':'')+'Lichess KoÃ§ Paneli';
}

// â”€â”€ Ã–ÄžRENCÄ° EKLE / Ã‡IKAR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
window.addStudent=async()=>{
  if(!PIN.getIsAdmin()){ showToast('Bu iÅŸlem iÃ§in yÃ¶netici giriÅŸi gerekli',true); return; }
  if(!APP.activeGid){ showToast('Ã–nce bir grup seÃ§',true); return; }
  const inp=document.getElementById('addInput'), errEl=document.getElementById('addErr');
  const val=inp.value.trim(); errEl.textContent='';
  if(!val) return;
  
  // Format: "user (Real Name) (UKD) (Lic)" veya sadece "user"
  let user = val, realName = null, ukd = null, lic = null;
  
  // Parantez iÃ§indeki verileri yakala: user (Ä°sim) (UKD) (Lisans)
  const matches = [...val.matchAll(/\((.+?)\)/g)];
  if(matches.length > 0){
    user = val.split('(')[0].trim().toLowerCase();
    realName = matches[0] ? matches[0][1].trim() : null;
    ukd = matches[1] ? matches[1][1].trim() : null;
    lic = matches[2] ? matches[2][1].trim() : null;
  } else {
    user = val.toLowerCase();
  }
  
  const students=getStudents();
  if(students.includes(user)){ errEl.textContent='âš  Bu kullanÄ±cÄ± zaten listede.'; return; }
  inp.disabled=true;
  try{
    const res=await fetchWT(`https://lichess.org/api/user/${user}`,{},8000);
    if(!res.ok){ errEl.textContent='âœ— KullanÄ±cÄ± bulunamadÄ±.'; return; }
    const data=await res.json();
    
    // Listeye ekle (obje olarak)
    const list = getStudentList();
    const studentObj = { u: user };
    if(realName) studentObj.n = realName;
    if(ukd) studentObj.ukd = ukd;
    if(lic) studentObj.lic = lic;
    
    list.push(normalizeStudentRecord(studentObj));
    APP.studentLists[APP.activeGid] = normalizeStudentList(list);
    fbSaveStudents(APP.activeGid);
    
    inp.value='';
    renderGroupBar(); renderGrid();
    loadOneStudent(user,0); showToast(`${realName || data.username} eklendi âœ“`);
  }catch(e){ errEl.textContent=e.name==='AbortError'?'âœ— Zaman aÅŸÄ±mÄ±.':'âœ— BaÄŸlantÄ± hatasÄ±.'; }
  finally{ inp.disabled=false; inp.focus(); }
};

window.retryStudent=async(username)=>{
  delete APP.liveData[username];
  const card=document.getElementById('cardsGrid').querySelector('[data-user="'+CSS.escape(username)+'"]');
  if(card){ const tmp=document.createElement('div'); tmp.innerHTML=skeletonCard(username); if(tmp.firstElementChild) card.replaceWith(tmp.firstElementChild); }
  await loadOneStudent(username,0);
  updateOneCard(username,0);
  renderChamps(); renderScoreTable();
};

function removeStudent(username){
  if(!PIN.getIsAdmin()){ showToast('Bu iÅŸlem iÃ§in yÃ¶netici giriÅŸi gerekli',true); return; }
  const currentList = getStudentList();
  const updated = currentList.filter(x => x.u !== username);
  APP.studentLists[APP.activeGid] = updated;
  fbSaveStudents(APP.activeGid);
  delete APP.liveData[username];
  renderGroupBar(); renderGrid(); showToast(`${username} Ã§Ä±karÄ±ldÄ±`,true);
}

// â”€â”€ VERÄ° YÃœKLEME â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
window.refreshAll=async(force=false)=>{
  const myId=++APP.refreshId;
  if(!APP.activeGid) return;
  const students=getStudents();
  if(students.length===0) return;
  const btn=document.getElementById('refreshBtn'); btn.classList.add('spinning');
  
  // Ã–nce mevcut verilerle UI'Ä± gÃ¼ncelle
  renderGrid();
  if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
  
  // Sadece eski veya eksik verileri gÃ¼ncelle
  const now = Date.now();
  const cacheLimit = 5 * 60 * 1000; // 5 dakika
  
  const toRefresh = students.filter(u => {
    if(force) return true;
    const d = APP.liveData[u];
    if(!d || d.error) return true;
    return (now - (d.loadedAt || 0)) > cacheLimit;
  });

  if(toRefresh.length === 0){
    btn.classList.remove('spinning');
    setLoadStatus('');
    return;
  }

  setLoadStatus(`YÃ¼kleniyorâ€¦ 0/${toRefresh.length}`);
  let done=0;
  for(const user of toRefresh){
    if(myId!==APP.refreshId) break;
    await loadOneStudent(user,myId);
    done++; if(myId!==APP.refreshId) break;
    setLoadStatus(`YÃ¼kleniyorâ€¦ ${done}/${toRefresh.length}`);
    updateOneCard(user,myId);
    if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
    
    // Lichess rate limit: Ã¶ÄŸrenciler arasÄ± 1.5sn bekle
    if(done<toRefresh.length) await new Promise(r=>setTimeout(r,4000));
  }
  if(myId===APP.refreshId){
    btn.classList.remove('spinning'); setLoadStatus('');
    document.getElementById('lastUpdate').textContent='GÃ¼ncellendi: '+new Date().toLocaleTimeString('tr-TR');
    renderGrid(); renderChamps(); renderScoreTable();
    if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
  }
};

async function fetchAndParseGames(username, fetchSince, todayMidnight) {
  let wins=0, losses=0, draws=0;
  const recent=[];
  const perfs = APP.crit.countBullet ? 'bullet,blitz,rapid,classical' : 'blitz,rapid,classical';
  const gRes = await fetchWT(`https://lichess.org/api/games/user/${username}?since=${fetchSince}&max=100&moves=false&opening=true&clocks=false&perf=${perfs}`, {headers:{Accept:'application/x-ndjson'}}, 20000);
  const gText = await gRes.text();
  const games = gText.trim().split('\n').filter(l=>l.trim()).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);

  const NONSTANDARD = new Set(['correspondence','chess960','kingOfTheHill','threeCheck','antichess','atomic','horde','racingKings','crazyhouse','ultraBullet']);
  const openingCounts = { white: {}, black: {} };

  for (const g of games) {
    if (NONSTANDARD.has(g.perf)) continue;
    if (!APP.crit.countBullet && (g.speed==='bullet'||g.speed==='ultraBullet')) continue;

    const wu = (g.players?.white?.user?.name||'').toLowerCase();
    const color = wu===username ? 'white' : 'black';
    const winner = g.winner;
    let result;

    const ts = g.lastMoveAt || g.createdAt;
    const isToday = ts >= todayMidnight;

    if (!winner) {
      if (g.status==='aborted' || g.status==='noStart') continue;
      if (isToday) draws++; 
      result='draw';
    } else if (winner===color) {
      if (isToday) wins++; 
      result='win';
    } else {
      if (isToday) losses++; 
      result='loss';
    }

    if (g.opening && g.opening.name) {
      const opName = g.opening.name.split(':')[0].trim();
      openingCounts[color][opName] = (openingCounts[color][opName] || 0) + 1;
    }

    const opp = color==='white' ? (g.players?.black?.user?.name||'Anonim') : (g.players?.white?.user?.name||'Anonim');
    if (isToday) {
       recent.push({ result, opponent: opp, speed: g.speed||'', time: ts ? fmtTime(new Date(ts)) : '' });
    }
  }

  const topOpenings = {
     white: Object.entries(openingCounts.white).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]),
     black: Object.entries(openingCounts.black).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0])
  };

  return { wins, losses, draws, recent, topOpenings };
}

async function fetchAndParseActivity(username) {
  let puzzlesSolved = 0;
  const today = todayStr();
  const cacheKey = `${username}:${today}:${APP.crit.countBullet ? 1 : 0}`;
  const cached = APP.activityCache[cacheKey];
  const cacheLimit = 30 * 60 * 1000; // /activity Lichess tarafinda daha kolay rate limit'e takiliyor

  if (cached && (Date.now() - cached.loadedAt) < cacheLimit) {
    return cached.puzzlesSolved || 0;
  }

  const aRes = await fetchWT(`https://lichess.org/api/user/${username}/activity`, {}, 15000);
  if (!aRes.ok) {
    if (cached) return cached.puzzlesSolved || 0;
    return puzzlesSolved;
  }

  const aData = await aRes.json();
  if (!Array.isArray(aData)) {
    if (cached) return cached.puzzlesSolved || 0;
    return puzzlesSolved;
  }

  if (!APP.actLog[username]) APP.actLog[username] = {};
  for (let di=0; di<=14; di++) {
    const dk = dateStr(-di);
    if (dk !== today) APP.actLog[username][dk] = {games:0, puzzles:0};
  }

  for (const entry of aData) {
    let eDate = entry.interval?.start || entry.date || null;
    if (!eDate) continue;
    if (typeof eDate==='number') {
      const d = new Date(eDate);
      eDate = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    }

    if (eDate === today) {
      const cnt = getPuzzleCount(entry);
      if (cnt > puzzlesSolved) puzzlesSolved = cnt;
    }

    const diff = daysBetween(today, eDate);
    if (diff<0 || diff>14) continue;

    let eg=0;
    if (entry.games && typeof entry.games==='object') {
      const skip = APP.crit.countBullet ? new Set([]) : new Set(['bullet','ultraBullet']);
      for (const [fmt,v] of Object.entries(entry.games)) {
        if (v && typeof v==='object' && !skip.has(fmt)) {
          eg += (v.win||0) + (v.loss||0) + (v.draw||0);
        }
      }
    }

    const ep = getPuzzleCount(entry);

    if (eDate === today) {
      const prevT = APP.actLog[username][today] || {games:0, puzzles:0, wins:0};
      APP.actLog[username][today] = {games:prevT.games, puzzles:ep, wins:prevT.wins||0};
    } else {
      let ew=0;
      if (entry.games && typeof entry.games==='object') {
        const skip = APP.crit.countBullet
          ? new Set(['ultraBullet','correspondence','chess960','kingOfTheHill','threeCheck','antichess','atomic','horde','racingKings','crazyhouse'])
          : new Set(['bullet','ultraBullet','correspondence','chess960','kingOfTheHill','threeCheck','antichess','atomic','horde','racingKings','crazyhouse']);
        for (const [fmt,v] of Object.entries(entry.games)) {
          if (v && typeof v==='object' && !skip.has(fmt)) ew += (v.win||0);
        }
      }
      APP.actLog[username][eDate] = {games:eg, puzzles:ep, wins:ew};
    }
  }
  APP.activityCache[cacheKey] = { loadedAt: Date.now(), puzzlesSolved };
  return puzzlesSolved;
}

async function loadOneStudent(username,myId){
  try{
    const userRes=await fetchWT(`https://lichess.org/api/user/${username}`,{},12000);
    if(!userRes.ok) throw new Error('not_found');
    const user=await userRes.json();
    if(myId&&myId!==APP.refreshId) return;

    let online=user.online===true||(user.seenAt&&(Date.now()-user.seenAt)<5*60*1000);
    const now=new Date(), todayMidnight=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
    const weekAgo = todayMidnight - 7 * 24 * 60 * 60 * 1000;

    // 1. MaÃ§larÄ± Ã‡ek ve AyÄ±kla (ModÃ¼ler Fonksiyon)
    const { wins, losses, draws, recent, topOpenings } = await fetchAndParseGames(username, weekAgo, todayMidnight);
    if(myId&&myId!==APP.refreshId) return;

    // 2. Rating'leri Hesapla
    const ratings={}, perf=user.perfs||{};
    for(const k of ['bullet','blitz','rapid','classical']) if(perf[k]&&perf[k].games>0) ratings[k]={int:perf[k].rating,prog:perf[k].prog||0};
    let puzzleRating=perf.puzzle?perf.puzzle.rating:null;

    // 3. Aktivite / Bulmaca Ã‡ek ve AyÄ±kla (ModÃ¼ler Fonksiyon)
    let puzzlesSolved=0;
    try{
      puzzlesSolved = await fetchAndParseActivity(username);
    }catch(e){ console.warn(`[${username}] aktivite:`,e.message); }
    if(myId&&myId!==APP.refreshId) return;

    APP.liveData[username]={displayName:user.username,title:user.title||'',online,ratings,wins,losses,draws,puzzlesSolved,puzzleRating,recentGames:recent,topOpenings,loadedAt:Date.now()};
    logActivity(username,wins+losses+draws,puzzlesSolved,wins);
  }catch(err){
    console.warn(`[${username}]:`,err.message);
    // Ä°lk hata â€” 3 saniye bekleyip bir kez daha dene
    if(!APP.liveData[username] || !APP.liveData[username].retried){
      await new Promise(r=>setTimeout(r,8000)); // Rate limit iÃ§in bekleme
      if(myId && myId!==APP.refreshId) return; // grup deÄŸiÅŸtiyse iptal
      try{
        const retryRes=await fetchWT(`https://lichess.org/api/user/${username}`,{},10000);
        if(retryRes.ok){
          // Yeniden deneme baÅŸarÄ±lÄ± â€” loadOneStudent'Ä± tekrar Ã§aÄŸÄ±r ama retry flag'i ile
          APP.liveData[username]={retried:true,displayName:username};
          await loadOneStudent(username,myId);
          return;
        }
      }catch(e2){ console.warn(`[${username}] yeniden deneme de baÅŸarÄ±sÄ±z:`,e2.message); }
      APP.liveData[username]={error:true,displayName:username};
    } else {
      APP.liveData[username]={error:true,displayName:username};
    }
  }
}

function getPuzzleCount(entry){
  if(entry.puzzles?.score){ const s=entry.puzzles.score; return(s.win||0)+(s.loss||0)+(s.draw||0); }
  if(entry.puzzles&&typeof entry.puzzles==='object'){ const p=entry.puzzles; return(p.win||0)+(p.loss||0)+(p.draw||0); }
  return 0;
}

function updateOneCard(username,myId){
  if(myId&&myId!==APP.refreshId) return;
  const students=getStudents();
  const allLoaded=students.every(u=>APP.liveData[u]);
  const sorted=allLoaded?[...students].sort((a,b)=>scoreForSort(b)-scoreForSort(a)):[...students];
  const rank=sorted.indexOf(username)+1;
  const d=APP.liveData[username]; if(!d) return;
  const grid=document.getElementById('cardsGrid');
  const existing=grid.querySelector(`[data-user="${CSS.escape(username)}"]`);
  if(existing){ const tmp=document.createElement('div'); tmp.innerHTML=buildCard(username,d,rank); if(tmp.firstElementChild) existing.replaceWith(tmp.firstElementChild); }
}

// â”€â”€ ROZETLER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getBadges(username,d){
  if(!d||d.error) return [];
  const badges=[], total=(d.wins||0)+(d.losses||0)+(d.draws||0), wr=total>0?Math.round((d.wins/total)*100):0;
  const puz=d.puzzlesSolved||0, gs=getStreak(username,'games'), ps=getStreak(username,'puzzles');
  if(total>=APP.crit.minDailyGames) badges.push({cls:'b-active',icon:'âš¡',label:'Aktif',tip:`BugÃ¼n ${total} maÃ§`});
  else if(total>0) badges.push({cls:'b-info',icon:'â–·',label:`${total} maÃ§`,tip:'BugÃ¼n maÃ§ yaptÄ±'});
  else badges.push({cls:'b-warn',icon:'ðŸ’¤',label:'Pasif',tip:'BugÃ¼n maÃ§ yok'});
  if(total>=3&&wr>=APP.crit.minWinRate) badges.push({cls:'b-gold',icon:'ðŸ†',label:`%${wr}`,tip:`%${APP.crit.minWinRate}+ kazanma`});
  if(gs>=APP.crit.streakDays) badges.push({cls:'b-streak',icon:'ðŸ”¥',label:`${gs}g Seri`,tip:`${gs} gÃ¼n Ã¼st Ã¼ste`});
  if(puz>=APP.crit.minPuzzleDaily) badges.push({cls:'b-puzzle',icon:'ðŸ§©',label:`${puz}`,tip:`${APP.crit.minPuzzleDaily}+ bulmaca`});
  if(ps>=APP.crit.streakPuzzleDays) badges.push({cls:'b-pstreak',icon:'ðŸŽ¯',label:`${ps}gðŸ§©`,tip:`${ps} gÃ¼n bulmaca serisi`});
  
  const weeklyScore = calcScore(username, 'week');
  const isBelow = weeklyScore < (APP.crit.minWeeklyScore || 0);
  if (isBelow) {
    badges.push({cls:'b-warn',icon:'ðŸ”»',label:'Baraj AltÄ±',tip:`HaftalÄ±k barajÄ±n (${APP.crit.minWeeklyScore}) altÄ±nda`});
  } else {
    badges.push({cls:'b-active',icon:'ðŸŒŸ',label:'Baraj ÃœstÃ¼',tip:`HaftalÄ±k barajÄ±n (${APP.crit.minWeeklyScore}) Ã¼zerinde`});
  }
  
  return badges;
}

// â”€â”€ SIRALAMA / FÄ°LTRE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function scoreForSort(u){
  const d=APP.liveData[u]; if(!d||d.error) return -9999;
  const tot=(d.wins||0)+(d.losses||0)+(d.draws||0), wr=tot>0?(d.wins/tot)*100:0;
  if(APP.curSort==='score')   return calcScore(u,'week');
  if(APP.curSort==='games')   return tot;
  if(APP.curSort==='winrate') return wr;
  if(APP.curSort==='puzzles') return d.puzzlesSolved||0;
  if(APP.curSort==='streak')  return getStreak(u,'games');
  if(APP.curSort==='name')    return -(u.charCodeAt(0));
  return calcScore(u,'week');
}

function passes(u){
  if(APP.curFilters.size===0) return true;
  const d=APP.liveData[u]; if(!d) return true; if(d.error) return APP.curFilters.has('inactive');
  const tot=(d.wins||0)+(d.losses||0)+(d.draws||0);
  if(APP.curFilters.has('active')   && tot>=APP.crit.minDailyGames) return true;
  if(APP.curFilters.has('inactive') && tot<APP.crit.minDailyGames)  return true;
  if(APP.curFilters.has('streak')   && getStreak(u,'games')>=APP.crit.streakDays) return true;
  if(APP.curFilters.has('puzzle')   && (d.puzzlesSolved||0)>=APP.crit.minPuzzleDaily) return true;
  return false;
}

window.setSort=k=>{ APP.curSort=k; document.querySelectorAll('.ctrl-btn[data-sort]').forEach(b=>b.classList.toggle('active',b.dataset.sort===k)); renderGrid(); };
window.togFilter=k=>{ APP.curFilters.has(k)?APP.curFilters.delete(k):APP.curFilters.add(k); document.querySelectorAll('.ctrl-btn[data-filter]').forEach(b=>b.classList.toggle('active',APP.curFilters.has(b.dataset.filter))); renderGrid(); };
window.setScorePeriod=p=>{ APP.scorePeriod=p; document.querySelectorAll('.score-tab').forEach(b=>b.classList.toggle('active',b.dataset.period===p)); renderScoreTable(); renderChamps(); };

// â”€â”€ RENDER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderGrid(){
  const grid=document.getElementById('cardsGrid');
  if(!APP.activeGid){
    grid.innerHTML='<div class="empty"><div class="ei">â™Ÿ</div><h3>Grubunu seÃ§</h3><p>Ãœstteki grup sekmelerinden kendi grubunu seÃ§erek sporcularÄ± gÃ¶rÃ¼ntÃ¼le.</p></div>';
    return;
  }
  const students=getStudents();
  if(students.length===0){ grid.innerHTML='<div class="empty"><div class="ei">â™Ÿ</div><h3>HenÃ¼z Ã¶ÄŸrenci yok</h3><p>YukarÄ±dan lichess kullanÄ±cÄ± adÄ± ekle.</p></div>'; return; }
  const allLoaded=students.every(u=>APP.liveData[u]);
  const sorted=allLoaded?[...students].sort((a,b)=>scoreForSort(b)-scoreForSort(a)):[...students];
  const rankMap=Object.fromEntries(sorted.map((u,i)=>[u,i+1]));
  const filtered=sorted.filter(passes);
  if(filtered.length===0){ grid.innerHTML='<div class="empty"><div class="ei">ðŸ”</div><h3>Filtre eÅŸleÅŸmedi</h3></div>'; return; }
  const frag=document.createDocumentFragment();
  for(const u of filtered){
    const d=APP.liveData[u];
    try{
      const cardHtml=d?buildCard(u,d,rankMap[u]||0):skeletonCard(u);
      const tmp=document.createElement('div'); tmp.innerHTML=cardHtml;
      const el=tmp.firstElementChild;
      if(el){
        frag.appendChild(el);
      } else {
        // Fallback: basit skeleton ekle
        const fb=document.createElement('div');
        fb.className='s-card'; fb.setAttribute('data-user',u);
        fb.innerHTML='<div class="card-head"><div class="s-info"><div class="avatar">'+u[0].toUpperCase()+'</div><div><div style="font-size:13px;font-weight:600">'+escHtml(u)+'</div></div></div></div><div style="padding:14px 13px"><div class="skel" style="height:44px;border-radius:6px">&nbsp;</div></div><div class="load-ov"><div class="spinner"></div></div>';
        frag.appendChild(fb);
      }
    }catch(e){
      console.error('[renderGrid] hata ('+u+'):', e.message);
      // Hata durumunda basit kart ekle
      const fb=document.createElement('div');
      fb.className='s-card faded'; fb.setAttribute('data-user',u);
      fb.innerHTML='<div class="card-head" style="padding:12px 13px"><span style="font-size:12px;color:var(--text-muted)">'+escHtml(u)+' â€” yÃ¼klenemedi</span></div>';
      frag.appendChild(fb);
    }
  }
  grid.innerHTML=''; grid.appendChild(frag);
}

function renderChamps(){
  const students=getStudents().filter(u=>APP.liveData[u]&&!APP.liveData[u].error);
  if(students.length<2){ document.getElementById('champStrip').innerHTML=''; return; }
  const period = APP.scorePeriod||'week';
  const periodLabel = period==='week' ? 'Bu Hafta' : '14 GÃ¼n';

  // Her Ã¶ÄŸrenci iÃ§in dÃ¶nem istatistiklerini hesapla
  const stats = Object.fromEntries(students.map(u=>[u, periodStats(u,period)]));

  const best = fn => students.reduce((b,u)=>fn(u)>fn(b)?u:b);

  const champs=[
    {
      cls:'cc-score', label:'â­ En YÃ¼ksek Puan', medal:'ðŸ†',
      user: best(u=>calcScore(u,period)),
      val:  u=>calcScore(u,period)+' puan',
      sub:  u=>periodLabel
    },
    {
      cls:'cc-games', label:'âš” En Ã‡ok MaÃ§', medal:'ðŸŽ¯',
      user: best(u=>stats[u].totalGames),
      val:  u=>stats[u].totalGames+' maÃ§',
      sub:  u=>periodLabel+' toplam'
    },
    {
      cls:'cc-puzzle', label:'ðŸ§© En Ã‡ok Bulmaca', medal:'ðŸ§©',
      user: best(u=>stats[u].totalPuzzles),
      val:  u=>stats[u].totalPuzzles+' bulmaca',
      sub:  u=>periodLabel+' toplam'
    },
    {
      cls:'cc-win', label:'ðŸ“š En Ã‡ok Antrenman', medal:'ðŸ“š',
      user: (()=>{
        // MaÃ§ + bulmaca toplamÄ± en yÃ¼ksek
        const active=students.filter(u=>stats[u].totalGames>0||stats[u].totalPuzzles>0);
        if(active.length===0) return students[0];
        return active.reduce((b,u)=>(stats[u].totalGames+stats[u].totalPuzzles)>(stats[b].totalGames+stats[b].totalPuzzles)?u:b);
      })(),
      val:  u=>(stats[u].totalGames+stats[u].totalPuzzles)>0
              ? (stats[u].totalGames+stats[u].totalPuzzles)+' toplam aktivite'
              : 'henÃ¼z aktivite yok',
      sub:  u=>periodLabel+' maÃ§+bulmaca toplamÄ±'
    },
    {
      cls:'cc-streak', label:'âš¡ En Aktif Oyuncu', medal:'âš¡',
      user: (()=>{
        // En fazla aktif gÃ¼n olan oyuncu (activeDays)
        const active=students.filter(u=>stats[u].activeDays>0);
        if(active.length===0) return students[0];
        return active.reduce((b,u)=>stats[u].activeDays>stats[b].activeDays?u:b);
      })(),
      val:  u=>stats[u].activeDays>0
              ? stats[u].activeDays+' aktif gÃ¼n'
              : 'henÃ¼z maÃ§ yok',
      sub:  u=>periodLabel+' iÃ§inde'
    },
  ];

  document.getElementById('champStrip').innerHTML=champs.map(c=>`
    <div class="champ-card ${c.cls}">
      <div class="champ-label">${c.label}</div>
      <div class="champ-name">${escHtml(getStudentDisplayName(c.user))}</div>
      <div class="champ-val"><strong>${c.val(c.user)}</strong></div>
      <div class="champ-sub" style="font-size:9px;color:var(--text-muted);margin-top:2px">${c.sub(c.user)}</div>
      <div class="champ-medal">${c.medal}</div>
    </div>`).join('');
}

function renderScoreTable(){
  const students=getStudents().filter(u=>APP.liveData[u]&&!APP.liveData[u].error);
  if(!APP.activeGid){
    document.getElementById('scoreRows').innerHTML='<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:11px">Puan tablosu iÃ§in grup seÃ§in.</div>';
    return;
  }
  if(students.length===0){
    document.getElementById('scoreRows').innerHTML='<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:11px">Veri bekleniyorâ€¦</div>';
    return;
  }
  const period = APP.scorePeriod||'week';
  const scored = [...students]
    .map(u=>({ u, pts:calcScore(u,period), st:periodStats(u,period) }))
    .sort((a,b)=>b.pts-a.pts);
  const maxPts = scored[0]?.pts||1;

  document.getElementById('scoreRows').innerHTML=scored.map(({u,pts,st},i)=>{
    const rank=i+1, d=APP.liveData[u];
    const rCls = rank===1?'sr1':rank===2?'sr2':rank===3?'sr3':'';
    const medal = rank===1?'ðŸ¥‡':rank===2?'ðŸ¥ˆ':rank===3?'ðŸ¥‰':rank;
    const pct   = Math.round((pts/maxPts)*100);
    const isBelow = APP.scorePeriod==='week' && pts < (APP.crit.minWeeklyScore || 0);
    const barColor = isBelow ? 'var(--loss)' : 'var(--win)';

    // Ä°statistik etiketleri
    const tags=[];
    if(st.totalGames>0)   tags.push(`<span class="sc-tag sc-game">âš” ${st.totalGames} maÃ§</span>`);

    if(st.totalPuzzles>0) tags.push(`<span class="sc-tag sc-puz">ðŸ§© ${st.totalPuzzles} bulmaca</span>`);
    if(st.streak>1)       tags.push(`<span class="sc-tag sc-str">ðŸ”¥ ${st.streak}g seri</span>`);
    if(st.activeDays>0)   tags.push(`<span class="sc-tag sc-day">ðŸ“… ${st.activeDays} aktif gÃ¼n</span>`);

    return `<div class="score-row ${rCls}">
      <div class="score-rank">${medal}</div>
      <div class="score-info">
        <div class="score-name">${escHtml(getStudentDisplayName(u))}</div>
        <div class="score-tags">${tags.join('')}</div>
        <div class="score-bar-bg" style="margin-top:4px"><div class="score-bar-fill" style="width:${pct}%;background:${APP.scorePeriod==='week'?barColor:''}"></div></div>
      </div>
      <div class="score-pts-wrap">
        <div class="score-pts" style="color:${APP.scorePeriod==='week'?barColor:''}">${pts}</div>
        <div class="score-pts-lbl">puan</div>
      </div>
    </div>`;
  }).join('');
}

// â”€â”€ KART OLUÅžTURUCULAR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function skeletonCard(u){
  return `<div class="s-card" data-user="${escHtml(u)}">
    <div class="card-head"><div class="s-info">
      <div class="avatar skel" style="width:32px;height:32px">&nbsp;</div>
      <div><div class="skel" style="width:80px;height:12px;margin-bottom:4px">&nbsp;</div><div class="skel" style="width:50px;height:9px">&nbsp;</div></div>
    </div></div>
    <div style="padding:14px 13px"><div class="skel" style="height:44px;border-radius:6px">&nbsp;</div></div>
    <div class="load-ov"><div class="spinner"></div></div>
  </div>`;
}

function buildCard(username,d,rank){
  // Hata durumunda minimal kart gÃ¶ster
  if(d.error){
    return `<div class="s-card faded" data-user="${escHtml(username)}">
      <div class="card-head">
        <div class="card-top">
          <div class="s-info">
            <div class="avatar">${escHtml(username[0].toUpperCase())}</div>
            <div>
              <a href="https://lichess.org/@/${encodeURIComponent(username)}" target="_blank" class="s-name">${escHtml(getStudentDisplayName(username))}</a>
            <div class="s-sub" style="color:var(--loss)">âš  YÃ¼klenemedi
              <button onclick="retryStudent('${escHtml(username)}')" style="margin-left:6px;background:rgba(224,90,90,.15);border:1px solid rgba(224,90,90,.3);color:var(--loss);border-radius:4px;padding:1px 8px;cursor:pointer;font-family:inherit;font-size:9px">â†º Tekrar Dene</button>
            </div>
            </div>
          </div>
          <div class="card-actions">
            <button class="rm-btn" data-rmuser="${escHtml(username)}" title="Ã‡Ä±kar">âœ•</button>
          </div>
        </div>
      </div>
    </div>`;
  }
  const total=(d.wins||0)+(d.losses||0)+(d.draws||0);
  const winPct=total>0?Math.round((d.wins/total)*100):0;
  const drawPct=total>0?Math.round((d.draws/total)*100):0;
  const lossPct=100-winPct-drawPct;
  const badges=getBadges(username,d), score=calcScore(username,APP.scorePeriod||'week');
  const pSt=periodStats(username,APP.scorePeriod||'week');
  const crown=rank===1?'ðŸ‘‘':rank===2?'ðŸ¥ˆ':rank===3?'ðŸ¥‰':'';
  const cardCls=rank===1?'t1':rank===2?'t2':rank===3?'t3':'';
  const rHTML=['bullet','blitz','rapid','classical'].map(k=>{
    const r=d.ratings?.[k]; if(!r) return '';
    const dif=r.prog||0,cc=dif>0?'up':dif<0?'dn':'eq',ct=dif>0?`â–²${dif}`:dif<0?`â–¼${Math.abs(dif)}`:'â€”';
    return `<div class="r-item"><div class="r-type">${k==='bullet'?'BLT':k==='blitz'?'BLZ':k==='rapid'?'RPD':'CLS'}</div><div class="r-val">${r.int}</div><div class="r-chg ${cc}">${ct}</div></div>`;
  }).join('');
  const ukd = getStudentUkd(username);
   let ukdDiffHTML = '<div class="r-chg eq">â€”</div>';
   if(ukd.prev && ukd.val !== 'â€”') {
     const diff = parseInt(ukd.val) - parseInt(ukd.prev);
     if(diff > 0) ukdDiffHTML = `<div class="r-chg up">â–²${diff}</div>`;
     else if(diff < 0) ukdDiffHTML = `<div class="r-chg dn">â–¼${Math.abs(diff)}</div>`;
   }
   const ukdHTML = `<div class="r-item ukd-item" title="Ulusal Kuvvet Derecesi (Ã–nceki: ${ukd.prev || 'â€”'})"><div class="r-type">UKD</div><div class="r-val">${ukd.val}</div>${ukdDiffHTML}</div>`;
  
  let opHTML = '';
  if (d.topOpenings && (d.topOpenings.white?.length > 0 || d.topOpenings.black?.length > 0)) {
    const wOp = d.topOpenings.white.join(', ') || 'Veri yok';
    const bOp = d.topOpenings.black.join(', ') || 'Veri yok';
    opHTML = `
      <div class="wld-row" style="margin-bottom:0">
        <div class="wld-box" style="flex:1;text-align:left;padding:6px;border-color:rgba(200,168,75,.3);background:rgba(200,168,75,.04);grid-column:1/span 2">
          <div class="wld-lbl" style="color:var(--text);margin-bottom:4px;font-size:9px">âšª Beyazla SÄ±k Oynananlar</div>
          <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(wOp)}">${escHtml(wOp)}</div>
        </div>
        <div class="wld-box" style="flex:1;text-align:left;padding:6px;border-color:rgba(176,190,197,.3);background:rgba(176,190,197,.04);grid-column:1/span 2">
          <div class="wld-lbl" style="color:var(--text);margin-bottom:4px;font-size:9px">âš« Siyahla SÄ±k Oynananlar</div>
          <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(bOp)}">${escHtml(bOp)}</div>
        </div>
      </div>
    `;
  }
  
  const days14=get14Days(username);
  const pipHtml=days14.map(day=>{
    const isT=day.date===todayStr(), hg=day.games>=APP.crit.minDailyGames, hp=day.puzzles>=APP.crit.minPuzzleDaily;
    const ag=day.games>0, ap=day.puzzles>0;
    const cls=(hg&&hp)?'pb':hg?'pg':hp?'pp':(ag&&ap)?'pa-both':ag?'pa-game':ap?'pa-puzz':'';
    return `<div class="pip ${cls}${isT?' today':''}" title="${day.date}: ${day.games} maÃ§, ${day.puzzles} bulmaca"></div>`;
  }).join('');
  const gs=getStreak(username,'games'), ps=getStreak(username,'puzzles');
  const heatLbl=gs>1?`ðŸ”¥ ${gs}g seri`:ps>1?`ðŸ§© ${ps}g seri`:'14 gÃ¼n';
  const bdgHtml=badges.map(b=>`<span class="badge ${b.cls}" title="${b.tip}">${b.icon} ${b.label}</span>`).join('');
  const bd=scoreBreakdown(username);
  const levelInfo = getStudentLevelInfo(username);
  const levelTag = `<div class="level-tag lvl-${levelSlug(levelInfo.level)}" title="${escHtml(levelInfo.group || levelInfo.level)}">${escHtml(levelInfo.level)}</div>`;
  const levelAndBadges = levelTag + bdgHtml;
  return `<div class="s-card ${cardCls} ${total===0?'faded':''}" data-user="${escHtml(username)}">
    <div class="card-head">
      <div class="card-top">
        <div class="s-info">
          <div class="avatar">${escHtml(username[0].toUpperCase())}${crown?`<span class="rank-crown">${crown}</span>`:''}</div>
          <div>
            <a href="https://lichess.org/@/${encodeURIComponent(username)}" target="_blank" class="s-name">${escHtml(getStudentDisplayName(username))}</a>
            <div class="s-sub">${d.title?`<b style="color:var(--accent)">[${escHtml(d.title)}]</b> Â· `:''}${d.online?'Ã‡evrimiÃ§i':'Ã‡evrimdÄ±ÅŸÄ±'}
              <div class="day-tag">ðŸŽ¯ ${APP.scorePeriod==='week'?'HaftalÄ±k':'14 GÃ¼nlÃ¼k'}: ${pSt.totalGames} maÃ§</div><div class="score-tag">â­ ${score} puan</div>
            </div>
          </div>
        </div>
        <div class="card-actions">
          <div class="s-dot ${d.online?'on':''}" title="${d.online?'Ã‡evrimiÃ§i':'Ã‡evrimdÄ±ÅŸÄ±'}"></div>
          <button class="rm-btn" data-rmuser="${escHtml(username)}" title="Ã‡Ä±kar">âœ•</button>
        </div>
      </div>
      <div class="card-badges">${levelAndBadges}</div>
      <div class="heat-row">${pipHtml}<span class="heat-lbl">${heatLbl}</span></div>
    </div>
    <div class="ratings-row">${rHTML}${ukdHTML}</div>
    <div class="stats">
      <div class="s-title">${APP.scorePeriod==='week'?'Bu HaftalÄ±k':'14 GÃ¼nlÃ¼k'} MaÃ§lar</div>
      <div class="wld-row">
        <div class="wld-box wb"><div class="wld-lbl">MaÃ§</div><div class="wld-val">${pSt.totalGames||0}</div></div>
        <div class="wld-box lb2"><div class="wld-lbl">Bulmaca</div><div class="wld-val">${pSt.totalPuzzles||0}</div></div>
        <div class="wld-box db"><div class="wld-lbl">Aktif GÃ¼n</div><div class="wld-val">${pSt.activeDays||0}</div></div>
      </div>
      
      <div class="puz-row">
        <div class="puz-left"><span style="font-size:14px">ðŸ§©</span><div><div style="font-size:11px;font-weight:600;color:var(--puzzle)">Bulmacalar</div><div class="puz-lbl">bugÃ¼n Ã§Ã¶zÃ¼len</div></div></div>
        <div class="puz-cnt">${d.puzzlesSolved??0}</div>
        <div class="puz-rat"><div>Puan</div><span>${d.puzzleRating??'â€”'}</span></div>
      </div>
      <div class="train-score-row">
        <div>
          <div style="font-size:11px;font-weight:600;color:var(--puzzle)">â­ Antrenman PuanÄ±</div>
          <div class="puz-lbl">${APP.scorePeriod==='week'?'Bu Hafta':'14 GÃ¼n'}: ${pSt.totalGames} maÃ§ Â· ${pSt.totalPuzzles} bulmaca</div>
        </div>
        <div class="train-pts">${score}</div>
        <div class="train-breakdown">${bd||'â€”'}</div>
      </div>
      ${opHTML?`<div class="s-title" style="margin-top:5px">Favori AÃ§Ä±lÄ±ÅŸlar (Son 7 GÃ¼n)</div>${opHTML}`:''}
    </div>
  </div>`;
}

// â”€â”€ KRÄ°TER PANELÄ° â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
window.toggleCrit=()=>{ const b=document.getElementById('critBody'),a=document.getElementById('critArrow'); b.classList.toggle('open'); a.textContent=b.classList.contains('open')?'â–²':'â–¼'; };
function buildCritPanel(){
  const isAdmin = PIN.getIsAdmin();
  const defs=[
    {key:'minWeeklyScore',  b:{cls:'b-warn',icon:'ðŸ›‘',lbl:'Baraj'},   name:'HaftalÄ±k Alt Baraj',  rule:'HaftalÄ±k antrenman baraj puanÄ±'},
    {key:'minDailyGames',   b:{cls:'b-active',icon:'âš¡',lbl:'Aktif'},        name:'Aktif Oyuncu',       rule:'GÃ¼nlÃ¼k min. maÃ§ sayÄ±sÄ±'},
    {key:'minWinRate',      b:{cls:'b-gold',  icon:'ðŸ†',lbl:'%Kazanma'},     name:'YÃ¼ksek Kazanma',     rule:'Min. kazanma oranÄ± (%)'},
    {key:'streakDays',      b:{cls:'b-streak',icon:'ðŸ”¥',lbl:'Seri'},         name:'MaÃ§ Serisi (gÃ¼n)',   rule:'Ãœst Ã¼ste kaÃ§ gÃ¼n?'},
    {key:'minPuzzleDaily',  b:{cls:'b-puzzle',icon:'ðŸ§©',lbl:'Bulmaca'},      name:'GÃ¼nlÃ¼k Bulmaca',     rule:'GÃ¼nlÃ¼k min. bulmaca'},
    {key:'streakPuzzleDays',b:{cls:'b-pstreak',icon:'ðŸŽ¯',lbl:'Bulmaca Seri'},name:'Bulmaca Serisi',     rule:'Ãœst Ã¼ste kaÃ§ gÃ¼n?'},
    {key:'ptWin',           b:{cls:'b-gold',  icon:'â­',lbl:'Kazanma pt'},   name:'Kazanma PuanÄ±',      rule:'Her kazanÄ±lan maÃ§ iÃ§in'},
    {key:'ptPlay',          b:{cls:'b-info',  icon:'â­',lbl:'Oynama pt'},    name:'Oynama PuanÄ±',       rule:'Her oynanan maÃ§ iÃ§in'},
    {key:'ptPuzzle',        b:{cls:'b-puzzle',icon:'â­',lbl:'Bulmaca pt'},   name:'Bulmaca PuanÄ±',      rule:'Her bulmaca iÃ§in'},
    {key:'ptDailyBonus',    b:{cls:'b-active',icon:'â­',lbl:'GÃ¼nlÃ¼k bonus'}, name:'GÃ¼nlÃ¼k MaÃ§ Bonusu',  rule:'GÃ¼nlÃ¼k kriteri karÅŸÄ±lama'},
    {key:'ptPuzzleBonus',   b:{cls:'b-puzzle',icon:'â­',lbl:'Bulmaca bonus'},name:'Bulmaca Bonusu',     rule:'Bulmaca kriteri karÅŸÄ±lama'},
    {key:'ptStreak',        b:{cls:'b-streak',icon:'â­',lbl:'Seri bonus'},   name:'Seri GÃ¼nlÃ¼k Bonus',  rule:'Aktif seri baÅŸÄ±na puan'},
  ];
  // Bullet toggle ayrÄ± render
  const chk = APP.crit.countBullet ? 'checked' : '';
  const lbl = APP.crit.countBullet ? 'Dahil' : 'HariÃ§';
  const dis = isAdmin ? '' : 'disabled';
  const bulletHTML = '<div class="crit-item" style="grid-column:1/-1;background:rgba(224,90,90,.06);border-color:rgba(224,90,90,.2)">'
    + '<span class="badge b-warn">ðŸ”´ Bullet</span>'
    + '<div class="crit-desc"><div class="crit-name">Bullet MaÃ§larÄ± Say</div>'
    + '<div class="crit-rule">MaÃ§ sayÄ±sÄ±, puan ve Ä±sÄ± haritasÄ±na dahil et</div></div>'
    + '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:var(--text-muted)">'
    + '<input type="checkbox" id="bulletToggle" '+chk+' '+dis+' onchange="toggleBullet(this.checked)"'
    + ' style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer"> '+lbl
    + '</label></div>';
  document.getElementById('critGrid').innerHTML=bulletHTML+defs.map(d=>`
    <div class="crit-item">
      <span class="badge ${d.b.cls}">${d.b.icon} ${d.b.lbl}</span>
      <div class="crit-desc"><div class="crit-name">${d.name}</div><div class="crit-rule">${d.rule}</div></div>
      <input class="crit-input" type="number" min="0" max="100" step="${d.key==='ptPuzzle'?'0.5':'1'}" value="${APP.crit[d.key]}" ${dis} onchange="updateCrit('${d.key}',this.value)">
    </div>`).join('');
}
window.updateCrit=async(key,val)=>{ 
  if(!PIN.getIsAdmin()){ showToast('Bu iÅŸlem iÃ§in yÃ¶netici giriÅŸi gerekli',true); buildCritPanel(); return; }
  APP.crit[key]=Math.max(0,parseFloat(val)||0); await fbSaveConfig(); renderGrid(); renderChamps(); renderScoreTable(); 
};
window.setClubLogo=()=>{
  const input=document.createElement('input');
  input.type='file'; input.accept='image/*';
  input.onchange=e=>{
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      APP.clubLogoUrl=ev.target.result;
      localStorage.setItem('chess_club_logo',ev.target.result);
      showToast('KulÃ¼p logosu kaydedildi âœ“');
      if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
    };
    reader.readAsDataURL(file);
  };
  input.click();
};

window.toggleBullet=async(checked)=>{
  if(!PIN.getIsAdmin()){ showToast('Bu iÅŸlem iÃ§in yÃ¶netici giriÅŸi gerekli',true); buildCritPanel(); return; }
  APP.crit.countBullet=checked?1:0;
  // Checkbox label gÃ¼ncelle
  const lbl=document.getElementById('bulletToggle');
  if(lbl&&lbl.parentElement) lbl.parentElement.lastChild.textContent=' '+(checked?'Dahil':'HariÃ§');
  await fbSaveConfig();
  showToast('Bullet maÃ§lar '+(checked?'dahil edildi':'hariÃ§ tutuldu'));
  // Veriyi yeniden yÃ¼kle (bullet durumu deÄŸiÅŸti)
  if(getStudents().length>0) refreshAll();
};

// â”€â”€ YARDIMCILAR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchWT(url, opts={}, ms=10000, retries=2){
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(t);
      // Lichess API Rate Limit (429) tespiti
      if (res.status === 429 && i < retries) {
        await new Promise(r => setTimeout(r, 6000)); // 6 saniye ceza beklemesi
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}
function fmtTime(date){
  const diff=Math.floor((Date.now()-date.getTime())/60000);
  if(diff<1) return 'az Ã¶nce'; if(diff<60) return diff+'dk'; if(diff<1440) return Math.floor(diff/60)+'sa'; return Math.floor(diff/1440)+'g';
}
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function setLoadStatus(msg){ const el=document.getElementById('loadStatus'); if(msg){el.textContent=msg;el.classList.add('show');}else{el.textContent='';el.classList.remove('show');} }
function showToast(msg,isErr=false){ const t=document.getElementById('toast'); t.textContent=msg; t.className='toast show'+(isErr?' err':''); setTimeout(()=>{t.className='toast';},3000); }

// Event delegation
document.addEventListener('click',e=>{
  const b=e.target.closest('.rm-btn');
  if(b){ const u=b.dataset.rmuser; if(u) removeStudent(u); }
});

document.addEventListener('wheel',e=>{
  const bar=e.target.closest?.('#groupBar');
  if(!bar || bar.scrollWidth<=bar.clientWidth || Math.abs(e.deltaY)<=Math.abs(e.deltaX)) return;
  e.preventDefault();
  bar.scrollLeft += e.deltaY;
  updateGroupScrollState();
}, {passive:false});

document.addEventListener('scroll',e=>{
  if(e.target?.id==='groupBar') updateGroupScrollState();
}, true);

window.addEventListener('resize', updateGroupScrollState);



// â”€â”€ PIN SÄ°STEMÄ° (module scope dÄ±ÅŸÄ±nda window.PIN olarak) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
window.PIN = (function(){
  const DEFAULT = '1234';
  function hash(p){ let h=5381; for(let i=0;i<p.length;i++) h=((h<<5)+h)+p.charCodeAt(i)>>>0; return h.toString(16); }

  let buf = '', isAdmin = false;

  function updateDots(){
    for(let i=0;i<4;i++){
      const el=document.getElementById('pd'+i);
      if(el) el.classList.toggle('filled', i<buf.length);
    }
  }

  function setErr(msg){
    const el=document.getElementById('pinErr');
    if(el) el.textContent=msg;
  }

  function shake(){
    const dots=document.getElementById('pinDots')||document.querySelector('.pin-dots');
    if(!dots) return;
    dots.classList.remove('pin-shake');
    void dots.offsetWidth;
    dots.classList.add('pin-shake');
    setTimeout(()=>dots.classList.remove('pin-shake'),350);
  }

  function getStoredHash(){
    // Geriye dÃ¶nÃ¼k uyumluluk â€” yeni sistemde kullanÄ±lmaz
    if(window.APP && APP.crit && APP.crit._pinHash) return APP.crit._pinHash;
    return hash(DEFAULT);
  }


  async function addUser(){
    if(!isAdmin){ showToast('Bu iÅŸlem iÃ§in yÃ¶netici giriÅŸi gerekli', true); return; }
    const name = prompt('Yeni hocanÄ±n adÄ± (Ã¶rn: Ahmet Hoca):');
    if(!name || !name.trim()) return;
    const pin = prompt('Yeni 4 haneli PIN:');
    if(!pin || !/^\d{4}$/.test(pin)){ showToast('GeÃ§ersiz PIN â€” 4 rakam olmalÄ±', true); return; }
    const pin2 = prompt('PIN tekrar:');
    if(pin !== pin2){ showToast('PIN eÅŸleÅŸmedi', true); return; }

    const uid = 'u' + Date.now();
    const newHash = hash(pin);

    try{
      // Mevcut users listesini Firebase'den oku
      const usersSnap = await getDoc(doc(db, 'panel', 'users'));
      const allUsers = usersSnap.exists() ? usersSnap.data() : {};
      allUsers[uid] = { name: name.trim(), pinHash: newHash };

      // users dokÃ¼manÄ±nÄ± gÃ¼ncelle
      await setDoc(doc(db, 'panel', 'users'), allUsers);
      APP.users = allUsers;

      // Yeni hoca iÃ§in boÅŸ config oluÅŸtur
      const defaultGid = 'g' + uid;
      await setDoc(doc(db, 'panel', 'config_' + uid), {
        groups: [{ id: defaultGid, name: 'A Grubu' }],
        criteria: {
          minDailyGames: APP.crit.minDailyGames,
          minWinRate: APP.crit.minWinRate,
          streakDays: APP.crit.streakDays,
          minPuzzleDaily: APP.crit.minPuzzleDaily,
          streakPuzzleDays: APP.crit.streakPuzzleDays,
          ptWin: APP.crit.ptWin,
          ptPlay: APP.crit.ptPlay,
          ptPuzzle: APP.crit.ptPuzzle,
          ptDailyBonus: APP.crit.ptDailyBonus,
          ptPuzzleBonus: APP.crit.ptPuzzleBonus,
          ptStreak: APP.crit.ptStreak
        },
        updatedAt: Date.now()
      });

      // BoÅŸ Ã¶ÄŸrenci listesi oluÅŸtur
      await setDoc(doc(db, 'panel', 'students_' + uid + '_' + defaultGid), {
        list: [],
        updatedAt: Date.now()
      });

      showToast(name.trim() + ' eklendi âœ“');
    } catch(e) {
      console.error('Hoca ekleme hatasÄ±:', e);
      showToast('Hata: ' + e.message, true);
    }
  }


  async function checkPin(){
    if(buf.length<4) return;
    // Firebase'den taze users listesini Ã§ek
    try{
      const snap=await getDoc(doc(db,'panel','users'));
      if(snap.exists()) APP.users=snap.data();
    }catch(e){ console.warn('Users okuma:',e); }
    const users=APP.users||{};
    let matchUid=null, matchUser=null;
    for(const [uid,u] of Object.entries(users)){
      if(hash(buf)===u.pinHash){ matchUid=uid; matchUser=u; break; }
    }
    // Geriye dÃ¶nÃ¼k uyumluluk
    if(!matchUid && Object.keys(users).length===0 && hash(buf)===getStoredHash()){
      matchUid='legacy'; matchUser={name:'YÃ¶netici'};
    }
    if(matchUid){
      // Legacy â†’ users dokÃ¼manÄ±na taÅŸÄ±
      if(matchUid==='legacy'){
        try{
          const uid='u'+Date.now();
          const nu={}; nu[uid]={name:'YÃ¶netici',pinHash:hash(buf)};
          await setDoc(doc(db, 'panel', 'users'), nu);
          APP.users=nu; APP.currentUser=uid; matchUid=uid;
        }catch(e){ APP.currentUser=null; }
      } else {
        APP.currentUser=matchUid;
      }
      APP.currentUserName=matchUser.name;
      isAdmin=true;
      APP.groups=[]; APP.studentLists={};
      await fbLoad();
      document.getElementById('pinOverlay').style.display='none';
      document.body.classList.remove('readonly');
      const ind=document.getElementById('adminInd');
      if(ind){ ind.classList.add('show'); ind.textContent='ðŸ‘¤ '+escHtml(matchUser.name); }
      const al=document.getElementById('btnAdminLogin'); if(al) al.style.display='none';
      const bp=document.getElementById('btnChangePin'); if(bp) bp.style.display='flex';
      const bau=document.getElementById('btnAddUser');  if(bau) bau.style.display='flex';
      const bcl=document.getElementById('btnClubLogo'); if(bcl) bcl.style.display='flex';
      const buk=document.getElementById('btnBulkUkd');  if(buk) buk.style.display='flex';
      const bsl=document.getElementById('btnStudentList'); if(bsl) bsl.style.display='flex';
      const bst=document.getElementById('btnStats');    if(bst) bst.style.display='flex';
      const bab=document.getElementById('btnAutoBest'); if(bab) bab.style.display='flex';
      const bl=document.getElementById('btnLogout');    if(bl)  bl.style.display='flex';
      renderGroupBar(); renderHeader(); buildCritPanel(); renderGrid();
      if(getStudents().length>0) refreshAll();
      renderChamps(); renderScoreTable();
    } else {
      setErr('HatalÄ± PIN'); shake(); buf=''; updateDots();
    }
  }

  function press(d){
    if(buf.length>=4) return;
    setErr('');
    buf+=d; updateDots();
    if(buf.length===4) setTimeout(checkPin,150);
  }

  function del(){
    buf=buf.slice(0,-1); updateDots(); setErr('');
  }

  function viewOnly(){
    isAdmin=false;
    APP.currentUser=null; APP.currentUserName=null;
    document.getElementById('pinOverlay').style.display='none';
    document.body.classList.add('readonly');
    const ind=document.getElementById('adminInd'); if(ind) ind.classList.remove('show');
    // TÃ¼m gruplarÄ±n verilerini yÃ¼kle (hangi kullanÄ±cÄ±ya ait olduÄŸu bilinmiyor,
    // gÃ¶rÃ¼ntÃ¼leme modunda ilk kullanÄ±cÄ±nÄ±n verilerini gÃ¶ster)
    (async()=>{
      // users listesinden ilk kullanÄ±cÄ±yÄ± bul â€” currentUser olarak ayarla (sadece okuma)
      const users=APP.users||{};
      const uids=Object.keys(users);
      if(uids.length>0){
        APP.currentUser=uids[0]; // gÃ¶rÃ¼ntÃ¼leme modunda ilk kullanÄ±cÄ±nÄ±n verisi
      }
      await fbLoad();
      renderGroupBar(); renderHeader(); buildCritPanel(); renderGrid();
      if(getStudents().length>0) refreshAll();
      renderChamps(); renderScoreTable();
    })();
  }

  function logout(){
    isAdmin=false;
    document.body.classList.add('readonly');
    const ind=document.getElementById('adminInd'); if(ind) ind.classList.remove('show');
    const al=document.getElementById('btnAdminLogin'); if(al) al.style.display='flex';
    const bp=document.getElementById('btnChangePin'); if(bp) bp.style.display='none';
    const bl=document.getElementById('btnLogout');   if(bl) bl.style.display='none';
    const bau=document.getElementById('btnAddUser'); if(bau) bau.style.display='none';
    const bcl=document.getElementById('btnClubLogo'); if(bcl) bcl.style.display='none';
    const buk=document.getElementById('btnBulkUkd'); if(buk) buk.style.display='none';
    const bsl=document.getElementById('btnStudentList'); if(bsl) bsl.style.display='none';
    const bst=document.getElementById('btnStats');    if(bst) bst.style.display='none';
    const bab=document.getElementById('btnAutoBest'); if(bab) bab.style.display='none';
    showToast('Oturum kapatÄ±ldÄ±');
  }

  async function change(){
    if(!isAdmin){ showToast('Ã–nce yÃ¶netici giriÅŸi yapÄ±n',true); return; }
    const p1=prompt('Yeni 4 haneli PIN:');
    if(!p1||!/^\d{4}$/.test(p1)){ showToast('GeÃ§ersiz PIN â€” 4 rakam olmalÄ±',true); return; }
    const p2=prompt('PIN tekrar:');
    if(p1!==p2){ showToast('PIN eÅŸleÅŸmedi',true); return; }
    const newHash=hash(p1);
    // PIN'i users dokÃ¼manÄ±nda sakla (criteria'da deÄŸil)
    try{
      // Mevcut users listesini Firebase'den oku
      const usersSnap=await getDoc(doc(db,'panel','users'));
      const allUsers=usersSnap.exists()?usersSnap.data():{};
      const uid=APP.currentUser||'legacy';
      if(!allUsers[uid]) allUsers[uid]={name:APP.currentUserName||'Yonetici',pinHash:hash('1234')};
      allUsers[uid].pinHash=newHash;
      // Firebase'e yaz ve bekle
      await setDoc(doc(db,'panel','users'),allUsers);
      // Bellekte gÃ¼ncelle
      APP.users=allUsers;
      showToast('PIN gÃ¼ncellendi âœ“');
    }catch(e){
      showToast('PIN kayÄ±t hatasÄ±: '+e.message,true);
    }
  }



  function getIsAdmin(){ return isAdmin; }

  function init(){ if(typeof updateSubTitle==='function') updateSubTitle(); }
  function showLogin(){
    buf = ''; updateDots(); setErr('');
    document.getElementById('pinOverlay').style.display = 'flex';
  }
  return { press, del, viewOnly, logout, change, addUser, getIsAdmin, init, showLogin };
})();

window.closeLogin = () => {
  document.getElementById('pinOverlay').style.display = 'none';
};


// â”€â”€ FUTCARD SÄ°STEMÄ° â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FotoÄŸraflar Firestore'da base64 olarak saklanÄ±r (/panel/photos dokÃ¼manÄ±)
// Her cihaz direkt Firestore'dan okur â€” IndexedDB/Storage/pv mantÄ±ÄŸÄ± yok.

// FotoÄŸraf veritabanÄ±nÄ± bellekte tut (sayfa iÃ§i Ã¶nbellek)
let _photoCache = {}; // { username: base64dataUrl }
let _photoCacheLoaded = false;

async function fcLoadAllPhotos(){
  try {
    const snap = await getDocs(collection(db,'photos'));
    _photoCache = {};
    snap.forEach(docSnap => { _photoCache[docSnap.id] = docSnap.data().data; });
    _photoCacheLoaded = true;
    // GerÃ§ek zamanlÄ± dinle â€” baÅŸka cihazdan fotoÄŸraf eklenince gÃ¼ncelle
    onSnapshot(collection(db,'photos'), snap => {
      _photoCache = {};
      snap.forEach(docSnap => { _photoCache[docSnap.id] = docSnap.data().data; });
      if(document.getElementById('viewChesscard').style.display !== 'none'){
        renderChesscards();
      }
    });
  } catch(e){
    console.warn('FotoÄŸraflar yÃ¼klenemedi:', e);
    _photoCache = {};
    _photoCacheLoaded = true;
  }
}

function fcGetPhoto(username){
  // Senkron â€” bellekteki Ã¶nbellekten dÃ¶ner
  return _photoCache[username] || null;
}

// FotoÄŸraf alanÄ± iÃ§in kart arka plan renkleri
const FC_BG_COLORS = {
  'fc-gold':   '#3a2800',
  'fc-silver': '#252b3a',
  'fc-bronze': '#321800',
  'fc-normal': '#152030'
};

// FotoÄŸrafÄ± canvas ile hazÄ±rla:
// - Kart rengini arka plana Ã§iz (ÅŸeffaf PNG sorunu yok)
// - FotoÄŸrafÄ± oranÄ±nÄ± koruyarak ortala
// - Sabit 400x440px (PNG'de 2000x2200 @ 5x) Ã§Ä±ktÄ±
window.fcPreparePhoto = function(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Kart boyutuna uygun ve Firebase 1MB dokÃ¼man limitini aÅŸmayacak ÅŸekilde boyutu optimize edelim
      const targetWidth = 240; 
      const scale = targetWidth / img.width;
      canvas.width = targetWidth;
      canvas.height = img.height * scale;

      // KANVASIN TAMAMEN ÅžEFFAF OLDUÄžUNDAN EMÄ°N OLALIM
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // FotoÄŸrafÄ± Ã§iz (Arka plan eklemeden)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // WEBP OLARAK KAYDET (ÅžeffaflÄ±ÄŸÄ± korur, PNG'den Ã§ok daha az yer kaplar)
      // VarsayÄ±lan kalite (0.85) ile boyut ciddi oranda dÃ¼ÅŸer
      resolve(canvas.toDataURL('image/webp', 0.85));
    };
    img.src = dataUrl;
  });
};
async function fcSaveAllPhotos(){
  // ArtÄ±k kullanÄ±lmÄ±yor, her fotoÄŸraf ayrÄ± kaydediliyor.
}

window.fcDeletePhoto = async function(username){
  if(!PIN.getIsAdmin()){ showToast('Yetkiniz yok', true); return; }
  if(!confirm(`"${username}" iÃ§in fotoÄŸrafÄ± silmek istediÄŸinize emin misiniz?`)) return;
  try {
    delete _photoCache[username];
    await deleteDoc(doc(db,'photos',username));
    renderChesscards();
    showToast('FotoÄŸraf silindi âœ“');
  } catch(e){
    console.error('FotoÄŸraf silme hatasÄ±:', e);
    showToast('Hata: ' + e.message, true);
  }
}

// GÃ¶rÃ¼nÃ¼m geÃ§iÅŸi
window.switchView = function(view){
  document.querySelectorAll('.view-tab').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
  document.getElementById('viewPanel').style.display   = view==='panel'  ?'' :'none';
  document.getElementById('viewChesscard').style.display = view==='chesscard'?'' :'none';
  if(view==='chesscard') renderChesscards();
};

// Futcard Ä±zgarasÄ±nÄ± oluÅŸtur
async function renderChesscards(){
  const students = getStudents().filter(u=>APP.liveData[u]&&!APP.liveData[u].error);
  const grid = document.getElementById('chesscardGrid');
  if(students.length===0){
    grid.innerHTML='<div class="empty"><div class="ei">ðŸƒ</div><h3>HenÃ¼z Ã¶ÄŸrenci yok</h3><p>Panel gÃ¶rÃ¼nÃ¼mÃ¼nden Ã¶ÄŸrenci ekle.</p></div>';
    return;
  }
  const period = APP.scorePeriod||'week';
  const scored = [...students].map(u=>({u,pts:calcScore(u,period)})).sort((a,b)=>b.pts-a.pts);

  grid.innerHTML = '';
  
  scored.forEach(({u,pts},idx)=>{
    const d  = APP.liveData[u];
    const st = periodStats(u,period);
    const rank = idx+1;
    const fcCls = rank===1?'fc-gold':rank===2?'fc-silver':rank===3?'fc-bronze':'fc-normal';
    const ukd = getStudentUkd(u);

    const card = document.createElement('div');
    card.className = `chesscard ${fcCls}`;
    card.setAttribute('data-user', u);

    card.innerHTML = `
      <div class="chesscard-inner">
        <div class="fc-top">
          <div class="fc-score">${pts}</div>
          <div class="fc-rank-badge">#${rank}</div>
        </div>
        
        <div class="fc-photo-wrap" onclick="fcPhotoClick('${escHtml(u)}')">
          <div class="fc-photo-container" id="fc-photo-${idx}">
            <div class="fc-photo-placeholder">ðŸ‘¤</div>
          </div>
          <div id="fc-delete-${idx}"></div>
        </div>

        <div class="fc-name">${escHtml(getStudentDisplayName(u))}</div>

        <div class="fc-stats">
          <div class="fc-stat">
            <span class="fc-stat-label">MAÃ‡</span>
            <span class="fc-stat-val">${st.totalGames}</span>
          </div>
          <div class="fc-stat">
            <span class="fc-stat-label">BULMACA</span>
            <span class="fc-stat-val">${st.totalPuzzles}</span>
          </div>
          <div class="fc-stat">
            <span class="fc-stat-label">UKD</span>
            <span class="fc-stat-val">${ukd.val}</span>
          </div>
        </div>

        <div class="fc-screen-only">
            <button class="fc-dl-btn" onclick="event.stopPropagation();downloadCard('${escHtml(u)}')">â¬‡</button>
        </div>
      </div>`;
    
    grid.appendChild(card);
    
    const photoDataUrl = fcGetPhoto(u);
    const container = document.getElementById(`fc-photo-${idx}`);
    const deleteContainer = document.getElementById(`fc-delete-${idx}`);
    if(container && photoDataUrl){
      container.innerHTML = `<img class="fc-photo" src="${photoDataUrl}">`;
      if(PIN.getIsAdmin() && deleteContainer){
        deleteContainer.innerHTML = `<button class="fc-delete-btn" onclick="event.stopPropagation();fcDeletePhoto('${escHtml(u)}')" title="Sil">âœ•</button>`;
      }
    }
  });
}
 
// FotoÄŸraf tÄ±klama â€” yÃ¶netici modunda yÃ¼kleme aÃ§
window.fcPhotoClick = function(username){
  if(!PIN.getIsAdmin()){ showToast('YÃ¶netici giriÅŸi gerekli', true); return; }
  const input = document.getElementById('fcPhotoInput');
  input.onchange = async(e)=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async(ev)=>{
      setSyncStatus('syncing', 'HazÄ±rlanÄ±yorâ€¦');
      
      // 1. FotoÄŸrafÄ± ÅŸeffaf PNG olarak hazÄ±rla
      const prepared = await fcPreparePhoto(ev.target.result);
      
      // 2. Ã–nce yerel belleÄŸe yaz (UI anÄ±nda gÃ¼ncellensin)
      _photoCache[username] = prepared;
      renderChesscards(); 
      
      // 3. Firebase'e kaydet
      try {
        await setDoc(doc(db,'photos',username), { data: prepared });
        showToast('FotoÄŸraf baÅŸarÄ±yla kaydedildi âœ“');
        setSyncStatus('ok', 'Firebase gÃ¼ncellendi âœ“');
      } catch(err) {
        showToast('KayÄ±t hatasÄ±: ' + err.message, true);
      }
    };
    reader.readAsDataURL(file);
    input.value = '';
  };
  input.click();
};
// Tek kart PNG indir
window.downloadCard = async function(username){
  const card = document.querySelector(`.chesscard[data-user="${CSS.escape(username)}"]`);
  if(!card){ showToast('Kart bulunamadÄ±',true); return; }
  try{
    if(!window.html2canvas){
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }

    const TARGET_W = 1000;
    const TARGET_H = 1550;

    // Kart stilini geÃ§ici olarak sabit boyuta getir
    const originalStyle = card.style.cssText;
    const RENDER_W = 200; // ekrandaki kart geniÅŸliÄŸi
    const RENDER_H = Math.round(RENDER_W * TARGET_H / TARGET_W); // 310px

    const hideEls = card.querySelectorAll('.fc-screen-only, .fc-delete-btn');
    hideEls.forEach(el=>{ el.style.visibility='hidden'; });

    card.style.transform  = 'none';
    card.style.transition = 'none';
    card.style.width      = RENDER_W + 'px';
    card.style.height     = RENDER_H + 'px';
    card.style.overflow   = 'hidden';

    // img etiketlerinin yÃ¼klenmesini bekle
    const imgs = card.querySelectorAll('img');
    await Promise.all(Array.from(imgs).map(img =>
      img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
    ));

    // html2canvas ile yakalama
    const captured = await html2canvas(card, {
      backgroundColor: null,
      scale: 4,
      useCORS: true,
      logging: false,
      allowTaint: true,
      imageTimeout: 15000,
      width: RENDER_W,
      height: RENDER_H,
      onclone: (clonedDoc) => {
        const clonedCard = clonedDoc.querySelector(`.chesscard[data-user="${CSS.escape(username)}"]`);
        if(clonedCard){
          clonedCard.style.transform = 'none';
          clonedCard.style.boxShadow = 'none';
        }
      }
    });

    // Orijinal stilleri geri yÃ¼kle
    card.style.cssText = originalStyle;
    hideEls.forEach(el=>{ el.style.visibility=''; });

    // Sabit 1000x1550 canvas'a Ã§iz (captured zaten 1000x310 ~ ama biz tam 1550 istiyoruz)
    // captured: 1000 x (TARGET_W/RENDER_W * RENDER_H) = 1000 x 1550 â€” zaten doÄŸru boyut
    const link = document.createElement('a');
    link.download = `chesscard-${username}.png`;
    link.href = captured.toDataURL('image/png');
    link.click();
    showToast(`${username} kartÄ± indirildi âœ“`);
  }catch(e){ showToast('Ä°ndirme hatasÄ±: '+e.message,true); console.error(e); }
};

// TÃ¼m kartlarÄ± indir
window.downloadAllCards = async function(){
  const students = getStudents().filter(u=>APP.liveData[u]&&!APP.liveData[u].error);
  if(students.length===0) return;
  if(!window.html2canvas){
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  }
  showToast('Kartlar hazÄ±rlanÄ±yorâ€¦');
  for(const u of students){
    await downloadCard(u);
    await new Promise(r=>setTimeout(r,300));
  }
};

function loadScript(src){
  return new Promise((res,rej)=>{
    const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej;
    document.head.appendChild(s);
  });
}

window.openBulkUkdModal = () => {
  if(!PIN.getIsAdmin()){ showToast('Bu iÅŸlem iÃ§in yÃ¶netici giriÅŸi gerekli',true); return; }
  if(!APP.activeGid){ showToast('Ã–nce bir grup seÃ§',true); return; }
  document.getElementById('bulkUkdInput').value = '';
  document.getElementById('modalBulkUkd').style.display = 'flex';
  setTimeout(() => document.getElementById('bulkUkdInput').focus(), 50);
};

window.processBulkUkd = async () => {
  if(!APP.activeGid){ showToast('Ã–nce bir grup seÃ§',true); return; }
  const input = document.getElementById('bulkUkdInput').value;
  if(!input.trim()) return;
  
  const currentList = getStudentList();
  let updateCount = 0;
  
  const lines = input.split('\n');
  
  // Ekstra gÃ¼Ã§lÃ¼ normalizasyon (TÃ¼m TÃ¼rkÃ§e karakterleri Ä°ngilizce karÅŸÄ±lÄ±ÄŸÄ±na Ã§evirir)
  const ultraNorm = (s) => {
    if(!s) return '';
    return s.toString().toUpperCase()
      .replace(/Ä°/g, 'I').replace(/Åž/g, 'S').replace(/Ã‡/g, 'C')
      .replace(/Äž/g, 'G').replace(/Ãœ/g, 'U').replace(/Ã–/g, 'O')
      .replace(/I/g, 'I').replace(/Ä±/g, 'I')
      .replace(/[^A-Z0-9\s]/g, ' ') // Harf ve rakam dÄ±ÅŸÄ±ndakileri boÅŸluk yap
      .replace(/\s+/g, ' ') // Fazla boÅŸluklarÄ± temizle
      .trim();
  };

  const newList = currentList.map(student => {
    let sObj = normalizeStudentRecord(student);
    
    let nameToMatch = sObj.n;
    if(!nameToMatch && APP.liveData[sObj.u] && !APP.liveData[sObj.u].error) {
      nameToMatch = APP.liveData[sObj.u].displayName;
    }
    
    if(!nameToMatch) return sObj;
    
    // Ä°smi parÃ§alara ayÄ±r ve ultra-normalize et
    const normParts = ultraNorm(nameToMatch).split(' ').filter(p => p.length >= 2);
    if(normParts.length === 0) return sObj;
    
    for(const line of lines) {
      const normLine = ultraNorm(line);
      
      // SatÄ±rda ismin TÃœM parÃ§alarÄ± geÃ§iyor mu?
      const allPartsMatch = normParts.every(part => normLine.includes(part));
      
      if(allPartsMatch) {
        // SatÄ±rdaki tÃ¼m sayÄ±larÄ± bul (UKD aralÄ±ÄŸÄ±: 100-2999)
        const matches = line.match(/\b(\d{3,4})\b/g);
        if(matches && matches.length > 0) {
          // SatÄ±rdaki en bÃ¼yÃ¼k sayÄ±yÄ± UKD kabul et (sÄ±ra no, yaÅŸ gibi deÄŸerlerden daha bÃ¼yÃ¼ktÃ¼r)
          const possibleScores = matches.map(Number).filter(n => n >= 100 && n <= 2999);
          if(possibleScores.length > 0) {
            const newUkd = Math.max(...possibleScores).toString();
            // Puan deÄŸiÅŸtiyse eskisini kaydet
            if(sObj.ukd && sObj.ukd !== newUkd) {
              sObj.pUkd = sObj.ukd;
            }
            sObj.ukd = newUkd;
            updateCount++;
            break;
          }
        }
      }
    }
    return sObj;
  });
  
  APP.studentLists[APP.activeGid] = newList;
  await fbSaveStudents(APP.activeGid);
  
  closeModal('modalBulkUkd');
  renderGrid();
  renderChesscards();
  showToast(`${updateCount} Ã¶ÄŸrencinin UKD puanÄ± gÃ¼ncellendi âœ“`);
};

window.openStudentListModal = () => {
  if(!PIN.getIsAdmin()){ showToast('Bu iÅŸlem iÃ§in yÃ¶netici giriÅŸi gerekli',true); return; }
  const body = document.getElementById('allStudentBody');
  body.innerHTML = '';
  
  let allStudents = [];
  APP.groups.forEach(g => {
    const list = getStudentList(g.id);
    list.forEach(s => {
      const sObj = normalizeStudentRecord(s);
      allStudents.push({
        groupName: g.name,
        username: sObj.u,
        realName: sObj.n || (APP.liveData[sObj.u]?.displayName || sObj.u),
        ukd: sObj.ukd || 'â€”',
        lic: sObj.lic || 'â€”'
      });
    });
  });

  // Ä°sme gÃ¶re sÄ±rala
  allStudents.sort((a,b) => a.realName.localeCompare(b.realName, 'tr-TR'));

  allStudents.forEach(s => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border)';
    tr.innerHTML = `
      <td style="padding: 10px; border-right: 1px solid var(--border);">${escHtml(s.groupName)}</td>
      <td style="padding: 10px; border-right: 1px solid var(--border); font-weight:600;">${escHtml(s.realName)}</td>
      <td style="padding: 10px; border-right: 1px solid var(--border); color: var(--text-muted);">${escHtml(s.username)}</td>
      <td style="padding: 10px; border-right: 1px solid var(--border);">${escHtml(s.ukd)}</td>
      <td style="padding: 10px;">${escHtml(s.lic)}</td>
    `;
    body.appendChild(tr);
  });

  document.getElementById('modalStudentList').style.display = 'flex';
};

window.copyStudentList = () => {
  const table = document.getElementById('allStudentTable');
  let text = "Grup\tAd Soyad\tLichess AdÄ±\tUKD\tLisans No\n";
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    text += Array.from(cells).map(c => c.textContent.trim()).join('\t') + '\n';
  });

  navigator.clipboard.writeText(text).then(() => {
    showToast('Liste panoya kopyalandÄ± âœ“');
  }).catch(() => {
    showToast('Kopyalama baÅŸarÄ±sÄ±z', true);
  });
};

window.autoCreateBestGroup = async () => {
  if(!PIN.getIsAdmin()){ showToast('Bu iÅŸlem iÃ§in yÃ¶netici giriÅŸi gerekli',true); return; }
  
  const countStr = prompt("HaftanÄ±n en iyileri grubuna kaÃ§ sporcu eklensin?", "10");
  const count = parseInt(countStr);
  if(isNaN(count) || count <= 0) return;

  const levelInput = prompt("Hangi seviye iÃ§in hesaplansÄ±n? (TÃ¼mÃ¼, Genel, BaÅŸlangÄ±Ã§, Orta, Ä°leri)", "TÃ¼mÃ¼");
  if(levelInput === null) return;
  const normalizedLevel = levelInput.trim().toLocaleLowerCase('tr-TR');
  const levelMap = {
    'tÃ¼mÃ¼': null,
    'tumu': null,
    'hepsi': null,
    'genel': 'Genel',
    'baÅŸlangÄ±Ã§': 'BaÅŸlangÄ±Ã§',
    'baslangic': 'BaÅŸlangÄ±Ã§',
    'orta': 'Orta',
    'ileri': 'Ä°leri'
  };
  if(!(normalizedLevel in levelMap)){
    showToast('Seviye TÃ¼mÃ¼, Genel, BaÅŸlangÄ±Ã§, Orta veya Ä°leri olmalÄ±', true);
    return;
  }
  const selectedLevel = levelMap[normalizedLevel];

  const myId = ++APP.refreshId;
  setSyncStatus('syncing', 'Sporcular gÃ¼ncelleniyorâ€¦');
  
  // 1. TÃ¼m gruplardaki benzersiz sporcularÄ± topla
  const allStudentMap = new Map();
  const period = 'week';
  
  APP.groups.forEach(g => {
    if(g.name === "Haftanın En İyileri") return;
    if(g.name.startsWith("Haftanın En İyileri - ")) return;
    if(g.name.startsWith("HaftanÃ„Â±n En Ã„Â°yileri - ")) return;
    if(selectedLevel && (g.level || 'Genel') !== selectedLevel) return;
    if(g.name === "HaftanÄ±n En Ä°yileri") return;
    const list = getStudentList(g.id);
    list.forEach(s => {
      const u = studentUsername(s);
      if(u && !allStudentMap.has(u)) allStudentMap.set(u, { ...normalizeStudentRecord(s), level: g.level || 'Genel', groupName: g.name });
    });
  });

  const allUsers = [...allStudentMap.keys()];
  if(allUsers.length === 0) {
    showToast('Hesaplanacak sporcu bulunamadÄ±', true);
    setSyncStatus('ok', 'Firebase baÄŸlÄ± âœ“');
    return;
  }

  setLoadStatus(`HaftanÄ±n en iyileri iÃ§in gÃ¼ncelleniyorâ€¦ 0/${allUsers.length}`);
  for(let i=0; i<allUsers.length; i++){
    if(myId!==APP.refreshId){ setLoadStatus(''); return; }
    const u = allUsers[i];
    setLoadStatus(`HaftanÄ±n en iyileri iÃ§in gÃ¼ncelleniyorâ€¦ ${i+1}/${allUsers.length}`);
    await loadOneStudent(u, myId);
    if(myId!==APP.refreshId){ setLoadStatus(''); return; }
    if(i < allUsers.length - 1) await new Promise(r=>setTimeout(r,4000));
  }
  setLoadStatus('');

  const allStudents = allUsers
    .filter(u => APP.liveData[u] && !APP.liveData[u].error)
    .map(u => ({ student: allStudentMap.get(u), pts: calcScore(u, period) }));

  if(allStudents.length === 0) {
    showToast('Hesaplanacak sporcu bulunamadÄ±', true);
    setSyncStatus('ok', 'Firebase baÄŸlÄ± âœ“');
    return;
  }

  // 2. Puana gÃ¶re sÄ±rala ve ilk X kiÅŸiyi al
  allStudents.sort((a,b) => b.pts - a.pts);
  const bestStudents = allStudents.slice(0, count).map(s => s.student);

  // 3. "HaftanÄ±n En Ä°yileri" grubunu bul veya oluÅŸtur
  let groupName = "Haftanın En İyileri";
  groupName = selectedLevel ? `Haftanın En İyileri - ${selectedLevel}` : groupName;
  let targetGroup = APP.groups.find(g => g.name === groupName);
  
  if(!targetGroup) {
    const newGid = 'best_' + Date.now();
    targetGroup = { id: newGid, name: groupName, level: selectedLevel || 'Genel' };
    APP.groups.push(targetGroup);
  } else {
    targetGroup.level = selectedLevel || targetGroup.level || 'Genel';
  }

  // 4. Ã–ÄŸrenci listesini gÃ¼ncelle ve kaydet
  APP.studentLists[targetGroup.id] = normalizeStudentList(bestStudents);
  APP.activeGid = targetGroup.id;

  await fbSaveConfig();
  await fbSaveStudents(targetGroup.id);

  renderGroupBar();
  renderHeader();
  renderGrid();
  renderChamps();
  renderScoreTable();
  
  setSyncStatus('ok', 'Firebase baÄŸlÄ± âœ“');
  showToast(`${bestStudents.length} sporcu ile "${groupName}" grubu gÃ¼ncellendi âœ“`);
};

async function logUniqueVisit() {
    const today = todayStr();
    const lastVisit = localStorage.getItem('lichessPanelLastVisit');
    if (lastVisit === today) return; // BugÃ¼n zaten ziyaret edildi

    localStorage.setItem('lichessPanelLastVisit', today);

    try {
        const statsRef = doc(db, 'panel', 'stats');
        const statsSnap = await getDoc(statsRef);
        const currentStats = statsSnap.exists() ? statsSnap.data() : {};
        const todayCount = (currentStats[today] || 0) + 1;
        
        const updateData = {};
        updateData[today] = todayCount;

        await setDoc(statsRef, updateData, { merge: true });
    } catch (e) {
        console.warn("ZiyaretÃ§i sayÄ±mÄ± gÃ¼ncellenemedi:", e);
    }
}

window.openStatsModal = async () => {
  if(!PIN.getIsAdmin()){ showToast('Bu iÅŸlem iÃ§in yÃ¶netici giriÅŸi gerekli',true); return; }
  
  try {
    const statsRef = doc(db, 'panel', 'stats');
    const statsSnap = await getDoc(statsRef);
    const stats = statsSnap.exists() ? statsSnap.data() : {};

    const today = todayStr();
    const yesterday = dateStr(-1);
    
    const todayCount = stats[today] || 0;
    const yesterdayCount = stats[yesterday] || 0;
    
    let weekCount = 0;
    for(let i=0; i<7; i++) {
        const d = dateStr(-i);
        weekCount += (stats[d] || 0);
    }

    document.getElementById('statToday').textContent = todayCount;
    document.getElementById('statYesterday').textContent = yesterdayCount;
    document.getElementById('statWeek').textContent = weekCount;

    document.getElementById('modalStats').style.display = 'flex';
  } catch (e) { showToast('Ä°statistikler yÃ¼klenemedi: ' + e.message, true); console.error("Ä°statistik yÃ¼klenirken hata:", e); }
};

// Auto-refresh 10 dakikada bir (lichess rate limit iÃ§in)
setInterval(()=>{ if(getStudents().length>0) refreshAll(); },10*60*1000);

// â”€â”€ BAÅžLANGIÃ‡ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
(async()=>{
  const versionBadge = document.getElementById('versionBadge');
  if(versionBadge) versionBadge.textContent = APP_VERSION;

  const splashStatus = document.getElementById('splashStatus');
  if(splashStatus) splashStatus.textContent = 'VeritabanÄ±na baÄŸlanÄ±yor...';

  logUniqueVisit();

  // Once kullanici listesini yukle (PIN ekrani icin)
  try{
    const usersSnap=await getDoc(doc(db,'panel','users'));
    if(usersSnap.exists()) APP.users=usersSnap.data();
  }catch(e){ console.warn('Kullanici listesi yuklenemedi',e); }

  // Genel veriyi yukle (goruntuleme modu icin) â€” tamamen bitmesini bekle
  await fbLoad();
  
  // ArayÃ¼zÃ¼ oluÅŸtur
  document.body.classList.add('readonly');
  buildCritPanel(); renderGroupBar(); renderHeader();

  // Sporcu varsa Ä±zgarayÄ± hemen gÃ¶ster (Skeleton'lar belirecektir)
  renderGrid();
  renderChamps(); renderScoreTable();

  // YÃ¼kleme tamamlandÄ±, arayÃ¼z hazÄ±r, splash ekranÄ±nÄ± gizle!
  const splash = document.getElementById('splashScreen');
  if(splash) {
    splash.style.opacity = '0';
    setTimeout(() => {
      splash.style.visibility = 'hidden';
      splash.style.display = 'none';
    }, 600);
  }

  // FotoÄŸraflarÄ± arka planda yÃ¼kle
  fcLoadAllPhotos().then(() => {
    if(document.getElementById('viewChesscard').style.display !== 'none'){
      renderChesscards();
    }
  });

  // Lichess verilerini arka planda gÃ¼ncelle (AWAIT ETMÄ°YORUZ)
  if(getStudents().length > 0){
    refreshAll();
  }

  // GerÃ§ek zamanlÄ± dinleyiciyi SONRA baÅŸlat â€” fbLoad'dan hemen sonra
  // tetiklenmemesi iÃ§in kÄ±sa bir gecikme ekliyoruz
  setTimeout(()=>{ fbListen(); }, 800);

  if(typeof PIN!=='undefined'&&PIN.init) PIN.init();
})();
