/**
 * ui.js — AURA Dashboard UI controller
 * Two-state dashboard: idle (pre-session) and active (during session).
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG, WORKER_URL } from '../config/constants.js';
import {
  loadUserProfile, loadProfiles, loadUserSessionHistory,
  createProfile, deleteProfile, setActiveProfile,
  migrateUserToProfiles, getLangFlag
} from './firestore.js';
import { initSession } from './session-bridge.js';

// ── FIREBASE ──────────────────────────────────────────────────────────────────
const fbApp = initializeApp(FIREBASE_CONFIG);
const auth  = getAuth(fbApp);

let currentUser   = null;
let allProfiles   = [];
let activeProfile = null;
let userDoc       = null;

// Wire session bridge before auth resolves so buttons are ready
initSession({
  getIdToken:         () => currentUser ? currentUser.getIdToken() : Promise.resolve(null),
  getUserDisplayName: () => currentUser?.displayName || currentUser?.email?.split('@')[0] || 'there',
});

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = '/src/app/screens/auth.html'; return; }
  currentUser = user;
  window.currentUser = user;
  onUserReady(user);
});

// ── ON USER READY ─────────────────────────────────────────────────────────────
async function onUserReady(user) {
  // Fill name + avatar immediately from Firebase Auth
  const displayName = user.displayName || user.email?.split('@')[0] || 'Learner';
  setEl('sbUserName', displayName);
  setEl('sbAvatar', displayName[0].toUpperCase());

  // Greet by time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  setEl('idleGreeting', `${greeting}, ${displayName.split(' ')[0]}`);

  // Load root user doc
  try { userDoc = await loadUserProfile(user.uid); } catch (e) {}

  // Migrate / load profiles
  try {
    allProfiles = await migrateUserToProfiles(user.uid, userDoc || {});
  } catch (e) { allProfiles = []; }

  const activeId = userDoc?.activeProfileId || allProfiles[0]?.id || null;
  activeProfile  = allProfiles.find(p => p.id === activeId) || allProfiles[0] || null;

  // Render everything
  renderSidebar(activeProfile, userDoc);
  renderIdleScreen(activeProfile, userDoc);
  renderRightPanel(userDoc);
  renderProfileSwitcher(allProfiles, activeProfile, userDoc);
  loadMemoryPanel(user, activeProfile?.id || null);

  // Load recent sessions
  loadRecentSessions(user.uid, activeProfile?.id || null);
}

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
function renderSidebar(profile, doc) {
  if (!profile) {
    setEl('sbUserSub', 'No profile — click to add one');
    setEl('sclName', 'No profile');
    setEl('sclLevel', 'Click your name above to get started');
    return;
  }
  const flag = profile.flag || getLangFlag(profile.targetLanguage);
  setEl('sbUserSub', `${profile.level} · ${profile.targetLanguage}`);
  setEl('sclFlag', flag);
  setEl('sclName', `${profile.targetLanguage} ${profile.level}`);
  setEl('sclLevel', profile.goal || 'Daily conversation');
  setEl('liveBtnSub', `${profile.targetLanguage} ${profile.level} · ${profile.preferredMode || 'Guided'}`);
}

// ── IDLE SCREEN ───────────────────────────────────────────────────────────────
function renderIdleScreen(profile, doc) {
  const card = document.getElementById('idleProfileCard');

  if (profile) {
    card.style.display = 'block';
    const flag = profile.flag || getLangFlag(profile.targetLanguage);
    setEl('ipcFlag', flag);
    setEl('ipcLang', profile.targetLanguage);
    setEl('ipcLevel', `${profile.level} · ${profile.preferredMode === 'immersion' ? 'Immersion' : 'Guided'}`);

    const goalWrap = document.getElementById('ipcGoalWrap');
    if (goalWrap) goalWrap.innerHTML = profile.goal
      ? `<div class="ipc-goal">${escHtml(profile.goal)}</div>`
      : '';

    const meta = document.getElementById('ipcMeta');
    if (meta) {
      const chips = [
        profile.nativeLanguage ? `Native: ${profile.nativeLanguage}` : null,
        profile.weeklyCommitment || null,
      ].filter(Boolean);
      meta.innerHTML = chips.map(c => `<span class="ipc-chip">${escHtml(c)}</span>`).join('');
    }

    setEl('idleSubtext', `Ready for your ${profile.targetLanguage} practice?`);
  } else {
    card.style.display = 'none';
    setEl('idleSubtext', 'Set up your first learning profile to get started.');
  }

  // Wire idle start button
  document.getElementById('idleStartBtn')?.addEventListener('click', () => {
    document.getElementById('liveSessionBtn')?.click();
  });
}

// ── RECENT SESSIONS ───────────────────────────────────────────────────────────
async function loadRecentSessions(uid, profileId) {
  const container = document.getElementById('idleRecentContent');
  if (!container) return;

  try {
    const sessions = await loadUserSessionHistory(uid, 5);
    // Filter to active profile if we have one
    const filtered = profileId
      ? sessions.filter(s => !s.profileId || s.profileId === profileId)
      : sessions;

    if (!filtered.length) {
      container.innerHTML = '<div class="idle-recent-empty">No sessions yet. Start your first one!</div>';
      return;
    }

    container.innerHTML = filtered.map(s => {
      const date   = s.endedAt ? new Date(s.endedAt) : null;
      const dateStr = date ? date.toLocaleDateString('en', { month:'short', day:'numeric' }) : '';
      const dur    = s.durationSeconds ? `${Math.round(s.durationSeconds / 60)} min` : '';
      const score  = s.scores?.overall ? `${Math.round(s.scores.overall)}%` : '';
      const flag   = getLangFlag(s.scenarioTitle?.split(' ')[0] || activeProfile?.targetLanguage || 'German');
      return `
        <div class="recent-session-item">
          <div class="rsi-flag">${flag}</div>
          <div class="rsi-info">
            <div class="rsi-title">${escHtml(s.scenarioTitle || s.level || 'Practice session')}</div>
            <div class="rsi-meta">${[dateStr, dur, s.mode ? s.mode.charAt(0).toUpperCase() + s.mode.slice(1) : ''].filter(Boolean).join(' · ')}</div>
          </div>
          ${score ? `<div class="rsi-score">${score}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div class="idle-recent-empty">Could not load session history.</div>';
  }
}

// ── RIGHT PANEL ───────────────────────────────────────────────────────────────
function renderRightPanel(doc) {
  // Streak
  const streak = doc?.streak || 0;
  setEl('streakCount', streak);
  renderWeekDots(streak);

  // XP
  const xp    = doc?.xp || 0;
  const xpMax = 1000;
  const pct   = Math.min(100, Math.round((xp / xpMax) * 100));
  setEl('xpVal', `${xp} / ${xpMax}`);
  const xpFill = document.getElementById('xpFill');
  if (xpFill) xpFill.style.width = pct + '%';

  // XP label from active profile target
  if (activeProfile?.level) {
    const nextLevel = { A1:'A2', A2:'B1', B1:'B2', B2:'C1', C1:'C2' }[activeProfile.level] || 'next level';
    setEl('xpLabel', `XP to ${nextLevel}`);
  }

  // Goal card from profile
  if (activeProfile?.goal) {
    setEl('rpSub', `${activeProfile.targetLanguage} ${activeProfile.level}`);
    document.getElementById('goalContent').innerHTML = `
      <div style="font-size:13px;color:var(--purple);font-weight:500;margin-bottom:6px;">${escHtml(activeProfile.goal)}</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.6;">
        Keep this goal in mind during your session. AURA will tailor corrections and scenarios to help you reach it.
      </div>
    `;
  }
}

function renderWeekDots(streak) {
  const today = new Date().getDay(); // 0=Sun
  const ids   = ['wd-Su','wd-M','wd-T','wd-W','wd-Th','wd-F','wd-S'];
  // JS day 0=Sun maps to index 0, 1=Mon to index 1, etc.
  ids.forEach((id, jsDay) => {
    const daysAgo = (today - jsDay + 7) % 7;
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', daysAgo < Math.min(streak, 7));
  });
}

// ── TWO-STATE SWITCHING ───────────────────────────────────────────────────────
// session-bridge.js fires these when session state changes
window.addEventListener('aura:session-started', () => enterSessionState());
window.addEventListener('aura:session-ended',   () => enterIdleState());

// Also poll sessionActive since bridge doesn't fire events yet
let _statePoller = null;
function startStatePoller() {
  if (_statePoller) return;
  _statePoller = setInterval(() => {
    if (window.sessionActive && document.getElementById('idle-screen').style.display !== 'none') {
      enterSessionState();
    } else if (!window.sessionActive && document.getElementById('session-screen').classList.contains('active')) {
      enterIdleState();
    }
  }, 300);
}
startStatePoller();

function enterSessionState() {
  document.getElementById('idle-screen').style.display    = 'none';
  document.getElementById('session-screen').classList.add('active');
  document.getElementById('liveStatsCard').style.display  = 'block';
  document.getElementById('endSessionBtn').style.display  = '';
  document.getElementById('sessionTimer').style.display   = '';

  const badge    = document.getElementById('sessionStatusBadge');
  const badgeTxt = document.getElementById('sessionStatusText');
  if (badge)    { badge.classList.remove('idle'); }
  if (badgeTxt) badgeTxt.textContent = 'Session Active';

  if (activeProfile) {
    setEl('topbarSessionInfo', `· ${activeProfile.targetLanguage} ${activeProfile.level} · ${activeProfile.preferredMode === 'immersion' ? 'Immersion' : 'Guided'}`);
    setEl('rpTitle', 'Live Session');
    setEl('rpSub', `${activeProfile.targetLanguage} ${activeProfile.level}`);
  }

  // Reset live counters
  setEl('wordsSpoken', '0');
  setEl('correctCount', '0');
  setEl('errCount', '0');
}

function enterIdleState() {
  document.getElementById('idle-screen').style.display    = 'flex';
  document.getElementById('session-screen').classList.remove('active');
  document.getElementById('liveStatsCard').style.display  = 'none';
  document.getElementById('endSessionBtn').style.display  = 'none';
  document.getElementById('sessionTimer').style.display   = 'none';

  const badge    = document.getElementById('sessionStatusBadge');
  const badgeTxt = document.getElementById('sessionStatusText');
  if (badge)    { badge.classList.add('idle'); }
  if (badgeTxt) badgeTxt.textContent = 'Ready';

  setEl('topbarSessionInfo', '');
  setEl('rpTitle', 'Your Progress');

  // Refresh recent sessions when session ends
  if (currentUser) loadRecentSessions(currentUser.uid, activeProfile?.id || null);
}

// End session button
document.getElementById('endSessionBtn')?.addEventListener('click', async () => {
  if (!window.sessionActive) return;
  if (!confirm('End this session? Your progress will be saved.')) return;
  if (typeof window.endSession === 'function') await window.endSession();
});

// ── LIVE STATS from session-bridge events ─────────────────────────────────────
window.addEventListener('aura:stats', (e) => {
  const { wordsSpoken, correctCount, errCount } = e.detail || {};
  if (wordsSpoken  != null) setEl('wordsSpoken',  wordsSpoken);
  if (correctCount != null) setEl('correctCount', correctCount);
  if (errCount     != null) setEl('errCount',     errCount);
});

// ── MEMORY PANEL ─────────────────────────────────────────────────────────────
async function loadMemoryPanel(user, profileId) {
  const container = document.getElementById('memoryCards');
  if (!container) return;
  try {
    const idToken = await user.getIdToken();
    const url = `${WORKER_URL}/memory?userId=${user.uid}${profileId ? `&profileId=${profileId}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) return;
    const memory = await res.json();
    renderMemoryCards(memory, container);
  } catch (e) { /* keep placeholder */ }
}

