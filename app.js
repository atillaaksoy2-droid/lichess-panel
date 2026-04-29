import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, getDocFromServer, setDoc, deleteDoc, onSnapshot, collection, getDocs }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
const APP_VERSION = 'v0.4.18';
const THEME_KEY = 'lichessPanelTheme';
const THEMES = {
  dark: { className: '', label: 'Klasik Koyu' },
  wood: { className: 'theme-wood', label: 'Ahşap Satranç' },
  light: { className: 'theme-light', label: 'Açık Kulüp' }
};

function normalizeTheme(theme){
  return THEMES[theme] ? theme : 'dark';
}

function applyTheme(theme){
  const selected = normalizeTheme(theme);
  document.body.classList.remove('theme-wood','theme-light');
  if(THEMES[selected].className) document.body.classList.add(THEMES[selected].className);
  const select = document.getElementById('themeSelect');
  if(select) select.value = selected;
  return selected;
}

window.setTheme = function(theme){
  const selected = applyTheme(theme);
  localStorage.setItem(THEME_KEY, selected);
};

applyTheme(localStorage.getItem(THEME_KEY));
// Firebase Storage kullanılmıyor — fotoğraflar Firestore'da saklanıyor

// ── FIREBASE YAPILANDIRMA ──────────────────────────────
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

// ── SYNC DURUM GÖSTERGESI ────────────────────────────
function setSyncStatus(state, msg){
  const dot=document.getElementById('syncDot'), txt=document.getElementById('syncStatus');
  dot.className='sync-dot '+state; txt.textContent=msg;
}

async function getFreshDoc(ref){
  try{
    return await getDocFromServer(ref);
  }catch(e){
    console.warn('Sunucudan okuma basarisiz, cache deneniyor:', e);
    return await getDoc(ref);
  }
}

async function selectViewerUser(users){
  const uids = Object.keys(users || {});
  if(uids.length === 0) return null;

  const params = new URLSearchParams(location.search);
  const requested = params.get('coach') || params.get('user') || params.get('uid');
  if(requested && uids.includes(requested)) return requested;

  let best = null;
  for(const uid of uids){
    try{
      const snap = await getFreshDoc(doc(db, 'panel', 'config_' + uid));
      if(!snap.exists()) continue;
      const data = snap.data();
      if(!data.groups || data.groups.length === 0) continue;
      const score = data.updatedAt || 0;
      if(!best || score > best.score) best = { uid, score };
    }catch(e){
      console.warn('Koc verisi secilemedi:', uid, e);
    }
  }

  if(best) return best.uid;
  const savedUser = localStorage.getItem('lastViewedCoach');
  if(savedUser && uids.includes(savedUser)) return savedUser;
  return uids[0];
}

// ── FIRESTORE OKUMA / YAZMA ──────────────────────────
// Veri yapısı:
//   /panel/config  → { groups, activeGid, criteria }
//   /panel/activity → { [username]: { [date]: { games, puzzles } } }

async function fbLoad(){
  setSyncStatus('syncing','Yükleniyor…');
  try{
    // APP.users yüklenmemişse son bir kez daha dene
    if(!APP.users){
      try {
        const uSnap = await getFreshDoc(doc(db,'panel','users'));
        if(uSnap.exists()) APP.users = uSnap.data();
      } catch(e) { console.warn('fbLoad users fetch error:', e); }
    }

    // Eğer bir kullanıcı seçilmemişse (izleme modu), uygun kullanıcıyı seç
    if(!APP.currentUser) {
      const savedUser = localStorage.getItem('lastViewedCoach');
      if (APP.users) {
        const uids = Object.keys(APP.users);
        if (uids.length > 0) {
          if (savedUser && uids.includes(savedUser)) {
            APP.currentUser = savedUser;
          } else {
            // Verisi olan ilk koçu bulmaya çalış
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
        // APP.users yüklenemese bile (offline/cache), local'den biliyorsak kullan
        APP.currentUser = savedUser;
      }
    }

    // Seçilen kullanıcıyı her zaman kaydet
    if(!APP.currentUserName && APP.users){
      const viewerUser = await selectViewerUser(APP.users);
      if(viewerUser) APP.currentUser = viewerUser;
    }
    if(APP.currentUser) localStorage.setItem('lastViewedCoach', APP.currentUser);

    // currentUser varsa ona özel config yükle, yoksa genel 'config' yükle
    const cfgKey = APP.currentUser ? 'config_' + APP.currentUser : 'config';
    let cfgSnap = await getFreshDoc(doc(db,'panel',cfgKey));
    
    // Fallback: Kullanıcıya özel config yoksa ama kullanıcı varsa, varsayılan değerlerle devam et
    const cfg = cfgSnap.exists() ? cfgSnap.data() : null;

    // EĞER hala boşsa ve APP.currentUser varsa, belki de daha migrate edilmemiştir, 
    // legacy 'config'i kontrol etmeyi deneyebiliriz.
    let finalCfg = cfg;
    if (!finalCfg && APP.currentUser) {
      const legacySnap = await getFreshDoc(doc(db,'panel','config'));
      if (legacySnap.exists() && legacySnap.data().groups && legacySnap.data().groups.length > 0) {
        finalCfg = legacySnap.data();
      }
    }

    const actSnap = await getFreshDoc(doc(db,'panel','activity'));
    const act = actSnap.exists() ? actSnap.data() : {};

    if(finalCfg && finalCfg.criteria){
      APP.crit = { ...APP.crit, ...finalCfg.criteria };
    }
    APP.configUpdatedAt = finalCfg?.updatedAt || 0;

    if(finalCfg && finalCfg.groups && finalCfg.groups.length > 0){
      APP.groups = finalCfg.groups;
      APP.activeGid = null;
    } else {
      // Varsayılan grup ayarları
      const defaultGid = APP.currentUser ? 'g' + APP.currentUser : 'default';
      APP.groups = [{ id: defaultGid, name: 'A Grubu' }];
      APP.activeGid = null;
    }
    APP.bestHistory = normalizeBestHistory(finalCfg?.bestHistory || []);

    // Öğrenci listelerini yükle
    const prefix = APP.currentUser ? APP.currentUser + '_' : '';
    await Promise.all(APP.groups.map(async g => {
      try{
        const key = 'students_' + prefix + g.id;
        let snap = await getFreshDoc(doc(db,'panel',key));
        
        // Eğer prefix varsa ama bulunamadıysa prefix'siz hali (eski veri) dene
        if(!snap.exists() && prefix){
          snap = await getFreshDoc(doc(db,'panel','students_' + g.id));
        }
        
        // HALA bulunamadıysa ve view-only moddaysak (prefix yoksa), 
        // herhangi bir hocanın bu g.id'ye sahip listesi var mı diye bakamayız (güvenlik/yapı gereği)
        // Ancak APP.studentLists'i her durumda bir dizi olarak başlatmalıyız
        APP.studentLists[g.id] = normalizeStudentList(snap.exists() ? (snap.data().list || []) : (APP.studentLists[g.id] || []));
      } catch(e){
        console.warn(`Grup ${g.id} yüklenemedi:`, e);
        APP.studentLists[g.id] = normalizeStudentList(APP.studentLists[g.id] || []);
      }
    }));

    APP.actLog = act;
    setSyncStatus('ok','Firebase bağlı ✓');
    return true;
  } catch(e){
    console.error('Firebase yükleme hatası:',e);
    setSyncStatus('err','Bağlantı hatası');
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
      bestHistory: APP.bestHistory || [],
      updatedAt: APP.configUpdatedAt
    });
  }catch(e){ console.warn('Config kayıt hatası:',e); setSyncStatus('err','Kayıt hatası'); }
}

async function fbSaveStudents(gid){
  try{
    const prefix=APP.currentUser?APP.currentUser+'_':'';
    const list = normalizeStudentList(APP.studentLists[gid] || []);
    APP.studentLists[gid] = list;
    await setDoc(doc(db,'panel','students_'+prefix+gid),{ list, updatedAt: Date.now() });
  }catch(e){ console.warn('Öğrenci kayıt hatası:',e); }
}

async function fbSaveActivity(){
  try{
    await setDoc(doc(db,'panel','activity'), APP.actLog);
  }catch(e){ console.warn('Aktivite kayıt hatası:',e); }
}

// Gerçek zamanlı dinleyici — başka cihazdan değişiklik olunca güncelle
// students_ dokümanlari için aktif dinleyicileri takip et
const _studentsUnsubMap = {};

function fbListenStudents(groups){
  const prefix = APP.currentUser ? APP.currentUser + '_' : '';
  const neededKeys = new Set(groups.map(g => 'students_' + prefix + g.id));

  // Artik gerekli olmayan dinleyicileri kapat
  for(const key of Object.keys(_studentsUnsubMap)){
    if(!neededKeys.has(key)){ _studentsUnsubMap[key](); delete _studentsUnsubMap[key]; }
  }

  // Yeni gruplar için dinleyici ekle
  groups.forEach(g => {
    const key = 'students_' + prefix + g.id;
    if(_studentsUnsubMap[key]) return;

    let _firstSnap = true; // fbLoad zaten yükledi, ilk snapshot'ı atla
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
  let _cfgFirstSnap = true; // ilk snapshot fbLoad'dan gelen veriyle aynıdır, atla
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
      APP.bestHistory = normalizeBestHistory(d.bestHistory || []);
      APP.configUpdatedAt = remoteUpdatedAt;
      Promise.all(APP.groups.map(async g=>{
        try{
          const prefix = APP.currentUser ? APP.currentUser + '_' : '';
          const s = await getDoc(doc(db,'panel','students_'+prefix+g.id));
          if(s.exists()) APP.studentLists[g.id]=normalizeStudentList(s.data().list||[]);
        }catch(e){ console.warn('fbListen grup yuklenemedi:',g.id); }
      })).then(()=>{ 
        renderGroupBar(); 
        renderBestHistory();
        renderGrid(); 
        if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
        fbListenStudents(APP.groups);
      });
      renderHeader(); buildCritPanel(); renderBestHistory();
      setSyncStatus('ok','Baska cihazdan guncelleme alindi');
      setTimeout(()=>setSyncStatus('ok','Firebase bagli \u2713'),3000);
    }
  });
  fbListenStudents(APP.groups);
  onSnapshot(doc(db,'panel','activity'), snap=>{
    if(!snap.exists()) return;
    const newAct=snap.data();
    // Mevcut ile birleştir (en büyük değeri koru)
    for(const [u,days] of Object.entries(newAct)){
      if(!APP.actLog[u]) APP.actLog[u]={};
      for(const [d,v] of Object.entries(days)){
        const p=APP.actLog[u][d]||{games:0,puzzles:0,wins:0};
        APP.actLog[u][d]={
          ...p,
          games:Math.max(p.games,v.games||0),
          puzzles:Math.max(p.puzzles,v.puzzles||0),
          wins:Math.max(p.wins||0,v.wins||0)
        };
      }
    }
    renderGrid(); renderChamps(); renderScoreTable(); renderBestHistory();
    if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
  });
}

// ── UYGULAMA DURUMU ──────────────────────────────────
const APP = {
  groups: [{id:'default',name:'A Grubu'}],
  activeGid: null,
  studentLists: {},  // { [gid]: [{ u, n?, ukd?, lic? }, ...] }
  actLog: {},
  activityCache: {},
  liveData: {},
  stats: {}, // { [date]: count }
  bestHistory: [],
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
  configUpdatedAt: 0,
  backgroundRefresh: { running: false, loadedAt: 0 },
  clubLogoUrl: localStorage.getItem('chess_club_logo') || ''
};

