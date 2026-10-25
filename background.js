const STORE_KEY = 'wingoSnapshotRecordsV2';
const SETTINGS_KEY = 'wingoSnapshotSettingsV2';
const MAX_RECORDS = 3000;

const DEFAULT_SETTINGS = {
  firebaseUrl: 'https://wingo-pro-7dca6-default-rtdb.firebaseio.com',
  firebaseApiKey: 'AIzaSyBFo3mjjNoUCm75asniZ5yscY3Gu0YAC5E',
  firebasePath: 'history/records',
  firebaseEnabled: true
};
chrome.runtime.onInstalled.addListener(async () => {
  const existing = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  if (!existing) await chrome.storage.local.set({[SETTINGS_KEY]: DEFAULT_SETTINGS});
});
const clean = s => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 150);
function dataOf(body) { return body && body.data && typeof body.data === 'object' ? body.data : (body || {}); }
function issueOf(body) { const d=dataOf(body); return String(d.issueNumber || d.currentIssueNumber || d.issue || d.period || d.issueNo || ''); }
function snapshotOf(body) { const d=dataOf(body); return d.snapshot && typeof d.snapshot === 'object' ? d.snapshot : null; }
function resultOf(body) {
  const d=dataOf(body);
  const keys=['number','result','winNumber','winningNumber','openNumber','lotteryNumber','resultNumber'];
  for (const k of keys) if (d[k] !== undefined && d[k] !== null && typeof d[k] !== 'object') return d[k];
  return null;
}
function classify(url, body) {
  if (/Energy\/GetPanel/i.test(url)) return 'snapshot';
  if (/GetWinTheLotteryResult|GetLastFiveIssueNumberResult|GetNoaverageEmerdList|GetEmerdList|GetGameIssue|GetHistoryIssuePage|GetRecordPage/i.test(url)) return 'result-history';
  return 'api';
}
function endpointPath(url) { try { const u=new URL(String(url), 'https://local.invalid'); return u.pathname; } catch { return String(url).split('?')[0]; } }
function stableHash(value) {
  const s = JSON.stringify(value); let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  return (h>>>0).toString(16);
}
async function capture(payload) {
  const body=payload.body || {}; const data=dataOf(body); const snap=snapshotOf(body); const issue=issueOf(body);
  const category=classify(payload.url, body);
  const record={
    id:'', category, url:payload.url, method:payload.method || 'GET', httpStatus:payload.status || 0,
    capturedAt:Number(payload.capturedAt)||Date.now(), issueNumber:issue || null,
    currentIssueNumber:String(data.currentIssueNumber || issue || '') || null,
    phase:data.phase ?? null, serverTime:data.serverTime ?? null,
    startTime:data.startTime ?? null, endTime:data.endTime ?? null,
    snapNo:snap && snap.snapNo !== undefined ? snap.snapNo : null,
    snapshotList:snap && Array.isArray(snap.list) ? snap.list : null,
    result:resultOf(body), code:body.code ?? null, msg:body.msg ?? null,
    body
  };
  // De-duplicate only identical response content for the same endpoint/issue/snapshot.
  const path=endpointPath(record.url);
  const hash=stableHash({path,issue:record.issueNumber,snapNo:record.snapNo,body:record.body});
  record.id=`${clean(record.category)}_${clean(path)}_${clean(record.issueNumber || 'noissue')}_${clean(record.snapNo ?? 'nosnap')}_${hash}`;
  const stored=await chrome.storage.local.get([STORE_KEY, SETTINGS_KEY]);
  const records=Array.isArray(stored[STORE_KEY]) ? stored[STORE_KEY] : [];
  const existing=records.findIndex(r=>r.id===record.id);
  if(existing >= 0) { records[existing].lastSeenAt=record.capturedAt; records[existing].seenCount=(records[existing].seenCount||1)+1; }
  else { record.firstSeenAt=record.capturedAt; record.lastSeenAt=record.capturedAt; record.seenCount=1; records.unshift(record); }
  if(records.length>MAX_RECORDS) records.length=MAX_RECORDS;
  await chrome.storage.local.set({[STORE_KEY]:records, lastCaptureAt:record.capturedAt, lastCaptureUrl:record.url});
  const settings=stored[SETTINGS_KEY] || {};
  if(settings.firebaseEnabled && settings.firebaseUrl && settings.firebaseApiKey) {
    syncFirebase(record, settings).catch(async err => {
      await chrome.storage.local.set({firebaseLastError: String(err && err.message || err), firebaseLastAttemptAt: Date.now()});
    });
  }
}
async function firebaseToken(settings) {
  const saved=(await chrome.storage.local.get('wingoFirebaseToken')).wingoFirebaseToken;
  if(saved && saved.idToken && saved.expiresAt>Date.now()+60000) return saved.idToken;
  if(saved && saved.refreshToken) {
    const rr=await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(settings.firebaseApiKey)}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:saved.refreshToken})});
    if(rr.ok){const j=await rr.json();const token={idToken:j.id_token,refreshToken:j.refresh_token,expiresAt:Date.now()+Number(j.expires_in||3600)*1000};await chrome.storage.local.set({wingoFirebaseToken:token});return token.idToken;}
  }
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(settings.firebaseApiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})});
  if(!r.ok) throw new Error(`Firebase anonymous auth failed (${r.status})`);
  const j=await r.json(); const token={idToken:j.idToken,refreshToken:j.refreshToken,expiresAt:Date.now()+Number(j.expiresIn||3600)*1000}; await chrome.storage.local.set({wingoFirebaseToken:token}); return token.idToken;
}
async function syncFirebase(record, settings) {
  const base=String(settings.firebaseUrl).trim().replace(/\/+$/,'');
  if(!/^https:\/\//i.test(base)) throw new Error('Firebase URL must start with https://');
  const token=await firebaseToken(settings);
  const path=settings.firebasePath || 'history/records';
  const url=`${base}/${path}/${encodeURIComponent(record.id)}.json?auth=${encodeURIComponent(token)}`;
  const res=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)});
  if(!res.ok) throw new Error(`Firebase write failed (${res.status}); local capture is still saved`);
  await chrome.storage.local.set({firebaseLastSuccessAt:Date.now(),firebaseLastError:''});
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if(msg && msg.type==='WINGO_CAPTURE') { capture(msg.payload).then(()=>sendResponse({ok:true})).catch(e=>sendResponse({ok:false,error:String(e)})); return true; }
  if(msg && msg.type==='WINGO_EXPORT') { chrome.storage.local.get(STORE_KEY).then(v=>sendResponse({records:v[STORE_KEY]||[]})); return true; }
  return false;
});