function renderMemoryCards(memory, container) {
  if (!memory) return;
  const items = [];
  (memory.recurringMistakes || []).slice(0, 2).forEach(m => items.push({ tag:'weak',   text:m, note:'Recurring mistake' }));
  (memory.weakTopics        || []).slice(0, 2).forEach(t => items.push({ tag:'weak',   text:t, note:'Needs practice' }));
  (memory.masteredTopics    || []).slice(0, 2).forEach(t => items.push({ tag:'strong', text:t, note:'Mastered' }));
  (memory.breakthroughMoments||[]).slice(0,1). forEach(b => items.push({ tag:'strong', text:b, note:'Breakthrough' }));
  if (memory.currentFocus) items.push({ tag:'goal', text:memory.currentFocus, note:'Current focus' });
  (memory.leftUnfinished    || []).slice(0, 1).forEach(u => items.push({ tag:'goal',   text:u, note:'From last session' }));
  if (!items.length) return;
  container.innerHTML = items.map(i => `
    <div class="mem-item">
      <div class="mem-tag ${i.tag}">${i.tag[0].toUpperCase()+i.tag.slice(1)}</div>
      <div class="mem-body">
        <div class="mem-text">${escHtml(i.text)}</div>
        ${i.note ? `<div class="mem-note">${escHtml(i.note)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ── PROFILE SWITCHER ──────────────────────────────────────────────────────────
function renderProfileSwitcher(profiles, active, doc) {
  const card = document.getElementById('sbUserCard');
  if (!card) return;
  const isPaid = doc?.isPaid || false;
  const newCard = card.cloneNode(true);
  card.parentNode.replaceChild(newCard, card);
  newCard.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleProfileMenu(profiles, active, isPaid, newCard);
  });
}

function toggleProfileMenu(profiles, active, isPaid, anchor) {
  const existing = document.getElementById('profile-menu');
  if (existing) { existing.remove(); return; }

  const menu = document.createElement('div');
  menu.id = 'profile-menu';
  menu.style.cssText = `
    position:absolute;left:8px;right:8px;
    top:${anchor.offsetTop + anchor.offsetHeight + 6}px;
    background:var(--surface2);border:0.5px solid var(--border2);
    border-radius:12px;z-index:500;overflow:hidden;
    box-shadow:0 8px 32px rgba(0,0,0,.5);
  `;

  // Profile rows
  profiles.forEach(p => {
    const item = document.createElement('button');
    item.style.cssText = `width:100%;padding:10px 14px;background:${p.id===active?.id?'rgba(157,127,255,.1)':'transparent'};border:none;border-bottom:0.5px solid var(--border);display:flex;align-items:center;gap:10px;text-align:left;color:var(--text);font-size:12.5px;font-family:'Inter',sans-serif;`;
    item.innerHTML = `
      <span style="font-size:18px">${p.flag||getLangFlag(p.targetLanguage)}</span>
      <span style="flex:1"><span style="display:block;font-weight:500">${p.targetLanguage} ${p.level}</span><span style="font-size:10px;color:var(--muted)">${p.goal||'Practice'}</span></span>
      ${p.id===active?.id?'<span style="color:var(--purple);font-size:11px">Active</span>':''}
      ${profiles.length>1?`<span class="del-prof" data-id="${p.id}" style="color:var(--muted);font-size:11px;padding:2px 6px">✕</span>`:''}
    `;
    item.addEventListener('click', async (e) => {
      if (e.target.classList.contains('del-prof')) {
        e.stopPropagation();
        await handleDeleteProfile(e.target.dataset.id);
        menu.remove(); return;
      }
      if (p.id !== active?.id) await handleSwitchProfile(p);
      menu.remove();
    });
    menu.appendChild(item);
  });

  // Add profile button
  const addBtn = document.createElement('button');
  addBtn.style.cssText = `width:100%;padding:10px 14px;background:transparent;border:none;border-bottom:0.5px solid var(--border);display:flex;align-items:center;gap:10px;color:${isPaid||profiles.length===0?'var(--purple)':'var(--muted)'};font-size:12.5px;font-family:'Inter',sans-serif;`;
  if (isPaid || profiles.length === 0) {
    addBtn.innerHTML = '<span style="font-size:16px">＋</span><span>Add learning profile</span>';
    addBtn.addEventListener('click', () => { menu.remove(); showAddProfileModal(); });
  } else {
    addBtn.innerHTML = '<span style="font-size:16px">＋</span><span>Multiple profiles · <a style="color:var(--purple);text-decoration:underline" href="/#pricing">Upgrade to Pro</a></span>';
    // The anchor inside handles navigation; clicking the button also works
    addBtn.addEventListener('click', (e) => {
      if (e.target.tagName !== 'A') window.location.href = '/#pricing';
      menu.remove();
    });
  }
  menu.appendChild(addBtn);

  // Sign out
  const soBtn = document.createElement('button');
  soBtn.style.cssText = `width:100%;padding:10px 14px;background:transparent;border:none;display:flex;align-items:center;gap:10px;color:var(--red);font-size:12.5px;font-family:'Inter',sans-serif;`;
  soBtn.innerHTML = '<span>↩</span><span>Sign out</span>';
  soBtn.addEventListener('click', async () => {
    menu.remove();
    await signOut(auth);
    window.location.href = '/src/app/screens/auth.html';
  });
  menu.appendChild(soBtn);

  document.querySelector('.sidebar').style.position = 'relative';
  document.querySelector('.sidebar').appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once:true }), 0);
}