const ADVANCED_BEHAVIOR_BADGES = [
  { key:'notation', icon:'✎', short:'Not', label:'Notasyon', tip:'Turnuvalarda düzenli, anlaşılır notasyon tutar' },
  { key:'analysis', icon:'◆', short:'Anlz', label:'Analiz', tip:'Turnuva maçlarını Lichess çalışmalarına analiz için kaydeder' },
  { key:'time', icon:'⏱', short:'Zmn', label:'Zaman', tip:'Maçlarda süresini dengeli kullanır' },
  { key:'opening', icon:'♙', short:'Açl', label:'Açılış', tip:'Beyaz ve siyah taşlarla repertuar belirlemiş ve uygular' },
  { key:'endgame', icon:'♜', short:'Son', label:'Oyun Sonu', tip:'Temel piyon ve kale oyun sonu kurallarını bilir' },
  { key:'fighter', icon:'🔥', short:'Müc', label:'Mücadeleci', tip:'Moral bozmadan mücadele edebilir' },
  { key:'hunter', icon:'🎯', short:'Avcı', label:'Avcı', tip:'Kendisinden 200+ puanlı rakipten puan almıştır' }
];
const BEGINNER_BEHAVIOR_BADGES = [
  { key:'rules', icon:'♟', short:'Krl', label:'Kural', tip:'Taşların hareketlerini tam öğrenen ve doğru uygulayan' },
  { key:'beginner-notation', icon:'✎', short:'Not', label:'Notasyon', tip:'Notasyon tutmayı öğrenen ve uygulayabilen' },
  { key:'mate', icon:'♚', short:'Mat', label:'Mat', tip:'Temel mat kalıplarını uygulayabilen' },
  { key:'first-tournament', icon:'🏅', short:'Trn', label:'İlk Turnuva', tip:'İlk resmi turnuvasına katılan' },
  { key:'defender', icon:'🛡', short:'Sav', label:'Savunmacı', tip:'Taşlarını koruyan ve boşta bırakmayan' },
  { key:'castling', icon:'♖', short:'Rok', label:'Rok Ustası', tip:'Oyunların çoğunda geç kalmadan rok yapan' }
];
const BEHAVIOR_BADGE_SETS = {
  beginner: BEGINNER_BEHAVIOR_BADGES,
  advanced: ADVANCED_BEHAVIOR_BADGES
};
const BEHAVIOR_BADGES = ADVANCED_BEHAVIOR_BADGES;
const BEHAVIOR_BADGE_MAP = Object.fromEntries(
  [...ADVANCED_BEHAVIOR_BADGES, ...BEGINNER_BEHAVIOR_BADGES].map(b => [b.key, b])
);

function slugifyId(text){
  return String(text || 'sporcu')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/ı/g,'i')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'') || 'sporcu';
}

function normalizeAccountName(value){
  const raw = String(value || '').trim();
  if(!raw) return '';
  return raw
    .replace(/^https?:\/\/(www\.)?lichess\.org\/@?\//i,'')
    .replace(/^https?:\/\/(www\.)?chess\.com\/member\//i,'')
    .replace(/^@/,'')
    .trim()
    .toLowerCase();
}

function normalizeStudentRecord(student){
  if(typeof student === 'string'){
    const u = normalizeAccountName(student);
    return u ? { id: u, u, lichess: u, platform: 'lichess' } : null;
  }
  if(student && typeof student === 'object'){
    const lichess = normalizeAccountName(student.lichess || student.l || student.u || student.username || '');
    const chesscom = normalizeAccountName(student.chesscom || student.chessCom || student.cc || '');
    const name = String(student.n || student.name || student.realName || '').trim();
    const id = String(student.id || student.sid || student.u || (lichess ? lichess : chesscom ? `cc:${chesscom}` : `manual:${slugifyId(name)}`)).trim();
    if(!id || (!name && !lichess && !chesscom)) return null;
    const out = { ...student, id, u: id, lichess, chesscom };
    if(name) out.n = name;
    out.platform = lichess ? (chesscom ? 'both' : 'lichess') : chesscom ? 'chesscom' : 'manual';
    out.behaviorBadges = Array.isArray(out.behaviorBadges)
      ? [...new Set(out.behaviorBadges)].filter(key => BEHAVIOR_BADGE_MAP[key])
      : [];
    delete out.username; delete out.l; delete out.cc; delete out.chessCom; delete out.name; delete out.realName; delete out.sid;
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
  return level === 'İleri' ? 'ileri' : level === 'Orta' ? 'orta' : level === 'Başlangıç' ? 'baslangic' : 'genel';
}

function levelPiece(level){
  if(level === 'Başlangıç') return '♟';
  if(level === 'Orta') return '♞';
  if(level === 'İleri') return '♛';
  return '♜';
}

function isBestGroupName(name){
  return name === "Haftanın En İyileri" || name.startsWith("Haftanın En İyileri - ");
}

function getStudentLevelInfo(u){
  const activeGroup = APP.groups.find(g => g.id === APP.activeGid);
  const activeStudent = findStudent(u);
  if(activeStudent?.level) return { level: activeStudent.level, group: activeStudent.groupName || activeGroup?.name || '' };
  if(activeStudent?.lvl) return { level: activeStudent.lvl, group: activeStudent.groupName || activeGroup?.name || '' };
  if(activeGroup && !isBestGroupName(activeGroup.name)){
    return { level: activeGroup.level || 'Genel', group: activeGroup.name };
  }
  for(const g of APP.groups){
    if(isBestGroupName(g.name)) continue;
    if(getStudentList(g.id).some(student => student.u === u)){
      return { level: g.level || 'Genel', group: g.name };
    }
  }
  return { level: 'Genel', group: activeGroup?.name || '' };
}

function getBehaviorBadgesForLevel(level){
  return level === 'Başlangıç' ? BEHAVIOR_BADGE_SETS.beginner : BEHAVIOR_BADGE_SETS.advanced;
}

function getBehaviorBadgeMapForLevel(level){
  return Object.fromEntries(getBehaviorBadgesForLevel(level).map(b => [b.key, b]));
}

function collectBestCandidates(levelFilter=null){
  const map = new Map();
  APP.groups.forEach(g => {
    if(isBestGroupName(g.name)) return;
    const level = g.level || 'Genel';
    if(levelFilter && level !== levelFilter) return;
    getStudentList(g.id).forEach(s => {
      const u = studentUsername(s);
      if(u && !map.has(u)) map.set(u, { ...normalizeStudentRecord(s), level, groupName: g.name });
    });
  });
  return map;
}

function hasFreshLiveData(username, maxAge=45*60*1000){
  const d = APP.liveData[username];
  return !!(d && !d.error && d.loadedAt && (Date.now() - d.loadedAt) < maxAge);
}

function getStudents(){ 
  return getStudentList().map(s => s.u);
}
function getStudentAccounts(u){
  const s = findStudent(u);
  return {
    lichess: s?.lichess || '',
    chesscom: s?.chesscom || ''
  };
}
function getStudentProfileUrl(u){
  const a = getStudentAccounts(u);
  if(a.lichess) return `https://lichess.org/@/${encodeURIComponent(a.lichess)}`;
  if(a.chesscom) return `https://www.chess.com/member/${encodeURIComponent(a.chesscom)}`;
  return '';
}
function studentPlatformHtml(u){
  const a = getStudentAccounts(u);
  const parts = [];
  if(a.lichess) parts.push(`<span class="platform-tag lichess">Lichess: ${escHtml(a.lichess)}</span>`);
  if(a.chesscom) parts.push(`<span class="platform-tag chesscom">Chess.com: ${escHtml(a.chesscom)}</span>`);
  if(parts.length === 0) parts.push('<span class="platform-tag manual">Manuel Kart</span>');
  return parts.join('');
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
    return { val: s.ukd || '—', prev: s.pUkd || null };
  }
  return { val: '—', prev: null };
}
function getStudentLic(u){
  const s = findStudent(u);
  return s ? (s.lic || '') : '';
}
function getStudentBehaviorBadges(u){
  const s = findStudent(u);
  if(!s || !Array.isArray(s.behaviorBadges)) return [];
  const levelBadges = getBehaviorBadgeMapForLevel(getStudentLevelInfo(u).level);
  return s.behaviorBadges.filter(key => levelBadges[key]);
}
function behaviorBadgesHtml(u, compact=false){
  const keys = getStudentBehaviorBadges(u);
  if(keys.length === 0) return '';
  return keys.map(key => {
    const b = BEHAVIOR_BADGE_MAP[key];
    const content = compact
      ? `<span class="behavior-symbol">${escHtml(b.icon)}</span><span>${escHtml(b.short)}</span>`
      : `<span class="behavior-symbol">${escHtml(b.icon)}</span><span>${escHtml(b.label)}</span>`;
    const cls = compact ? 'fc-behavior-badge' : 'badge b-behavior';
    return `<span class="${cls} behavior-${escHtml(b.key)}" title="${escHtml(b.label)}: ${escHtml(b.tip)}" data-tip="${escHtml(b.label)}: ${escHtml(b.tip)}">${content}</span>`;
  }).join('');
}
function setStudents(arr){
  if(!APP.activeGid){ showToast('Önce bir grup seç',true); return; }
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

// ── TARİH YARDIMCILARI ───────────────────────────────
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
function addDaysStr(date, add){
  const [y,m,d]=date.split('-').map(Number);
  const dt=new Date(y,m-1,d);
  dt.setDate(dt.getDate()+add);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
function formatShortDate(date){
  const [y,m,d]=date.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('tr-TR',{day:'numeric',month:'short'});
}
function formatWeekRange(start,end){
  if(!start || !end) return '';
  return `${formatShortDate(start)} - ${formatShortDate(end)}`;
}
function normalizeBestHistory(history){
  return (Array.isArray(history) ? history : [])
    .filter(h => h && h.id && Array.isArray(h.items))
    .map(h => ({
      ...h,
      items: h.items.map((item,i)=>({
        rank: item.rank || i+1,
        username: String(item.username || item.u || '').toLowerCase(),
        name: item.name || item.displayName || item.username || item.u || '',
        pts: Math.round(Number(item.pts || 0)),
        games: Number(item.games || 0),
        puzzles: Number(item.puzzles || 0),
        activeDays: Number(item.activeDays || 0),
        streak: Number(item.streak || 0),
        level: item.level || h.level || 'Genel',
        groupName: item.groupName || ''
      })).filter(item=>item.username)
    }))
    .sort((a,b)=>(b.weekStart || '').localeCompare(a.weekStart || ''))
    .slice(0,52);
}
function getBestHistoryStats(username){
  const u=String(username||'').toLowerCase();
  const hits=(APP.bestHistory||[])
    .flatMap(h => (h.items||[]).filter(item=>item.username===u).map(item=>({history:h,item})))
    .sort((a,b)=>(b.history.weekStart||'').localeCompare(a.history.weekStart||''));
  if(!hits.length) return null;
  const weekHits = new Map();
  hits.forEach(hit => {
    const key = hit.history.weekStart || hit.history.id;
    if(!weekHits.has(key)) weekHits.set(key, hit);
  });
  const leaderHits = hits.filter(h => (h.item.rank || 99) === 1);
  const leaderWeeks = new Map();
  leaderHits.forEach(hit => {
    const key = hit.history.weekStart || hit.history.id;
    if(!leaderWeeks.has(key)) leaderWeeks.set(key, hit);
  });
  return {
    count: weekHits.size,
    last: weekHits.values().next().value.history,
    bestRank: Math.min(...hits.map(h=>h.item.rank || 99)),
    leaderCount: leaderWeeks.size,
    lastLeader: leaderWeeks.values().next().value?.history || null
  };
}

// ── AKTİVİTE ─────────────────────────────────────────
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

// ── PUAN SİSTEMİ ─────────────────────────────────────
// Dönem bazlı istatistik özeti (actLog'dan)
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

  // Bugün actLog'da yoksa liveData'dan ekle
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
    const wins=(date===todayStr()&&d&&!d.error)?Math.max(entry.wins||0,d.wins||0):(entry.wins||0);
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
  if(tot>0) parts.push(`⚔${tot}`);
  if(puz>0) parts.push(`🧩${puz}`);
  if(streak>0) parts.push(`🔥${streak}g`);
  return parts.join(' ');
}

// ── GRUP YÖNETİMİ ────────────────────────────────────
function renderGroupBar(){
  const bar=document.getElementById('groupBar');
  // Seviyelere göre grupla
  const levels = ['İleri', 'Orta', 'Başlangıç', 'Genel'];
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
      const lvlClass = lvl.toLowerCase().replace('i','i').replace('ş','s').replace('ç','c').replace('ğ','g').replace('ü','u').replace('ö','o');
      // Türkçe karakter düzeltme (basitleştirilmiş)
      const safeLvl = lvl === 'İleri' ? 'ileri' : lvl === 'Orta' ? 'orta' : lvl === 'Başlangıç' ? 'baslangic' : 'genel';
      
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

  bar.innerHTML = html + `<button class="new-group-btn edit-only" onclick="openNewGroupModal()" style="margin-top:10px;">＋ Yeni Grup</button>`;
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
  // Öğrenci listesi bellekte yoksa Firebase'den çek
  if(APP.studentLists[id] === undefined || APP.studentLists[id] === null){
    setSyncStatus('syncing','Grup yükleniyor…');
    try{
      const prefix2 = APP.currentUser ? APP.currentUser + '_' : '';
      const skey = 'students_' + prefix2 + id;
      let snap = await getFreshDoc(doc(db,'panel',skey));
      if(!snap.exists() && prefix2) snap = await getFreshDoc(doc(db,'panel','students_'+id));
      APP.studentLists[id] = normalizeStudentList(snap.exists() ? (snap.data().list||[]) : []);
      setSyncStatus('ok','Firebase bağlı ✓');
    }catch(e){
      APP.studentLists[id] = [];
      setSyncStatus('err','Grup yüklenemedi');
    }
  }
  renderGroupBar();
  renderGrid();
  if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
  if(getStudents().length>0) refreshAll();
}

window.openNewGroupModal=()=>{ document.getElementById('newGroupName').value=''; document.getElementById('modalNewGroup').style.display='flex'; setTimeout(()=>document.getElementById('newGroupName').focus(),50); };
window.createGroup=()=>{
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); return; }
  const name=document.getElementById('newGroupName').value.trim(); if(!name) return;
  const level=document.getElementById('newGroupLevel').value;
  const g={id:'g'+Date.now(),name,level};
  APP.groups.push(g); APP.activeGid=g.id;
  APP.studentLists[g.id]=[];
  fbSaveConfig(); fbSaveStudents(g.id);
  closeModal('modalNewGroup'); renderGroupBar(); renderHeader(); renderGrid();
  showToast(`"${name}" (${level}) grubu oluşturuldu ✓`);
};
window.openRenameModal=()=>{
  const g=APP.groups.find(x=>x.id===APP.activeGid); if(!g) return;
  document.getElementById('renameInput').value=g.name;
  document.getElementById('renameLevel').value=g.level || 'Genel';
  document.getElementById('modalRename').style.display='flex';
  setTimeout(()=>document.getElementById('renameInput').focus(),50);
};
window.renameGroup=()=>{
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); return; }
  const name=document.getElementById('renameInput').value.trim(); if(!name) return;
  const level=document.getElementById('renameLevel').value;
  const g=APP.groups.find(x=>x.id===APP.activeGid); if(!g) return;
  g.name=name; g.level=level; fbSaveConfig(); closeModal('modalRename'); renderGroupBar(); renderHeader();
  showToast(`Grup güncellendi ✓`);
};
window.confirmDeleteGroup=()=>{
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); return; }
  if(!APP.activeGid){ showToast('Önce bir grup seç',true); return; }
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
  const name = g ? g.name : '—';
  const safeLvl = g ? (g.level === 'İleri' ? 'ileri' : g.level === 'Orta' ? 'orta' : g.level === 'Başlangıç' ? 'baslangic' : 'genel') : 'genel';
  const levelIndicator = g ? `<span class="group-level-indicator bg-${safeLvl}" style="width:10px; height:10px; margin-right:8px; vertical-align:middle;"></span>` : '';
  
  document.getElementById('groupNameDisplay').innerHTML = levelIndicator + name;
  document.title=(g?g.name+' — ':'')+'Lichess Koç Paneli';
}