async function handleSwitchProfile(profile) {
  if (window.sessionActive) {
    if (!confirm('A session is active. End it and switch profiles?')) return;
    if (typeof window.endSession === 'function') await window.endSession().catch(() => {});
  }
  activeProfile = profile;
  await setActiveProfile(currentUser.uid, profile.id);
  renderSidebar(profile, userDoc);
  renderIdleScreen(profile, userDoc);
  renderRightPanel(userDoc);
  loadMemoryPanel(currentUser, profile.id);
  loadRecentSessions(currentUser.uid, profile.id);
  showToast(`Switched to ${profile.targetLanguage} ${profile.level}`);
}

async function handleDeleteProfile(profileId) {
  if (allProfiles.length <= 1) { showToast('Cannot remove your only profile.'); return; }
  if (profileId === activeProfile?.id) { showToast('Switch to another profile first.'); return; }
  if (!confirm('Remove this profile?')) return;
  const { deleteProfile: dp } = await import('./firestore.js');
  await dp(currentUser.uid, profileId);
  allProfiles = allProfiles.filter(p => p.id !== profileId);
  renderProfileSwitcher(allProfiles, activeProfile, userDoc);
  showToast('Profile removed.');
}

function showAddProfileModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;`;
  overlay.innerHTML = `
    <div style="background:var(--surface);border:0.5px solid var(--border2);border-radius:20px;padding:32px;width:100%;max-width:480px;">
      <h2 style="font-size:18px;font-weight:600;margin-bottom:6px;">New learning profile</h2>
      <p style="font-size:13px;color:var(--muted);margin-bottom:24px;">Each profile has its own sessions and AURA memory.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
        <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px;">Language</label>
          <select id="np-lang" style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid var(--border2);color:var(--text);font-family:'Inter',sans-serif;font-size:13px;outline:none;">
            <option>German</option><option>French</option><option>Japanese</option><option>Spanish</option><option>Italian</option><option>Mandarin</option><option>Korean</option>
          </select></div>
        <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px;">Level</label>
          <select id="np-level" style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid var(--border2);color:var(--text);font-family:'Inter',sans-serif;font-size:13px;outline:none;">
            <option>A1</option><option>A2</option><option selected>B1</option><option>B2</option><option>C1</option>
          </select></div>
        <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px;">Native language</label>
          <input id="np-native" type="text" placeholder="e.g. Gujarati" value="${activeProfile?.nativeLanguage||''}" style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid var(--border2);color:var(--text);font-family:'Inter',sans-serif;font-size:13px;outline:none;"/></div>
        <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px;">Mode</label>
          <select id="np-mode" style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid var(--border2);color:var(--text);font-family:'Inter',sans-serif;font-size:13px;outline:none;">
            <option value="guided">Guided</option><option value="immersion">Immersion</option>
          </select></div>
      </div>
      <div style="margin-bottom:20px;"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px;">Goal</label>
        <select id="np-goal" style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid var(--border2);color:var(--text);font-family:'Inter',sans-serif;font-size:13px;outline:none;">
          <option>Daily conversation</option><option>Exam preparation</option><option>Grammar accuracy</option><option>Pronunciation</option><option>Job interviews</option>
        </select></div>
      <div style="display:flex;gap:10px;">
        <button id="np-cancel" style="flex:1;padding:12px;border-radius:12px;background:transparent;border:0.5px solid var(--border2);color:var(--muted2);font-family:'Inter',sans-serif;font-size:13px;">Cancel</button>
        <button id="np-save" style="flex:2;padding:12px;border-radius:12px;background:linear-gradient(135deg,#7c5cfc,#4b8ef0);border:none;color:#fff;font-family:'Inter',sans-serif;font-size:13px;font-weight:500;">Create profile</button>
      </div>
      <div id="np-error" style="margin-top:10px;font-size:12px;color:var(--red);min-height:16px;"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#np-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#np-save').addEventListener('click', async () => {
    const lang  = overlay.querySelector('#np-lang').value;
    const level = overlay.querySelector('#np-level').value;
    const native= overlay.querySelector('#np-native').value.trim() || 'English';
    const mode  = overlay.querySelector('#np-mode').value;
    const goal  = overlay.querySelector('#np-goal').value;
    const btn   = overlay.querySelector('#np-save');
    const err   = overlay.querySelector('#np-error');
    btn.disabled = true; btn.textContent = 'Creating…';
    const { createProfile: cp } = await import('./firestore.js');
    const newP = await cp(currentUser.uid, { targetLanguage:lang, level, nativeLanguage:native, langPref:native, goal, preferredMode:mode });
    if (newP) {
      overlay.remove();
      allProfiles.push(newP);
      await handleSwitchProfile(newP);
      renderProfileSwitcher(allProfiles, newP, userDoc);
    } else {
      err.textContent = 'Could not create profile. Try again.';
      btn.disabled = false; btn.textContent = 'Create profile';
    }
  });
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = '/src/app/screens/auth.html';
});