// ── ÖĞRENCİ EKLE / ÇIKAR ─────────────────────────────
window.addStudent=()=>openStudentModal();

window.openStudentModal=function(studentId=''){
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); return; }
  if(!APP.activeGid){ showToast('Önce bir grup seç',true); return; }
  const s = studentId ? findStudent(studentId) : null;
  document.getElementById('studentModalTitle').textContent = s ? 'Sporcu Bilgilerini Düzenle' : 'Yeni Sporcu Ekle';
  document.getElementById('studentEditId').value = s?.u || '';
  document.getElementById('studentNameInput').value = s?.n || '';
  document.getElementById('studentLichessInput').value = s?.lichess || '';
  document.getElementById('studentChesscomInput').value = s?.chesscom || '';
  document.getElementById('studentUkdInput').value = s?.ukd || '';
  document.getElementById('studentLicInput').value = s?.lic || '';
  document.getElementById('studentFormErr').textContent = '';
  document.getElementById('modalStudent').style.display = 'flex';
  setTimeout(()=>document.getElementById('studentNameInput').focus(),50);
};

window.saveStudentModal=async function(){
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); return; }
  if(!APP.activeGid){ showToast('Önce bir grup seç',true); return; }
  const errEl = document.getElementById('studentFormErr');
  const editId = document.getElementById('studentEditId').value;
  const current = editId ? findStudent(editId) : null;
  const name = document.getElementById('studentNameInput').value.trim();
  const lichess = normalizeAccountName(document.getElementById('studentLichessInput').value);
  const chesscom = normalizeAccountName(document.getElementById('studentChesscomInput').value);
  const ukd = document.getElementById('studentUkdInput').value.trim();
  const lic = document.getElementById('studentLicInput').value.trim();
  const id = editId || lichess || (chesscom ? `cc:${chesscom}` : `manual:${Date.now()}`);
  const normalized = normalizeStudentRecord({
    ...(current || {}),
    id,
    u: id,
    n: name,
    lichess,
    chesscom,
    ukd,
    lic
  });
  if(!normalized){
    errEl.textContent = '⚠ Ad soyad veya en az bir platform hesabı girin.';
    return;
  }
  const list = getStudentList();
  if(!editId && list.some(s => s.u === normalized.u)){
    errEl.textContent = '⚠ Bu sporcu zaten listede.';
    return;
  }
  APP.studentLists[APP.activeGid] = editId
    ? normalizeStudentList(list.map(s => s.u === editId ? normalized : s))
    : normalizeStudentList([...list, normalized]);
  await fbSaveStudents(APP.activeGid);
  delete APP.liveData[normalized.u];
  closeModal('modalStudent');
  renderGroupBar(); renderGrid();
  loadOneStudent(normalized.u,0).then(()=>{ updateOneCard(normalized.u,0); renderChamps(); renderScoreTable(); if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards(); });
  showToast(`${normalized.n || normalized.lichess || normalized.chesscom || 'Sporcu'} kaydedildi ✓`);
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
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); return; }
  const currentList = getStudentList();
  const updated = currentList.filter(x => x.u !== username);
  APP.studentLists[APP.activeGid] = updated;
  fbSaveStudents(APP.activeGid);
  delete APP.liveData[username];
  renderGroupBar(); renderGrid(); showToast(`${username} çıkarıldı`,true);
}

window.openBehaviorBadgesModal = function(username){
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli', true); return; }
  const student = findStudent(username);
  if(!student){ showToast('Sporcu bulunamadı', true); return; }
  const selected = new Set(getStudentBehaviorBadges(username));
  const levelInfo = getStudentLevelInfo(username);
  const badges = getBehaviorBadgesForLevel(levelInfo.level);
  document.getElementById('behaviorBadgeUser').value = username;
  document.getElementById('behaviorBadgeTitle').textContent = `${getStudentDisplayName(username)} · ${levelInfo.level}`;
  document.getElementById('behaviorBadgeGrid').innerHTML = badges.map(b => `
    <label class="behavior-check">
      <input type="checkbox" value="${escHtml(b.key)}" ${selected.has(b.key)?'checked':''}>
      <span class="behavior-check-icon behavior-${escHtml(b.key)}">${escHtml(b.icon)}</span>
      <span>
        <b>${escHtml(b.label)}</b>
        <small>${escHtml(b.tip)}</small>
      </span>
    </label>
  `).join('');
  document.getElementById('modalBehaviorBadges').style.display = 'flex';
};

window.saveBehaviorBadges = async function(){
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli', true); return; }
  const username = document.getElementById('behaviorBadgeUser').value;
  const levelBadges = getBehaviorBadgeMapForLevel(getStudentLevelInfo(username).level);
  const selected = [...document.querySelectorAll('#behaviorBadgeGrid input:checked')]
    .map(i => i.value)
    .filter(key => levelBadges[key]);
  const list = getStudentList().map(student => {
    if(student.u !== username) return student;
    return normalizeStudentRecord({ ...student, behaviorBadges: selected });
  });
  APP.studentLists[APP.activeGid] = normalizeStudentList(list);
  await fbSaveStudents(APP.activeGid);
  closeModal('modalBehaviorBadges');
  renderGrid();
  if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
  showToast('Davranış rozetleri kaydedildi ✓');
};