// ── THEME ─────────────────────────────────────────────────────────────────────
const themeToggle = document.getElementById('themeToggle');
const htmlEl = document.documentElement;
const savedTheme = localStorage.getItem('aura-theme') || '';
htmlEl.setAttribute('data-theme', savedTheme);
if (themeToggle) {
  themeToggle.textContent = savedTheme === 'light' ? '🌙' : '☀️';
  themeToggle.addEventListener('click', () => {
    const next = htmlEl.getAttribute('data-theme') === 'light' ? '' : 'light';
    htmlEl.setAttribute('data-theme', next);
    themeToggle.textContent = next === 'light' ? '🌙' : '☀️';
    localStorage.setItem('aura-theme', next);
  });
}

// ── CUSTOM CURSOR ─────────────────────────────────────────────────────────────
const dot  = document.getElementById('cursorDot');
const ring = document.getElementById('cursorRing');
let mx=0,my=0,rx=0,ry=0;
document.addEventListener('mousemove', e => {
  mx=e.clientX; my=e.clientY;
  if (dot) { dot.style.left=mx+'px'; dot.style.top=my+'px'; }
});
(function animCursor(){
  rx+=(mx-rx)*0.14; ry+=(my-ry)*0.14;
  if (ring) { ring.style.left=rx+'px'; ring.style.top=ry+'px'; }
  requestAnimationFrame(animCursor);
})();
document.querySelectorAll('button,a,.sug-chip,.nav-item,.mem-item,.sb-user,.idle-start-btn').forEach(el => {
  el.addEventListener('mouseenter', () => ring?.classList.add('hover'));
  el.addEventListener('mouseleave', () => ring?.classList.remove('hover'));
});
document.addEventListener('mousedown', () => ring?.classList.add('click'));
document.addEventListener('mouseup',   () => ring?.classList.remove('click'));