// ── VERİ YÜKLEME ─────────────────────────────────────
window.refreshAll=async(force=false)=>{
  const myId=++APP.refreshId;
  if(!APP.activeGid) return;
  const students=getStudents();
  if(students.length===0) return;
  const btn=document.getElementById('refreshBtn'); btn.classList.add('spinning');
  
  // Önce mevcut verilerle UI'ı güncelle
  renderGrid();
  if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
  
  // Sadece eski veya eksik verileri güncelle
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

  setLoadStatus(`Yükleniyor… 0/${toRefresh.length}`);
  let done=0;
  for(const user of toRefresh){
    if(myId!==APP.refreshId) break;
    await loadOneStudent(user,myId);
    done++; if(myId!==APP.refreshId) break;
    setLoadStatus(`Yükleniyor… ${done}/${toRefresh.length}`);
    updateOneCard(user,myId);
    if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
    
    // Lichess rate limit: öğrenciler arası 1.5sn bekle
    if(done<toRefresh.length) await new Promise(r=>setTimeout(r,4000));
  }
  if(myId===APP.refreshId){
    btn.classList.remove('spinning'); setLoadStatus('');
    document.getElementById('lastUpdate').textContent='Güncellendi: '+new Date().toLocaleTimeString('tr-TR');
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

async function fetchAndParseActivity(username, logKey=username) {
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

  if (!APP.actLog[logKey]) APP.actLog[logKey] = {};
  for (let di=0; di<=14; di++) {
    const dk = dateStr(-di);
    if (dk !== today && !APP.actLog[logKey][dk]) APP.actLog[logKey][dk] = {games:0, puzzles:0};
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
      const prevT = APP.actLog[logKey][today] || {games:0, puzzles:0, wins:0};
      APP.actLog[logKey][today] = {...prevT, lPuzzles:ep, puzzles:Math.max(prevT.puzzles||0, ep), wins:prevT.wins||0};
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
      const prev = APP.actLog[logKey][eDate] || {games:0,puzzles:0,wins:0};
      APP.actLog[logKey][eDate] = {
        ...prev,
        lGames: eg,
        lWins: ew,
        lPuzzles: ep,
        games: eg + (prev.cGames||0),
        puzzles: Math.max(prev.puzzles||0, ep),
        wins: ew + (prev.cWins||0)
      };
    }
  }
  APP.activityCache[cacheKey] = { loadedAt: Date.now(), puzzlesSolved };
  return puzzlesSolved;
}

async function loadLichessStudent(account, logKey, myId){
  const userRes=await fetchWT(`https://lichess.org/api/user/${account}`,{},12000);
  if(!userRes.ok) throw new Error('lichess_not_found');
  const user=await userRes.json();
  if(myId&&myId!==APP.refreshId) return null;

  const online=user.online===true||(user.seenAt&&(Date.now()-user.seenAt)<5*60*1000);
  const now=new Date(), todayMidnight=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
  const weekAgo = todayMidnight - 7 * 24 * 60 * 60 * 1000;
  const { wins, losses, draws, recent, topOpenings } = await fetchAndParseGames(account, weekAgo, todayMidnight);
  if(myId&&myId!==APP.refreshId) return null;

  const ratings={}, ratingRows=[], perf=user.perfs||{};
  for(const k of ['bullet','blitz','rapid','classical']){
    if(perf[k]&&perf[k].games>0){
      ratings[k]={int:perf[k].rating,prog:perf[k].prog||0};
      ratingRows.push({platform:'L', key:k, label:k==='bullet'?'BLT':k==='blitz'?'BLZ':k==='rapid'?'RPD':'CLS', int:perf[k].rating, prog:perf[k].prog||0});
    }
  }
  const puzzleRating=perf.puzzle?perf.puzzle.rating:null;
  let puzzlesSolved=0;
  try{
    puzzlesSolved = await fetchAndParseActivity(account, logKey);
  }catch(e){ console.warn(`[${account}] aktivite:`,e.message); }

  return {
    source:'lichess',
    displayName:user.username,
    title:user.title||'',
    online,
    ratings,
    ratingRows,
    wins, losses, draws,
    puzzlesSolved,
    puzzleRating,
    recentGames: recent.map(g => ({...g, platform:'L'})),
    topOpenings
  };
}

function chessComResult(result){
  if(result === 'win') return 'win';
  if(['agreed','repetition','stalemate','insufficient','50move','timevsinsufficient'].includes(result)) return 'draw';
  return 'loss';
}

async function fetchChessComMonth(username, date){
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth()+1).padStart(2,'0');
  const res = await fetchWT(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/${y}/${m}`, {}, 15000);
  if(!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.games) ? data.games : [];
}

async function loadChessComStudent(account, logKey, myId){
  const profileRes = await fetchWT(`https://api.chess.com/pub/player/${encodeURIComponent(account)}`, {}, 12000);
  if(!profileRes.ok) throw new Error('chesscom_not_found');
  const profile = await profileRes.json();
  if(myId&&myId!==APP.refreshId) return null;

  let stats = {};
  try{
    const statsRes = await fetchWT(`https://api.chess.com/pub/player/${encodeURIComponent(account)}/stats`, {}, 12000);
    if(statsRes.ok) stats = await statsRes.json();
  }catch(e){ console.warn(`[${account}] chess.com stats:`, e.message); }

  const ratingRows = [];
  const ratingMap = [
    ['chess_bullet','bullet','BLT'],
    ['chess_blitz','blitz','BLZ'],
    ['chess_rapid','rapid','RPD'],
    ['chess_daily','classical','DLY']
  ];
  const ratings = {};
  for(const [apiKey,key,label] of ratingMap){
    const last = stats[apiKey]?.last;
    if(last?.rating){
      ratings[key] = { int:last.rating, prog:0 };
      ratingRows.push({platform:'C', key, label, int:last.rating, prog:0});
    }
  }

  const today = todayStr();
  const todayMidnight = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const monthNow = new Date();
  const monthPrev = new Date(Date.UTC(monthNow.getUTCFullYear(), monthNow.getUTCMonth()-1, 1));
  const games = [...await fetchChessComMonth(account, monthNow), ...await fetchChessComMonth(account, monthPrev)];
  if(myId&&myId!==APP.refreshId) return null;

  const chessDayCounts = {};
  let wins=0, losses=0, draws=0;
  const recentGames = [];

  for(const g of games){
    if(g.rules && g.rules !== 'chess') continue;
    if(!APP.crit.countBullet && g.time_class === 'bullet') continue;
    const endMs = (g.end_time || 0) * 1000;
    if(!endMs) continue;
    const d = new Date(endMs);
    const dk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const diff = daysBetween(today, dk);
    if(diff < 0 || diff > 14) continue;
    const isWhite = String(g.white?.username || '').toLowerCase() === account;
    const me = isWhite ? g.white : g.black;
    const opp = isWhite ? g.black : g.white;
    const result = chessComResult(me?.result || '');
    if(!chessDayCounts[dk]) chessDayCounts[dk] = {games:0,wins:0};
    chessDayCounts[dk].games += 1;
    if(result==='win') chessDayCounts[dk].wins += 1;
    if(dk === today){
      if(result==='win') wins++;
      else if(result==='draw') draws++;
      else losses++;
      recentGames.push({result, opponent: opp?.username || 'Anonim', speed:g.time_class || '', time:fmtTime(d), platform:'C'});
    }
  }

  if(!APP.actLog[logKey]) APP.actLog[logKey] = {};
  for(let di=0; di<=14; di++){
    const dk = dateStr(-di);
    const prev = APP.actLog[logKey][dk] || {games:0,puzzles:0,wins:0};
    const cc = chessDayCounts[dk] || {games:0,wins:0};
    APP.actLog[logKey][dk] = {
      ...prev,
      cGames: cc.games||0,
      cWins: cc.wins||0,
      games: (prev.lGames||0) + (cc.games||0),
      puzzles: prev.puzzles||0,
      wins: (prev.lWins||0) + (cc.wins||0)
    };
  }

  const tactics = stats.tactics?.highest?.rating || stats.tactics?.last?.rating || null;
  return {
    source:'chesscom',
    displayName:profile.username || account,
    title:'',
    online:false,
    ratings,
    ratingRows,
    wins, losses, draws,
    puzzlesSolved:0,
    puzzleRating:tactics,
    recentGames,
    topOpenings:null
  };
}

function mergeLiveSources(student, sources){
  const valid = sources.filter(Boolean);
  const ratings = {};
  const ratingRows = [];
  let wins=0, losses=0, draws=0, puzzlesSolved=0, puzzleRating=null, online=false;
  let title = '', displayName = student.n || valid[0]?.displayName || student.lichess || student.chesscom || 'Sporcu';
  const recentGames = [];
  let topOpenings = null;

  for(const s of valid){
    wins += s.wins||0; losses += s.losses||0; draws += s.draws||0;
    puzzlesSolved += s.puzzlesSolved||0;
    if(s.puzzleRating && !puzzleRating) puzzleRating = s.puzzleRating;
    if(s.online) online = true;
    if(s.title) title = s.title;
    Object.assign(ratings, s.ratings || {});
    ratingRows.push(...(s.ratingRows || []));
    recentGames.push(...(s.recentGames || []));
    if(s.topOpenings && !topOpenings) topOpenings = s.topOpenings;
  }

  return {
    displayName, title, online, ratings, ratingRows,
    wins, losses, draws, puzzlesSolved, puzzleRating,
    recentGames: recentGames.slice(0,8),
    topOpenings,
    manual: valid.length === 0,
    platforms: { lichess: student.lichess || '', chesscom: student.chesscom || '' },
    loadedAt: Date.now()
  };
}

async function loadOneStudent(studentId,myId){
  const student = findStudent(studentId) || normalizeStudentRecord({ id: studentId, lichess: studentId });
  if(!student) return;
  const sources = [];
  try{
    if(student.lichess) sources.push(await loadLichessStudent(student.lichess, student.u, myId));
  }catch(err){ console.warn(`[${student.u}] Lichess (${student.lichess}):`, err.message); }
  try{
    if(student.chesscom) sources.push(await loadChessComStudent(student.chesscom, student.u, myId));
  }catch(err){ console.warn(`[${student.u}] Chess.com (${student.chesscom}):`, err.message); }
  if(myId&&myId!==APP.refreshId) return;

  const merged = mergeLiveSources(student, sources);
  if((student.lichess || student.chesscom) && sources.filter(Boolean).length === 0){
    APP.liveData[student.u] = { ...merged, error:true };
    return;
  }
  APP.liveData[student.u] = merged;
  logActivity(student.u, merged.wins+merged.losses+merged.draws, merged.puzzlesSolved, merged.wins);
}

async function refreshAllStudentsInBackground(force=false){
  if(APP.backgroundRefresh.running) return;
  const candidates = [...collectBestCandidates().keys()];
  const toRefresh = candidates.filter(u => force || !hasFreshLiveData(u));
  if(toRefresh.length === 0) return;

  APP.backgroundRefresh.running = true;
  setSyncStatus('syncing', `Arka planda güncelleniyor 0/${toRefresh.length}`);
  try{
    for(let i=0; i<toRefresh.length; i++){
      const u = toRefresh[i];
      setSyncStatus('syncing', `Arka planda güncelleniyor ${i+1}/${toRefresh.length}`);
      await loadOneStudent(u, 0);
      if(APP.activeGid && getStudents().includes(u)){
        updateOneCard(u, 0);
        renderChamps();
        renderScoreTable();
      }
      if(i < toRefresh.length - 1) await new Promise(r=>setTimeout(r,4000));
    }
    APP.backgroundRefresh.loadedAt = Date.now();
  }catch(e){
    console.warn('Arka plan güncelleme hatası:', e);
  }finally{
    APP.backgroundRefresh.running = false;
    setSyncStatus('ok','Firebase bağlı ✓');
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

// ── ROZETLER ─────────────────────────────────────────
function getBadges(username,d){
  if(!d||d.error) return [];
  const badges=[], total=(d.wins||0)+(d.losses||0)+(d.draws||0), wr=total>0?Math.round((d.wins/total)*100):0;
  const puz=d.puzzlesSolved||0, gs=getStreak(username,'games'), ps=getStreak(username,'puzzles');
  if(total>=APP.crit.minDailyGames) badges.push({cls:'b-active',icon:'⚡',label:'Aktif',tip:`Bugün ${total} maç`});
  else if(total>0) badges.push({cls:'b-info',icon:'▷',label:`${total} maç`,tip:'Bugün maç yaptı'});
  else badges.push({cls:'b-warn',icon:'💤',label:'Pasif',tip:'Bugün maç yok'});
  if(total>=3&&wr>=APP.crit.minWinRate) badges.push({cls:'b-gold',icon:'🏆',label:`%${wr}`,tip:`%${APP.crit.minWinRate}+ kazanma`});
  if(gs>=APP.crit.streakDays) badges.push({cls:'b-streak',icon:'🔥',label:`${gs}g Seri`,tip:`${gs} gün üst üste`});
  if(puz>=APP.crit.minPuzzleDaily) badges.push({cls:'b-puzzle',icon:'🧩',label:`${puz}`,tip:`${APP.crit.minPuzzleDaily}+ bulmaca`});
  if(ps>=APP.crit.streakPuzzleDays) badges.push({cls:'b-pstreak',icon:'🎯',label:`${ps}g🧩`,tip:`${ps} gün bulmaca serisi`});
  const bestStats = getBestHistoryStats(username);
  if(bestStats){
    const lastRange = formatWeekRange(bestStats.last.weekStart, bestStats.last.weekEnd);
    badges.push({
      cls:'b-gold',
      icon:'🏆',
      label:`${bestStats.count}x En İyi`,
      tip:`Haftanın en iyileri: ${bestStats.count} kez · En iyi derece #${bestStats.bestRank} · Son: ${lastRange}`
    });
    if(bestStats.leaderCount > 0){
      const lastLeaderRange = formatWeekRange(bestStats.lastLeader.weekStart, bestStats.lastLeader.weekEnd);
      badges.push({
        cls:'b-gold',
        icon:'👑',
        label:`${bestStats.leaderCount}x Lider`,
        tip:`Haftanın lideri: ${bestStats.leaderCount} kez · Son liderlik: ${lastLeaderRange}`
      });
    }
  }

  const weeklyScore = calcScore(username, 'week');
  const isBelow = weeklyScore < (APP.crit.minWeeklyScore || 0);
  if (isBelow) {
    badges.push({cls:'b-warn',icon:'🔻',label:'Baraj Altı',tip:`Haftalık barajın (${APP.crit.minWeeklyScore}) altında`});
  } else {
    badges.push({cls:'b-active',icon:'🌟',label:'Baraj Üstü',tip:`Haftalık barajın (${APP.crit.minWeeklyScore}) üzerinde`});
  }
  
  return badges;
}

// ── SIRALAMA / FİLTRE ────────────────────────────────
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

// ── RENDER ───────────────────────────────────────────
function renderGrid(){
  const grid=document.getElementById('cardsGrid');
  if(!APP.activeGid){
    grid.innerHTML='<div class="empty"><div class="ei">♟</div><h3>Grubunu seç</h3><p>Üstteki grup sekmelerinden kendi grubunu seçerek sporcuları görüntüle.</p></div>';
    return;
  }
  const students=getStudents();
  if(students.length===0){ grid.innerHTML='<div class="empty"><div class="ei">♟</div><h3>Henüz öğrenci yok</h3><p>Yukarıdan sporcu adı veya platform kullanıcı adı ekle.</p></div>'; return; }
  const allLoaded=students.every(u=>APP.liveData[u]);
  const sorted=allLoaded?[...students].sort((a,b)=>scoreForSort(b)-scoreForSort(a)):[...students];
  const rankMap=Object.fromEntries(sorted.map((u,i)=>[u,i+1]));
  const filtered=sorted.filter(passes);
  if(filtered.length===0){ grid.innerHTML='<div class="empty"><div class="ei">🔍</div><h3>Filtre eşleşmedi</h3></div>'; return; }
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
      fb.innerHTML='<div class="card-head" style="padding:12px 13px"><span style="font-size:12px;color:var(--text-muted)">'+escHtml(u)+' — yüklenemedi</span></div>';
      frag.appendChild(fb);
    }
  }
  grid.innerHTML=''; grid.appendChild(frag);
}

function renderChamps(){
  const students=getStudents().filter(u=>APP.liveData[u]&&!APP.liveData[u].error);
  if(students.length<2){ document.getElementById('champStrip').innerHTML=''; return; }
  const period = APP.scorePeriod||'week';
  const periodLabel = period==='week' ? 'Bu Hafta' : '14 Gün';

  // Her öğrenci için dönem istatistiklerini hesapla
  const stats = Object.fromEntries(students.map(u=>[u, periodStats(u,period)]));

  const best = fn => students.reduce((b,u)=>fn(u)>fn(b)?u:b);

  const champs=[
    {
      cls:'cc-score', label:'⭐ En Yüksek Puan', medal:'🏆',
      user: best(u=>calcScore(u,period)),
      val:  u=>calcScore(u,period)+' puan',
      sub:  u=>periodLabel
    },
    {
      cls:'cc-games', label:'⚔ En Çok Maç', medal:'🎯',
      user: best(u=>stats[u].totalGames),
      val:  u=>stats[u].totalGames+' maç',
      sub:  u=>periodLabel+' toplam'
    },
    {
      cls:'cc-puzzle', label:'🧩 En Çok Bulmaca', medal:'🧩',
      user: best(u=>stats[u].totalPuzzles),
      val:  u=>stats[u].totalPuzzles+' bulmaca',
      sub:  u=>periodLabel+' toplam'
    },
    {
      cls:'cc-win', label:'📚 En Çok Antrenman', medal:'📚',
      user: (()=>{
        // Maç + bulmaca toplamı en yüksek
        const active=students.filter(u=>stats[u].totalGames>0||stats[u].totalPuzzles>0);
        if(active.length===0) return students[0];
        return active.reduce((b,u)=>(stats[u].totalGames+stats[u].totalPuzzles)>(stats[b].totalGames+stats[b].totalPuzzles)?u:b);
      })(),
      val:  u=>(stats[u].totalGames+stats[u].totalPuzzles)>0
              ? (stats[u].totalGames+stats[u].totalPuzzles)+' toplam aktivite'
              : 'henüz aktivite yok',
      sub:  u=>periodLabel+' maç+bulmaca toplamı'
    },
    {
      cls:'cc-streak', label:'⚡ En Aktif Oyuncu', medal:'⚡',
      user: (()=>{
        // En fazla aktif gün olan oyuncu (activeDays)
        const active=students.filter(u=>stats[u].activeDays>0);
        if(active.length===0) return students[0];
        return active.reduce((b,u)=>stats[u].activeDays>stats[b].activeDays?u:b);
      })(),
      val:  u=>stats[u].activeDays>0
              ? stats[u].activeDays+' aktif gün'
              : 'henüz maç yok',
      sub:  u=>periodLabel+' içinde'
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

function renderBestHistory(selectedId){
  const section=document.getElementById('bestHistorySection');
  const select=document.getElementById('bestHistorySelect');
  const summary=document.getElementById('bestHistorySummary');
  if(!section || !select || !summary) return;
  const history=normalizeBestHistory(APP.bestHistory || []);
  APP.bestHistory = history;
  if(history.length===0){
    section.style.display='none';
    return;
  }
  section.style.display='';
  summary.textContent = `${history.length} hafta kaydedildi`;
  const currentId = selectedId || select.value || history[0].id;
  select.innerHTML = history.map(h=>{
    const level = h.levelLabel || h.level || 'Tümü';
    const label = `${formatWeekRange(h.weekStart,h.weekEnd)} · ${level} · ${h.items.length} sporcu`;
    return `<option value="${escHtml(h.id)}" ${h.id===currentId?'selected':''}>${escHtml(label)}</option>`;
  }).join('');
  renderBestHistoryDetail(select.value || currentId);
}

window.renderBestHistoryDetail = function(id){
  const detail=document.getElementById('bestHistoryDetail');
  if(!detail) return;
  const history=(APP.bestHistory || []).find(h=>h.id===id) || APP.bestHistory?.[0];
  if(!history){
    detail.innerHTML='<div class="history-empty">Henüz kayıt yok.</div>';
    return;
  }
  detail.innerHTML = (history.items || []).map(item=>{
    const meta=[
      item.username ? '@'+item.username : '',
      item.games ? item.games+' maç' : '',
      item.puzzles ? item.puzzles+' bulmaca' : '',
      item.activeDays ? item.activeDays+' aktif gün' : ''
    ].filter(Boolean).join(' · ');
    return `<div class="history-row">
      <div class="history-rank">#${item.rank}</div>
      <div>
        <div class="history-name">${escHtml(item.name || item.username)}</div>
        <div class="history-meta">${escHtml(meta || formatWeekRange(history.weekStart, history.weekEnd))}</div>
      </div>
      <div class="history-pts">${item.pts}<div class="score-pts-lbl">puan</div></div>
    </div>`;
  }).join('');
};

function renderScoreTable(){
  const students=getStudents().filter(u=>APP.liveData[u]&&!APP.liveData[u].error);
  if(!APP.activeGid){
    document.getElementById('scoreRows').innerHTML='<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:11px">Puan tablosu için grup seçin.</div>';
    return;
  }
  if(students.length===0){
    document.getElementById('scoreRows').innerHTML='<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:11px">Veri bekleniyor…</div>';
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
    const medal = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':rank;
    const pct   = Math.round((pts/maxPts)*100);
    const isBelow = APP.scorePeriod==='week' && pts < (APP.crit.minWeeklyScore || 0);
    const barColor = isBelow ? 'var(--loss)' : 'var(--win)';

    // İstatistik etiketleri
    const tags=[];
    if(st.totalGames>0)   tags.push(`<span class="sc-tag sc-game">⚔ ${st.totalGames} maç</span>`);

    if(st.totalPuzzles>0) tags.push(`<span class="sc-tag sc-puz">🧩 ${st.totalPuzzles} bulmaca</span>`);
    if(st.streak>1)       tags.push(`<span class="sc-tag sc-str">🔥 ${st.streak}g seri</span>`);
    if(st.activeDays>0)   tags.push(`<span class="sc-tag sc-day">📅 ${st.activeDays} aktif gün</span>`);

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

// ── KART OLUŞTURUCULAR ───────────────────────────────
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
  // Hata durumunda minimal kart göster
  if(d.error){
    const profileUrl = getStudentProfileUrl(username);
    const nameHtml = profileUrl
      ? `<a href="${profileUrl}" target="_blank" class="s-name">${escHtml(getStudentDisplayName(username))}</a>`
      : `<span class="s-name">${escHtml(getStudentDisplayName(username))}</span>`;
    return `<div class="s-card faded" data-user="${escHtml(username)}">
      <div class="card-head">
        <div class="card-top">
          <div class="s-info">
            <div class="avatar">${escHtml(username[0].toUpperCase())}</div>
            <div>
              ${nameHtml}
            <div class="s-sub" style="color:var(--loss)">⚠ Yüklenemedi
              <button onclick="retryStudent('${escHtml(username)}')" style="margin-left:6px;background:rgba(224,90,90,.15);border:1px solid rgba(224,90,90,.3);color:var(--loss);border-radius:4px;padding:1px 8px;cursor:pointer;font-family:inherit;font-size:9px">↺ Tekrar Dene</button>
            </div>
            <div class="platform-tags">${studentPlatformHtml(username)}</div>
            </div>
          </div>
          <div class="card-actions">
            <button class="rm-btn student-edit-btn edit-only" data-editstudent="${escHtml(username)}" title="Sporcu bilgileri">✎</button>
            <button class="rm-btn" data-rmuser="${escHtml(username)}" title="Çıkar">✕</button>
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
  const crown=rank===1?'👑':rank===2?'🥈':rank===3?'🥉':'';
  const cardCls=rank===1?'t1':rank===2?'t2':rank===3?'t3':'';
  const ratingRows = Array.isArray(d.ratingRows) && d.ratingRows.length
    ? d.ratingRows
    : ['bullet','blitz','rapid','classical'].map(k => d.ratings?.[k] ? {platform:'L',label:k==='bullet'?'BLT':k==='blitz'?'BLZ':k==='rapid'?'RPD':'CLS',...d.ratings[k]} : null).filter(Boolean);
  const rHTML=ratingRows.slice(0,5).map(r=>{
    const dif=r.prog||0,cc=dif>0?'up':dif<0?'dn':'eq',ct=dif>0?`▲${dif}`:dif<0?`▼${Math.abs(dif)}`:'—';
    return `<div class="r-item" title="${r.platform==='C'?'Chess.com':'Lichess'} ${escHtml(r.label)}"><div class="r-type">${escHtml(r.platform||'')} ${escHtml(r.label)}</div><div class="r-val">${r.int}</div><div class="r-chg ${cc}">${ct}</div></div>`;
  }).join('');
  const ukd = getStudentUkd(username);
   let ukdDiffHTML = '<div class="r-chg eq">—</div>';
   if(ukd.prev && ukd.val !== '—') {
     const diff = parseInt(ukd.val) - parseInt(ukd.prev);
     if(diff > 0) ukdDiffHTML = `<div class="r-chg up">▲${diff}</div>`;
     else if(diff < 0) ukdDiffHTML = `<div class="r-chg dn">▼${Math.abs(diff)}</div>`;
   }
   const ukdHTML = `<div class="r-item ukd-item" title="Ulusal Kuvvet Derecesi (Önceki: ${ukd.prev || '—'})"><div class="r-type">UKD</div><div class="r-val">${ukd.val}</div>${ukdDiffHTML}</div>`;
  
  let opHTML = '';
  if (d.topOpenings && (d.topOpenings.white?.length > 0 || d.topOpenings.black?.length > 0)) {
    const wOp = d.topOpenings.white.join(', ') || 'Veri yok';
    const bOp = d.topOpenings.black.join(', ') || 'Veri yok';
    opHTML = `
      <div class="wld-row" style="margin-bottom:0">
        <div class="wld-box" style="flex:1;text-align:left;padding:6px;border-color:rgba(200,168,75,.3);background:rgba(200,168,75,.04);grid-column:1/span 2">
          <div class="wld-lbl" style="color:var(--text);margin-bottom:4px;font-size:9px">⚪ Beyazla Sık Oynananlar</div>
          <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(wOp)}">${escHtml(wOp)}</div>
        </div>
        <div class="wld-box" style="flex:1;text-align:left;padding:6px;border-color:rgba(176,190,197,.3);background:rgba(176,190,197,.04);grid-column:1/span 2">
          <div class="wld-lbl" style="color:var(--text);margin-bottom:4px;font-size:9px">⚫ Siyahla Sık Oynananlar</div>
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
    return `<div class="pip ${cls}${isT?' today':''}" title="${day.date}: ${day.games} maç, ${day.puzzles} bulmaca"></div>`;
  }).join('');
  const gs=getStreak(username,'games'), ps=getStreak(username,'puzzles');
  const heatLbl=gs>1?`🔥 ${gs}g seri`:ps>1?`🧩 ${ps}g seri`:'14 gün';
  const bdgHtml=badges.map(b=>`<span class="badge ${b.cls}" title="${b.tip}">${b.icon} ${b.label}</span>`).join('');
  const behaviorHtml = behaviorBadgesHtml(username);
  const bd=scoreBreakdown(username);
  const levelInfo = getStudentLevelInfo(username);
  const levelTag = `<div class="level-tag lvl-${levelSlug(levelInfo.level)}" title="${escHtml(levelInfo.group || levelInfo.level)}"><span class="level-piece">${levelPiece(levelInfo.level)}</span></div>`;
  const levelAndBadges = levelTag + bdgHtml;
  const profileUrl = getStudentProfileUrl(username);
  const nameHtml = profileUrl
    ? `<a href="${profileUrl}" target="_blank" class="s-name">${escHtml(getStudentDisplayName(username))}</a>`
    : `<span class="s-name">${escHtml(getStudentDisplayName(username))}</span>`;
  return `<div class="s-card ${cardCls} ${total===0?'faded':''}" data-user="${escHtml(username)}">
    <div class="card-head">
      <div class="card-top">
        <div class="s-info">
          <div class="avatar">${escHtml(username[0].toUpperCase())}${crown?`<span class="rank-crown">${crown}</span>`:''}</div>
          <div>
            ${nameHtml}
            <div class="s-sub">${d.title?`<b style="color:var(--accent)">[${escHtml(d.title)}]</b> · `:''}${d.online?'Çevrimiçi':'Çevrimdışı'}
              <div class="day-tag">🎯 ${APP.scorePeriod==='week'?'Haftalık':'14 Günlük'}: ${pSt.totalGames} maç</div><div class="score-tag">⭐ ${score} puan</div>
              <div class="platform-tags">${studentPlatformHtml(username)}</div>
            </div>
          </div>
        </div>
          <div class="card-actions">
          <div class="s-dot ${d.online?'on':''}" title="${d.online?'Çevrimiçi':'Çevrimdışı'}"></div>
          <button class="rm-btn student-edit-btn edit-only" data-editstudent="${escHtml(username)}" title="Sporcu bilgileri">✎</button>
          <button class="rm-btn behavior-edit-btn edit-only" data-badgesuser="${escHtml(username)}" title="Davranış rozetleri">🏅</button>
          <button class="rm-btn" data-rmuser="${escHtml(username)}" title="Çıkar">✕</button>
        </div>
      </div>
      <div class="card-badges">${levelAndBadges}</div>
      ${behaviorHtml?`<div class="behavior-badges">${behaviorHtml}</div>`:''}
      <div class="heat-row">${pipHtml}<span class="heat-lbl">${heatLbl}</span></div>
    </div>
    <div class="ratings-row">${rHTML}${ukdHTML}</div>
    <div class="stats">
      <div class="s-title">${APP.scorePeriod==='week'?'Bu Haftalık':'14 Günlük'} Maçlar</div>
      <div class="wld-row">
        <div class="wld-box wb"><div class="wld-lbl">Maç</div><div class="wld-val">${pSt.totalGames||0}</div></div>
        <div class="wld-box lb2"><div class="wld-lbl">Bulmaca</div><div class="wld-val">${pSt.totalPuzzles||0}</div></div>
        <div class="wld-box db"><div class="wld-lbl">Aktif Gün</div><div class="wld-val">${pSt.activeDays||0}</div></div>
      </div>
      
      <div class="puz-row">
        <div class="puz-left"><span style="font-size:14px">🧩</span><div><div style="font-size:11px;font-weight:600;color:var(--puzzle)">Bulmacalar</div><div class="puz-lbl">bugün çözülen</div></div></div>
        <div class="puz-cnt">${d.puzzlesSolved??0}</div>
        <div class="puz-rat"><div>Puan</div><span>${d.puzzleRating??'—'}</span></div>
      </div>
      <div class="train-score-row">
        <div>
          <div style="font-size:11px;font-weight:600;color:var(--puzzle)">⭐ Antrenman Puanı</div>
          <div class="puz-lbl">${APP.scorePeriod==='week'?'Bu Hafta':'14 Gün'}: ${pSt.totalGames} maç · ${pSt.totalPuzzles} bulmaca</div>
        </div>
        <div class="train-pts">${score}</div>
        <div class="train-breakdown">${bd||'—'}</div>
      </div>
      ${opHTML?`<div class="s-title" style="margin-top:5px">Favori Açılışlar (Son 7 Gün)</div>${opHTML}`:''}
    </div>
  </div>`;
}

// ── KRİTER PANELİ ────────────────────────────────────
window.toggleCrit=()=>{ const b=document.getElementById('critBody'),a=document.getElementById('critArrow'); b.classList.toggle('open'); a.textContent=b.classList.contains('open')?'▲':'▼'; };
function buildCritPanel(){
  const isAdmin = PIN.getIsAdmin();
  const defs=[
    {key:'minWeeklyScore',  b:{cls:'b-warn',icon:'🛑',lbl:'Baraj'},   name:'Haftalık Alt Baraj',  rule:'Haftalık antrenman baraj puanı'},
    {key:'minDailyGames',   b:{cls:'b-active',icon:'⚡',lbl:'Aktif'},        name:'Aktif Oyuncu',       rule:'Günlük min. maç sayısı'},
    {key:'minWinRate',      b:{cls:'b-gold',  icon:'🏆',lbl:'%Kazanma'},     name:'Yüksek Kazanma',     rule:'Min. kazanma oranı (%)'},
    {key:'streakDays',      b:{cls:'b-streak',icon:'🔥',lbl:'Seri'},         name:'Maç Serisi (gün)',   rule:'Üst üste kaç gün?'},
    {key:'minPuzzleDaily',  b:{cls:'b-puzzle',icon:'🧩',lbl:'Bulmaca'},      name:'Günlük Bulmaca',     rule:'Günlük min. bulmaca'},
    {key:'streakPuzzleDays',b:{cls:'b-pstreak',icon:'🎯',lbl:'Bulmaca Seri'},name:'Bulmaca Serisi',     rule:'Üst üste kaç gün?'},
    {key:'ptWin',           b:{cls:'b-gold',  icon:'⭐',lbl:'Kazanma pt'},   name:'Kazanma Puanı',      rule:'Her kazanılan maç için'},
    {key:'ptPlay',          b:{cls:'b-info',  icon:'⭐',lbl:'Oynama pt'},    name:'Oynama Puanı',       rule:'Her oynanan maç için'},
    {key:'ptPuzzle',        b:{cls:'b-puzzle',icon:'⭐',lbl:'Bulmaca pt'},   name:'Bulmaca Puanı',      rule:'Her bulmaca için'},
    {key:'ptDailyBonus',    b:{cls:'b-active',icon:'⭐',lbl:'Günlük bonus'}, name:'Günlük Maç Bonusu',  rule:'Günlük kriteri karşılama'},
    {key:'ptPuzzleBonus',   b:{cls:'b-puzzle',icon:'⭐',lbl:'Bulmaca bonus'},name:'Bulmaca Bonusu',     rule:'Bulmaca kriteri karşılama'},
    {key:'ptStreak',        b:{cls:'b-streak',icon:'⭐',lbl:'Seri bonus'},   name:'Seri Günlük Bonus',  rule:'Aktif seri başına puan'},
  ];
  // Bullet toggle ayrı render
  const chk = APP.crit.countBullet ? 'checked' : '';
  const lbl = APP.crit.countBullet ? 'Dahil' : 'Hariç';
  const dis = isAdmin ? '' : 'disabled';
  const bulletHTML = '<div class="crit-item" style="grid-column:1/-1;background:rgba(224,90,90,.06);border-color:rgba(224,90,90,.2)">'
    + '<span class="badge b-warn">🔴 Bullet</span>'
    + '<div class="crit-desc"><div class="crit-name">Bullet Maçları Say</div>'
    + '<div class="crit-rule">Maç sayısı, puan ve ısı haritasına dahil et</div></div>'
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
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); buildCritPanel(); return; }
  APP.crit[key]=Math.max(0,parseFloat(val)||0); await fbSaveConfig(); renderGrid(); renderChamps(); renderScoreTable(); 
};
window.setClubLogo=()=>{
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); return; }
  const input=document.createElement('input');
  input.type='file'; input.accept='image/*';
  input.onchange=e=>{
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      APP.clubLogoUrl=ev.target.result;
      localStorage.setItem('chess_club_logo',ev.target.result);
      showToast('Kulüp logosu kaydedildi ✓');
      if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
    };
    reader.readAsDataURL(file);
  };
  input.click();
};
window.removeClubLogo=()=>{
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); return; }
  if(!APP.clubLogoUrl){ showToast('Kayıtlı logo yok', true); return; }
  APP.clubLogoUrl='';
  localStorage.removeItem('chess_club_logo');
  if(document.getElementById('viewChesscard').style.display!=='none') renderChesscards();
  showToast('Kart logosu kaldırıldı ✓');
};

window.toggleBullet=async(checked)=>{
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); buildCritPanel(); return; }
  APP.crit.countBullet=checked?1:0;
  // Checkbox label güncelle
  const lbl=document.getElementById('bulletToggle');
  if(lbl&&lbl.parentElement) lbl.parentElement.lastChild.textContent=' '+(checked?'Dahil':'Hariç');
  await fbSaveConfig();
  showToast('Bullet maçlar '+(checked?'dahil edildi':'hariç tutuldu'));
  // Veriyi yeniden yükle (bullet durumu değişti)
  if(getStudents().length>0) refreshAll();
};

// ── YARDIMCILAR ──────────────────────────────────────
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
  if(diff<1) return 'az önce'; if(diff<60) return diff+'dk'; if(diff<1440) return Math.floor(diff/60)+'sa'; return Math.floor(diff/1440)+'g';
}
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function setLoadStatus(msg){ const el=document.getElementById('loadStatus'); if(msg){el.textContent=msg;el.classList.add('show');}else{el.textContent='';el.classList.remove('show');} }
function showToast(msg,isErr=false){ const t=document.getElementById('toast'); t.textContent=msg; t.className='toast show'+(isErr?' err':''); setTimeout(()=>{t.className='toast';},3000); }

// Event delegation
document.addEventListener('click',e=>{
  const edit=e.target.closest('.student-edit-btn');
  if(edit){ const u=edit.dataset.editstudent; if(u) openStudentModal(u); return; }
  const eb=e.target.closest('.behavior-edit-btn');
  if(eb){ const u=eb.dataset.badgesuser; if(u) openBehaviorBadgesModal(u); }
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



// ── PIN SİSTEMİ (module scope dışında window.PIN olarak) ──────────────────
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
    // Geriye dönük uyumluluk — yeni sistemde kullanılmaz
    if(window.APP && APP.crit && APP.crit._pinHash) return APP.crit._pinHash;
    return hash(DEFAULT);
  }


  async function addUser(){
    if(!isAdmin){ showToast('Bu işlem için yönetici girişi gerekli', true); return; }
    const name = prompt('Yeni hocanın adı (örn: Ahmet Hoca):');
    if(!name || !name.trim()) return;
    const pin = prompt('Yeni 4 haneli PIN:');
    if(!pin || !/^\d{4}$/.test(pin)){ showToast('Geçersiz PIN — 4 rakam olmalı', true); return; }
    const pin2 = prompt('PIN tekrar:');
    if(pin !== pin2){ showToast('PIN eşleşmedi', true); return; }

    const uid = 'u' + Date.now();
    const newHash = hash(pin);

    try{
      // Mevcut users listesini Firebase'den oku
      const usersSnap = await getDoc(doc(db, 'panel', 'users'));
      const allUsers = usersSnap.exists() ? usersSnap.data() : {};
      allUsers[uid] = { name: name.trim(), pinHash: newHash };

      // users dokümanını güncelle
      await setDoc(doc(db, 'panel', 'users'), allUsers);
      APP.users = allUsers;

      // Yeni hoca için boş config oluştur
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

      // Boş öğrenci listesi oluştur
      await setDoc(doc(db, 'panel', 'students_' + uid + '_' + defaultGid), {
        list: [],
        updatedAt: Date.now()
      });

      showToast(name.trim() + ' eklendi ✓');
    } catch(e) {
      console.error('Hoca ekleme hatası:', e);
      showToast('Hata: ' + e.message, true);
    }
  }


  async function checkPin(){
    if(buf.length<4) return;
    // Firebase'den taze users listesini çek
    try{
      const snap=await getDoc(doc(db,'panel','users'));
      if(snap.exists()) APP.users=snap.data();
    }catch(e){ console.warn('Users okuma:',e); }
    const users=APP.users||{};
    let matchUid=null, matchUser=null;
    for(const [uid,u] of Object.entries(users)){
      if(hash(buf)===u.pinHash){ matchUid=uid; matchUser=u; break; }
    }
    // Geriye dönük uyumluluk
    if(!matchUid && Object.keys(users).length===0 && hash(buf)===getStoredHash()){
      matchUid='legacy'; matchUser={name:'Yönetici'};
    }
    if(matchUid){
      // Legacy → users dokümanına taşı
      if(matchUid==='legacy'){
        try{
          const uid='u'+Date.now();
          const nu={}; nu[uid]={name:'Yönetici',pinHash:hash(buf)};
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
      if(ind){ ind.classList.add('show'); ind.textContent='👤 '+escHtml(matchUser.name); }
      const al=document.getElementById('btnAdminLogin'); if(al) al.style.display='none';
      const bp=document.getElementById('btnChangePin'); if(bp) bp.style.display='flex';
      const bau=document.getElementById('btnAddUser');  if(bau) bau.style.display='flex';
      const buk=document.getElementById('btnBulkUkd');  if(buk) buk.style.display='flex';
      const bsl=document.getElementById('btnStudentList'); if(bsl) bsl.style.display='flex';
      const bst=document.getElementById('btnStats');    if(bst) bst.style.display='flex';
      const bab=document.getElementById('btnAutoBest'); if(bab) bab.style.display='flex';
      const bl=document.getElementById('btnLogout');    if(bl)  bl.style.display='flex';
      renderGroupBar(); renderHeader(); buildCritPanel(); renderBestHistory(); renderGrid();
      if(getStudents().length>0) refreshAll();
      renderChamps(); renderScoreTable();
    } else {
      setErr('Hatalı PIN'); shake(); buf=''; updateDots();
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
    // Tüm grupların verilerini yükle (hangi kullanıcıya ait olduğu bilinmiyor,
    // görüntüleme modunda ilk kullanıcının verilerini göster)
    (async()=>{
      // users listesinden ilk kullanıcıyı bul — currentUser olarak ayarla (sadece okuma)
      const users=APP.users||{};
      const uids=Object.keys(users);
      if(uids.length>0){
        APP.currentUser=uids[0]; // görüntüleme modunda ilk kullanıcının verisi
      }
      await fbLoad();
      renderGroupBar(); renderHeader(); buildCritPanel(); renderBestHistory(); renderGrid();
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
    const buk=document.getElementById('btnBulkUkd'); if(buk) buk.style.display='none';
    const bsl=document.getElementById('btnStudentList'); if(bsl) bsl.style.display='none';
    const bst=document.getElementById('btnStats');    if(bst) bst.style.display='none';
    const bab=document.getElementById('btnAutoBest'); if(bab) bab.style.display='none';
    showToast('Oturum kapatıldı');
  }

  async function change(){
    if(!isAdmin){ showToast('Önce yönetici girişi yapın',true); return; }
    const p1=prompt('Yeni 4 haneli PIN:');
    if(!p1||!/^\d{4}$/.test(p1)){ showToast('Geçersiz PIN — 4 rakam olmalı',true); return; }
    const p2=prompt('PIN tekrar:');
    if(p1!==p2){ showToast('PIN eşleşmedi',true); return; }
    const newHash=hash(p1);
    // PIN'i users dokümanında sakla (criteria'da değil)
    try{
      // Mevcut users listesini Firebase'den oku
      const usersSnap=await getDoc(doc(db,'panel','users'));
      const allUsers=usersSnap.exists()?usersSnap.data():{};
      const uid=APP.currentUser||'legacy';
      if(!allUsers[uid]) allUsers[uid]={name:APP.currentUserName||'Yonetici',pinHash:hash('1234')};
      allUsers[uid].pinHash=newHash;
      // Firebase'e yaz ve bekle
      await setDoc(doc(db,'panel','users'),allUsers);
      // Bellekte güncelle
      APP.users=allUsers;
      showToast('PIN güncellendi ✓');
    }catch(e){
      showToast('PIN kayıt hatası: '+e.message,true);
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


// ── FUTCARD SİSTEMİ ─────────────────────────────────────────────────────────
// Fotoğraflar Firestore'da base64 olarak saklanır (/panel/photos dokümanı)
// Her cihaz direkt Firestore'dan okur — IndexedDB/Storage/pv mantığı yok.

// Fotoğraf veritabanını bellekte tut (sayfa içi önbellek)
let _photoCache = {}; // { username: base64dataUrl }
let _photoCacheLoaded = false;

async function fcLoadAllPhotos(){
  try {
    const snap = await getDocs(collection(db,'photos'));
    _photoCache = {};
    snap.forEach(docSnap => { _photoCache[docSnap.id] = docSnap.data().data; });
    _photoCacheLoaded = true;
    // Gerçek zamanlı dinle — başka cihazdan fotoğraf eklenince güncelle
    onSnapshot(collection(db,'photos'), snap => {
      _photoCache = {};
      snap.forEach(docSnap => { _photoCache[docSnap.id] = docSnap.data().data; });
      if(document.getElementById('viewChesscard').style.display !== 'none'){
        renderChesscards();
      }
    });
  } catch(e){
    console.warn('Fotoğraflar yüklenemedi:', e);
    _photoCache = {};
    _photoCacheLoaded = true;
  }
}

function fcGetPhoto(username){
  // Senkron — bellekteki önbellekten döner
  return _photoCache[username] || null;
}

// Fotoğraf alanı için kart arka plan renkleri
const FC_BG_COLORS = {
  'fc-gold':   '#3a2800',
  'fc-silver': '#252b3a',
  'fc-bronze': '#321800',
  'fc-normal': '#152030'
};

// Fotoğrafı canvas ile hazırla:
// - Kart rengini arka plana çiz (şeffaf PNG sorunu yok)
// - Fotoğrafı oranını koruyarak ortala
// - Sabit 400x440px (PNG'de 2000x2200 @ 5x) çıktı
window.fcPreparePhoto = function(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Kart ve PDF çıktısı için daha yüksek çözünürlük, oranı koruyarak optimize edilir.
      const maxWidth = 420;
      const maxHeight = 620;
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));

      // KANVASIN TAMAMEN ŞEFFAF OLDUĞUNDAN EMİN OLALIM
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Fotoğrafı çiz (Arka plan eklemeden)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // WEBP olarak sakla; kaliteyi baskı/PDF çıktısı için biraz yüksek tut.
      resolve(canvas.toDataURL('image/webp', 0.92));
    };
    img.src = dataUrl;
  });
};
async function fcSaveAllPhotos(){
  // Artık kullanılmıyor, her fotoğraf ayrı kaydediliyor.
}

window.fcDeletePhoto = async function(username){
  if(!PIN.getIsAdmin()){ showToast('Yetkiniz yok', true); return; }
  if(!confirm(`"${username}" için fotoğrafı silmek istediğinize emin misiniz?`)) return;
  try {
    delete _photoCache[username];
    await deleteDoc(doc(db,'photos',username));
    renderChesscards();
    showToast('Fotoğraf silindi ✓');
  } catch(e){
    console.error('Fotoğraf silme hatası:', e);
    showToast('Hata: ' + e.message, true);
  }
}

// Görünüm geçişi
window.switchView = function(view){
  document.querySelectorAll('.view-tab').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
  document.getElementById('viewPanel').style.display   = view==='panel'  ?'' :'none';
  document.getElementById('viewChesscard').style.display = view==='chesscard'?'' :'none';
  if(view==='chesscard') renderChesscards();
};

// Futcard ızgarasını oluştur
async function renderChesscards(){
  const students = getStudents().filter(u=>APP.liveData[u]&&!APP.liveData[u].error);
  const grid = document.getElementById('chesscardGrid');
  if(students.length===0){
    grid.innerHTML='<div class="empty"><div class="ei">🃏</div><h3>Henüz öğrenci yok</h3><p>Panel görünümünden öğrenci ekle.</p></div>';
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
    const levelInfo = getStudentLevelInfo(u);
    const levelCls = levelSlug(levelInfo.level);
    const behaviorFcHtml = behaviorBadgesHtml(u, true);
    const logoHtml = APP.clubLogoUrl ? `<div class="fc-club-logo"><img src="${APP.clubLogoUrl}" alt="Kulüp logosu"></div>` : '';

    const card = document.createElement('div');
    card.className = `chesscard ${fcCls}`;
    card.setAttribute('data-user', u);

    card.innerHTML = `
      <div class="chesscard-inner">
        <div class="fc-top">
          <div class="fc-score">${pts}</div>
          <div class="fc-rank-badge">#${rank}</div>
        </div>
        <div class="fc-level-mark lvl-${levelCls}" title="${escHtml(levelInfo.group || levelInfo.level)}">
          <span class="fc-level-piece">${levelPiece(levelInfo.level)}</span>
        </div>
        ${logoHtml}
        
        <div class="fc-photo-wrap" onclick="fcPhotoClick('${escHtml(u)}')">
          <div class="fc-photo-container" id="fc-photo-${idx}">
            <div class="fc-photo-placeholder">👤</div>
          </div>
          <div id="fc-delete-${idx}"></div>
        </div>

        <div class="fc-name">${escHtml(getStudentDisplayName(u))}</div>
        ${behaviorFcHtml?`<div class="fc-behavior-badges">${behaviorFcHtml}</div>`:''}

        <div class="fc-stats">
          <div class="fc-stat">
            <span class="fc-stat-label">MAÇ</span>
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
            <button class="fc-dl-btn" onclick="event.stopPropagation();downloadCard('${escHtml(u)}')">⬇</button>
        </div>
      </div>`;
    
    grid.appendChild(card);
    
    const photoDataUrl = fcGetPhoto(u);
    const container = document.getElementById(`fc-photo-${idx}`);
    const deleteContainer = document.getElementById(`fc-delete-${idx}`);
    if(container && photoDataUrl){
      container.innerHTML = `<img class="fc-photo" src="${photoDataUrl}">`;
      if(PIN.getIsAdmin() && deleteContainer){
        deleteContainer.innerHTML = `<button class="fc-delete-btn" onclick="event.stopPropagation();fcDeletePhoto('${escHtml(u)}')" title="Sil">✕</button>`;
      }
    }
  });
}
 
// Fotoğraf tıklama — yönetici modunda yükleme aç
window.fcPhotoClick = function(username){
  if(!PIN.getIsAdmin()){ showToast('Yönetici girişi gerekli', true); return; }
  const input = document.getElementById('fcPhotoInput');
  input.onchange = async(e)=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async(ev)=>{
      setSyncStatus('syncing', 'Hazırlanıyor…');
      
      // 1. Fotoğrafı şeffaf PNG olarak hazırla
      const prepared = await fcPreparePhoto(ev.target.result);
      
      // 2. Önce yerel belleğe yaz (UI anında güncellensin)
      _photoCache[username] = prepared;
      renderChesscards(); 
      
      // 3. Firebase'e kaydet
      try {
        await setDoc(doc(db,'photos',username), { data: prepared });
        showToast('Fotoğraf başarıyla kaydedildi ✓');
        setSyncStatus('ok', 'Firebase güncellendi ✓');
      } catch(err) {
        showToast('Kayıt hatası: ' + err.message, true);
      }
    };
    reader.readAsDataURL(file);
    input.value = '';
  };
  input.click();
};
// Tek kart PNG indir
const CARD_EXPORT = {
  targetW: 1000,
  targetH: 1550,
  renderW: 200,
  scale: 5
};
CARD_EXPORT.renderH = Math.round(CARD_EXPORT.renderW * CARD_EXPORT.targetH / CARD_EXPORT.targetW);

async function ensureHtml2Canvas(){
  if(!window.html2canvas){
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  }
}

async function ensureJsPdf(){
  if(!window.jspdf || !window.jspdf.jsPDF){
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  }
}

async function waitCardImages(card){
  const imgs = card.querySelectorAll('img');
  await Promise.all(Array.from(imgs).map(img =>
    img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
  ));
}

async function captureChesscardCanvas(username){
  const card = document.querySelector(`.chesscard[data-user="${CSS.escape(username)}"]`);
  if(!card) throw new Error('Kart bulunamadı');
  await ensureHtml2Canvas();

  const originalStyle = card.style.cssText;
  const hideEls = card.querySelectorAll('.fc-screen-only, .fc-delete-btn');
  hideEls.forEach(el=>{ el.style.visibility='hidden'; });

  card.style.transform  = 'none';
  card.style.transition = 'none';
  card.style.width      = CARD_EXPORT.renderW + 'px';
  card.style.height     = CARD_EXPORT.renderH + 'px';
  card.style.overflow   = 'hidden';

  try{
    await waitCardImages(card);
    return await html2canvas(card, {
      backgroundColor: null,
      scale: CARD_EXPORT.scale,
      useCORS: true,
      logging: false,
      allowTaint: true,
      imageTimeout: 15000,
      width: CARD_EXPORT.renderW,
      height: CARD_EXPORT.renderH,
      onclone: clonedDoc => {
        const clonedCard = clonedDoc.querySelector(`.chesscard[data-user="${CSS.escape(username)}"]`);
        if(!clonedCard) return;
        clonedCard.style.transform = 'none';
        clonedCard.style.boxShadow = 'none';
        clonedCard.style.width = CARD_EXPORT.renderW + 'px';
        clonedCard.style.height = CARD_EXPORT.renderH + 'px';
        clonedCard.querySelectorAll('.fc-screen-only, .fc-delete-btn').forEach(el => {
          el.style.visibility = 'hidden';
        });
      }
    });
  } finally {
    card.style.cssText = originalStyle;
    hideEls.forEach(el=>{ el.style.visibility=''; });
  }
}

function sortedChesscardUsers(){
  const period = APP.scorePeriod || 'week';
  return getStudents()
    .filter(u => APP.liveData[u] && !APP.liveData[u].error)
    .map(u => ({ u, pts: calcScore(u, period) }))
    .sort((a,b) => b.pts - a.pts)
    .map(x => x.u);
}

function safeFilePart(text){
  return String(text || 'sporcu-kartlari')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'sporcu-kartlari';
}

window.downloadCard = async function(username){
  try{
    const captured = await captureChesscardCanvas(username);
    const link = document.createElement('a');
    link.download = `chesscard-${username}.png`;
    link.href = captured.toDataURL('image/png');
    link.click();
    showToast(`${username} kartı indirildi ✓`);
  }catch(e){ showToast('İndirme hatası: '+e.message,true); console.error(e); }
};

// Tüm kartları indir
window.downloadAllCards = async function(){
  const students = sortedChesscardUsers();
  if(students.length===0) return;
  await ensureHtml2Canvas();
  showToast('Kartlar hazırlanıyor…');
  for(const u of students){
    await downloadCard(u);
    await new Promise(r=>setTimeout(r,300));
  }
};

// A4 baskıya hazır PDF indir
window.downloadCardsPdf = async function(){
  const students = sortedChesscardUsers();
  if(students.length===0){ showToast('PDF için kart bulunamadı', true); return; }
  try{
    if(document.getElementById('viewChesscard').style.display === 'none'){
      switchView('chesscard');
      await new Promise(r => setTimeout(r, 80));
    } else {
      await renderChesscards();
    }
    await ensureHtml2Canvas();
    await ensureJsPdf();

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4', compress:true });
    const pageW = 210;
    const pageH = 297;
    const cardW = 88;
    const cardH = cardW * CARD_EXPORT.targetH / CARD_EXPORT.targetW;
    const gapX = 8;
    const gapY = 6;
    const marginX = (pageW - (cardW * 2 + gapX)) / 2;
    const marginY = (pageH - (cardH * 2 + gapY)) / 2;

    showToast('A4 PDF hazırlanıyor...');
    for(let i=0; i<students.length; i++){
      if(i > 0 && i % 4 === 0) pdf.addPage();
      const slot = i % 4;
      const x = marginX + (slot % 2) * (cardW + gapX);
      const y = marginY + Math.floor(slot / 2) * (cardH + gapY);
      const canvas = await captureChesscardCanvas(students[i]);
      const imgData = canvas.toDataURL('image/jpeg', 0.96);
      pdf.addImage(imgData, 'JPEG', x, y, cardW, cardH, undefined, 'SLOW');
      if(students.length > 4) showToast(`PDF hazırlanıyor... ${i + 1}/${students.length}`);
    }

    const groupName = APP.groups?.[APP.activeGid]?.name || 'sporcu-kartlari';
    pdf.save(`${safeFilePart(groupName)}-a4-kartlar.pdf`);
    showToast('A4 PDF indirildi ✓');
  }catch(e){
    showToast('PDF hatası: ' + e.message, true);
    console.error(e);
  }
};

function loadScript(src){
  return new Promise((res,rej)=>{
    const existing = Array.from(document.scripts).find(s => s.src === src);
    if(existing){
      if(existing.dataset.loaded === '1') return res();
      existing.addEventListener('load', res, { once:true });
      existing.addEventListener('error', rej, { once:true });
      return;
    }
    const s=document.createElement('script'); s.src=src; s.onerror=rej;
    s.onload = () => { s.dataset.loaded = '1'; res(); };
    document.head.appendChild(s);
  });
}

window.openBulkUkdModal = () => {
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); return; }
  if(!APP.activeGid){ showToast('Önce bir grup seç',true); return; }
  document.getElementById('bulkUkdInput').value = '';
  document.getElementById('modalBulkUkd').style.display = 'flex';
  setTimeout(() => document.getElementById('bulkUkdInput').focus(), 50);
};