// ── WAVEFORM ─────────────────────────────────────────────────────────────────
const waveform = document.getElementById('waveform');
if (waveform) {
  for (let i=0;i<38;i++) {
    const b=document.createElement('div');
    b.className='wf-bar'+(i>14&&i<24?' active':'');
    b.style.setProperty('--d',`${(0.8+Math.random()*0.8).toFixed(2)}s`);
    b.style.setProperty('--h',`${(6+Math.random()*24).toFixed(0)}px`);
    b.style.animationDelay=`${(Math.random()*0.5).toFixed(2)}s`;
    waveform.appendChild(b);
  }
  setInterval(() => {
    waveform.querySelectorAll('.wf-bar').forEach(b => {
      b.classList.toggle('active', Math.random()>0.45);
      b.style.setProperty('--h',`${(3+Math.random()*26).toFixed(0)}px`);
    });
  }, 900);
}

// ── NAV ───────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const label = item.querySelector('.nav-icon')?.nextSibling?.textContent?.trim() || '';
    if (!['Live Session'].includes(label)) showToast(`${label} is coming soon`);
  });
});

// ── SUGGESTION CHIPS ─────────────────────────────────────────────────────────
document.querySelectorAll('.sug-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const input = document.getElementById('chatInput');
    if (input) { input.value=chip.textContent.trim(); input.focus(); }
  });
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg) {
  const existing = document.getElementById('aura-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'aura-toast';
  t.style.cssText = `position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:var(--surface2);border:0.5px solid var(--border2);color:var(--text);padding:10px 20px;border-radius:10px;font-size:13px;font-weight:500;z-index:9000;box-shadow:0 8px 32px rgba(0,0,0,.4);`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