window.processBulkUkd = async () => {
  if(!APP.activeGid){ showToast('Önce bir grup seç',true); return; }
  const input = document.getElementById('bulkUkdInput').value;
  if(!input.trim()) return;
  
  const currentList = getStudentList();
  let updateCount = 0;
  
  const lines = input.split('\n');
  
  // Ekstra güçlü normalizasyon (Tüm Türkçe karakterleri İngilizce karşılığına çevirir)
  const ultraNorm = (s) => {
    if(!s) return '';
    return s.toString().toUpperCase()
      .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ç/g, 'C')
      .replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O')
      .replace(/I/g, 'I').replace(/ı/g, 'I')
      .replace(/[^A-Z0-9\s]/g, ' ') // Harf ve rakam dışındakileri boşluk yap
      .replace(/\s+/g, ' ') // Fazla boşlukları temizle
      .trim();
  };

  const newList = currentList.map(student => {
    let sObj = normalizeStudentRecord(student);
    
    let nameToMatch = sObj.n;
    if(!nameToMatch && APP.liveData[sObj.u] && !APP.liveData[sObj.u].error) {
      nameToMatch = APP.liveData[sObj.u].displayName;
    }
    
    if(!nameToMatch) return sObj;
    
    // İsmi parçalara ayır ve ultra-normalize et
    const normParts = ultraNorm(nameToMatch).split(' ').filter(p => p.length >= 2);
    if(normParts.length === 0) return sObj;
    
    for(const line of lines) {
      const normLine = ultraNorm(line);
      
      // Satırda ismin TÜM parçaları geçiyor mu?
      const allPartsMatch = normParts.every(part => normLine.includes(part));
      
      if(allPartsMatch) {
        // Satırdaki tüm sayıları bul (UKD aralığı: 100-2999)
        const matches = line.match(/\b(\d{3,4})\b/g);
        if(matches && matches.length > 0) {
          // Satırdaki en büyük sayıyı UKD kabul et (sıra no, yaş gibi değerlerden daha büyüktür)
          const possibleScores = matches.map(Number).filter(n => n >= 100 && n <= 2999);
          if(possibleScores.length > 0) {
            const newUkd = Math.max(...possibleScores).toString();
            // Puan değiştiyse eskisini kaydet
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
  showToast(`${updateCount} öğrencinin UKD puanı güncellendi ✓`);
};

window.openStudentListModal = () => {
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); return; }
  const body = document.getElementById('allStudentBody');
  body.innerHTML = '';
  
  let allStudents = [];
  APP.groups.forEach(g => {
    const list = getStudentList(g.id);
    list.forEach(s => {
      const sObj = normalizeStudentRecord(s);
      allStudents.push({
        groupName: g.name,
        username: [sObj.lichess ? `Lichess: ${sObj.lichess}` : '', sObj.chesscom ? `Chess.com: ${sObj.chesscom}` : ''].filter(Boolean).join(' / ') || 'Manuel',
        realName: sObj.n || (APP.liveData[sObj.u]?.displayName || sObj.u),
        ukd: sObj.ukd || '—',
        lic: sObj.lic || '—'
      });
    });
  });

  // İsme göre sırala
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
  let text = "Grup\tAd Soyad\tHesaplar\tUKD\tLisans No\n";
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    text += Array.from(cells).map(c => c.textContent.trim()).join('\t') + '\n';
  });

  navigator.clipboard.writeText(text).then(() => {
    showToast('Liste panoya kopyalandı ✓');
  }).catch(() => {
    showToast('Kopyalama başarısız', true);
  });
};

window.autoCreateBestGroup = async () => {
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); return; }
  
  const countStr = prompt("Haftanın en iyileri grubuna kaç sporcu eklensin?", "10");
  const count = parseInt(countStr);
  if(isNaN(count) || count <= 0) return;

  const levelInput = prompt("Hangi seviye için hesaplansın? (Tümü, Genel, Başlangıç, Orta, İleri)", "Tümü");
  if(levelInput === null) return;
  const normalizedLevel = levelInput.trim().toLocaleLowerCase('tr-TR');
  const levelMap = {
    'tümü': null,
    'tumu': null,
    'hepsi': null,
    'genel': 'Genel',
    'başlangıç': 'Başlangıç',
    'baslangic': 'Başlangıç',
    'orta': 'Orta',
    'ileri': 'İleri'
  };
  if(!(normalizedLevel in levelMap)){
    showToast('Seviye Tümü, Genel, Başlangıç, Orta veya İleri olmalı', true);
    return;
  }
  const selectedLevel = levelMap[normalizedLevel];

  // 1. Tüm gruplardaki benzersiz sporcuları topla
  const allStudentMap = collectBestCandidates(selectedLevel);
  const period = 'week';
  const allUsers = [...allStudentMap.keys()];

  if(allUsers.length === 0) {
    showToast('Hesaplanacak sporcu bulunamadı', true);
    setSyncStatus('ok', 'Firebase bağlı ✓');
    return;
  }

  refreshAllStudentsInBackground(false);

  const allStudents = allUsers
    .filter(u => APP.liveData[u] && !APP.liveData[u].error)
    .map(u => ({ student: allStudentMap.get(u), pts: calcScore(u, period) }));

  if(allStudents.length === 0) {
    showToast('Sporcu verileri arka planda hazırlanıyor, biraz sonra tekrar dene.', true);
    setSyncStatus('ok', 'Firebase bağlı ✓');
    return;
  }

  const missingCount = allUsers.length - allStudents.length;
  const staleCount = allUsers.filter(u => !hasFreshLiveData(u)).length;
  if(missingCount || staleCount){
    showToast(`Liste mevcut verilerle hazırlandı; ${missingCount || staleCount} sporcu arka planda güncelleniyor.`);
  }

  // 2. Puana göre sırala ve ilk X kişiyi al
  allStudents.sort((a,b) => b.pts - a.pts);
  const selectedBest = allStudents.slice(0, count);
  const bestStudents = selectedBest.map(s => s.student);

  const weekStartDate = weekStart();
  const weekEndDate = addDaysStr(weekStartDate, 6);
  const levelLabel = selectedLevel || 'Tümü';

  // 3. "Haftanın En İyileri" grubu için kayıt onayı al
  const groupName = selectedLevel ? `Haftanın En İyileri - ${selectedLevel}` : "Haftanın En İyileri";
  const preview = selectedBest.slice(0,5).map((s,i)=>{
    const u = studentUsername(s.student);
    return `${i+1}. ${s.student.n || APP.liveData[u]?.displayName || u} (${s.pts} puan)`;
  }).join('\n');
  const ok = confirm(
    `${formatWeekRange(weekStartDate, weekEndDate)} haftası için "${groupName}" güncellenecek ve arşive kaydedilecek.\n\n` +
    `Seviye: ${levelLabel}\nSporcu sayısı: ${bestStudents.length}\n\n` +
    `${preview}${selectedBest.length>5?'\n...':''}\n\nDevam edilsin mi?`
  );
  if(!ok){
    setSyncStatus('ok', 'Firebase bağlı ✓');
    showToast('Haftanın en iyileri güncellemesi iptal edildi');
    return;
  }

  // 4. "Haftanın En İyileri" grubunu bul veya oluştur
  let targetGroup = APP.groups.find(g => g.name === groupName);
  
  if(!targetGroup) {
    const newGid = 'best_' + Date.now();
    targetGroup = { id: newGid, name: groupName, level: selectedLevel || 'Genel' };
    APP.groups.push(targetGroup);
  } else {
    targetGroup.level = selectedLevel || targetGroup.level || 'Genel';
  }

  // 5. Öğrenci listesini güncelle ve kaydet
  APP.studentLists[targetGroup.id] = normalizeStudentList(bestStudents);
  APP.activeGid = targetGroup.id;

  const historyId = `${weekStartDate}_${selectedLevel || 'all'}`;
  const historyEntry = {
    id: historyId,
    weekStart: weekStartDate,
    weekEnd: weekEndDate,
    level: selectedLevel || 'Genel',
    levelLabel,
    groupName,
    count: bestStudents.length,
    createdAt: Date.now(),
    items: selectedBest.map((s,i)=>{
      const u = studentUsername(s.student);
      const st = periodStats(u, period);
      return {
        rank: i+1,
        username: u,
        name: s.student.n || APP.liveData[u]?.displayName || u,
        pts: s.pts,
        games: st.totalGames,
        puzzles: st.totalPuzzles,
        activeDays: st.activeDays,
        streak: st.streak,
        level: s.student.level || s.student.lvl || selectedLevel || 'Genel',
        groupName: s.student.groupName || ''
      };
    })
  };
  APP.bestHistory = normalizeBestHistory([
    historyEntry,
    ...(APP.bestHistory || []).filter(h => h.id !== historyId)
  ]);

  await fbSaveConfig();
  await fbSaveStudents(targetGroup.id);

  renderGroupBar();
  renderHeader();
  renderBestHistory(historyId);
  renderGrid();
  renderChamps();
  renderScoreTable();
  
  setSyncStatus('ok', 'Firebase bağlı ✓');
  showToast(`${bestStudents.length} sporcu ile "${groupName}" grubu güncellendi ✓`);
};

async function logUniqueVisit() {
    const today = todayStr();
    const lastVisit = localStorage.getItem('lichessPanelLastVisit');
    if (lastVisit === today) return; // Bugün zaten ziyaret edildi

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
        console.warn("Ziyaretçi sayımı güncellenemedi:", e);
    }
}

window.openStatsModal = async () => {
  if(!PIN.getIsAdmin()){ showToast('Bu işlem için yönetici girişi gerekli',true); return; }
  
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
  } catch (e) { showToast('İstatistikler yüklenemedi: ' + e.message, true); console.error("İstatistik yüklenirken hata:", e); }
};

// Auto-refresh 10 dakikada bir (lichess rate limit için)
setInterval(()=>{ if(getStudents().length>0) refreshAll(); },10*60*1000);
setInterval(()=>{ refreshAllStudentsInBackground(false); },30*60*1000);

// ── BAŞLANGIÇ ────────────────────────────────────────
(async()=>{
  applyTheme(localStorage.getItem(THEME_KEY));

  const versionBadge = document.getElementById('versionBadge');
  if(versionBadge) versionBadge.textContent = APP_VERSION;

  const splashStatus = document.getElementById('splashStatus');
  if(splashStatus) splashStatus.textContent = 'Veritabanına bağlanıyor...';

  logUniqueVisit();

  // Once kullanici listesini yukle (PIN ekrani icin)
  try{
    const usersSnap=await getFreshDoc(doc(db,'panel','users'));
    if(usersSnap.exists()) APP.users=usersSnap.data();
  }catch(e){ console.warn('Kullanici listesi yuklenemedi',e); }

  // Genel veriyi yukle (goruntuleme modu icin) — tamamen bitmesini bekle
  await fbLoad();
  
  // Arayüzü oluştur
  document.body.classList.add('readonly');
  buildCritPanel(); renderGroupBar(); renderHeader(); renderBestHistory();

  // Sporcu varsa ızgarayı hemen göster (Skeleton'lar belirecektir)
  renderGrid();
  renderChamps(); renderScoreTable(); renderBestHistory();

  // Yükleme tamamlandı, arayüz hazır, splash ekranını gizle!
  const splash = document.getElementById('splashScreen');
  if(splash) {
    splash.style.opacity = '0';
    setTimeout(() => {
      splash.style.visibility = 'hidden';
      splash.style.display = 'none';
    }, 600);
  }

  // Fotoğrafları arka planda yükle
  fcLoadAllPhotos().then(() => {
    if(document.getElementById('viewChesscard').style.display !== 'none'){
      renderChesscards();
    }
  });

  // Lichess verilerini arka planda güncelle (AWAIT ETMİYORUZ)
  if(getStudents().length > 0){
    refreshAll();
  }
  setTimeout(()=>refreshAllStudentsInBackground(false),5000);

  // Gerçek zamanlı dinleyiciyi SONRA başlat — fbLoad'dan hemen sonra
  // tetiklenmemesi için kısa bir gecikme ekliyoruz
  setTimeout(()=>{ fbListen(); }, 800);

  if(typeof PIN!=='undefined'&&PIN.init) PIN.init();
})();
