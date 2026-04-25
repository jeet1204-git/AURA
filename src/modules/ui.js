/**
 * ui.js — AURA Dashboard UI controller (Supabase edition)
 * Two-state dashboard: idle (pre-session) and active (during session).
 *
 * Firebase changes:
 *   - onAuthStateChanged(auth, cb)       → supabase.auth.onAuthStateChange(cb)
 *   - user.getIdToken()                  → (await supabase.auth.getSession()).data.session?.access_token
 *   - signOut(auth)                      → supabase.auth.signOut()
 *   - inline Firestore dynamic imports   → updateProfile() / updateUserExtraData() from firestore.js
 */

import { supabase } from './auth.js';
import { WORKER_URL } from '../config/constants.js';
import {
  loadUserProfile, loadProfiles, loadUserSessionHistory,
  createProfile, deleteProfile, setActiveProfile, updateProfile,
  migrateUserToProfiles, getLangFlag, ensureUserDoc,
} from './firestore.js';
import { initSession } from './session-adapter.js';
import './session.js';

let currentUser  = null;   // wrapped user object (see wrapUser)
let allProfiles  = [];
let activeProfile = null;
let userDoc      = null;
let _initialized = false;  // guard: only call onUserReady once per login
let _initInFlight = false;

// ── Wire session bridge before auth resolves so buttons are ready ─────────────
initSession({
  getIdToken:         () => currentUser ? currentUser.getIdToken() : Promise.resolve(null),
  getUserDisplayName: () => currentUser?.displayName || currentUser?.email?.split('@')[0] || 'there',
  getActiveProfile:   () => activeProfile,
});

// ── AUTH STATE ────────────────────────────────────────────────────────────────
supabase.auth.onAuthStateChange((event, session) => {
  // Avoid redirect loops during auth bootstrap/refresh events.
  // Only hard-redirect on explicit sign-out.
  if (event === 'SIGNED_OUT') {
    _initialized = false;
    window.location.href = '/src/app/screens/auth.html';
    return;
  }

  if (!session?.user) return;

  const wrapped = wrapUser(session.user);
  currentUser        = wrapped;
  window.currentUser = wrapped;

  if (!_initialized && !_initInFlight) {
    _initInFlight = true;
    onUserReady(wrapped)
      .then(() => { _initialized = true; })
      .catch((e) => {
        console.error('[AURA] dashboard init failed:', e?.message);
        _initialized = false;
      })
      .finally(() => { _initInFlight = false; });
  }
});


// Bootstrap current session once on initial page load.
(async function bootstrapDashboardSession() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;
  if (!user) {
    window.location.href = '/src/app/screens/auth.html';
    return;
  }
  if (_initialized || _initInFlight) return;
  const wrapped = wrapUser(user);
  currentUser = wrapped;
  window.currentUser = wrapped;
  _initInFlight = true;
  onUserReady(wrapped)
    .then(() => { _initialized = true; })
    .catch((e) => {
      console.error('[AURA] bootstrap init failed:', e?.message);
      _initialized = false;
    })
    .finally(() => { _initInFlight = false; });
})();

/**
 * Wraps a Supabase user into a Firebase-compatible shape so the rest of the
 * code can use user.uid, user.displayName, user.getIdToken() unchanged.
 */
function wrapUser(sbUser) {
  return {
    uid:         sbUser.id,
    email:       sbUser.email,
    displayName: sbUser.user_metadata?.full_name
               || sbUser.user_metadata?.display_name
               || null,
    photoURL:    sbUser.user_metadata?.avatar_url || null,
    getIdToken:  async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token || null;
    },
  };
}

// ── ON USER READY ─────────────────────────────────────────────────────────────
async function onUserReady(user) {
  // Fill name + avatar immediately
  const displayName = user.displayName || user.email?.split('@')[0] || 'Learner';
  setEl('sbUserName', displayName);
  setEl('sbAvatar', displayName[0].toUpperCase());

  // Greet by time of day
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  setEl('idleGreeting', `${greeting}, ${displayName.split(' ')[0]}`);

  // Load root user doc + ensure AURA fields exist
  try {
    await ensureUserDoc(user.uid, { name: user.displayName, email: user.email });
    userDoc = await loadUserProfile(user.uid);
  } catch (e) {}

  // If onboarding isn't complete, force onboarding flow for this user.
  if (!userDoc?.onboardingComplete) {
    window.location.href = '/src/app/screens/onboarding.html';
    return;
  }

  // Migrate / load profiles
  try {
    allProfiles = await migrateUserToProfiles(user.uid, userDoc || {});
  } catch (e) { allProfiles = []; }

  // If onboarding is marked complete but no profile exists, send user back to onboarding.
  if (!allProfiles.length) {
    window.location.href = '/src/app/screens/onboarding.html';
    return;
  }

  const activeId = userDoc?.activeProfileId || allProfiles[0]?.id || null;
  activeProfile  = allProfiles.find(p => p.id === activeId) || allProfiles[0] || null;
  window._activeProfile = activeProfile;

  // Render everything
  renderSidebar(activeProfile, userDoc);
  renderIdleScreen(activeProfile, userDoc);
  renderRightPanel(userDoc);
  renderProfileSwitcher(allProfiles, activeProfile, userDoc);
  loadMemoryPanel(user, activeProfile?.id || null);

  // Load recent sessions
  loadRecentSessions(user.uid, activeProfile?.id || null);

  // Build session bar chart and skill bars from history
  buildSessionChart(user.uid, activeProfile?.id || null);
  renderSkillProgress(user.uid, activeProfile?.id || null);
}

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
function renderSidebar(profile, doc) {
  if (!profile) {
    setEl('sbUserSub', 'No profile — click to add one');
    setEl('sclName',   'No profile');
    setEl('sclLevel',  'Click your name above to get started');
    return;
  }

  const flag = profile.flag || getLangFlag(profile.targetLanguage);
  setEl('sbUserSub',   `${profile.level} · ${profile.targetLanguage}`);
  setEl('sclFlag',     flag);
  setEl('sclName',     `${profile.targetLanguage} ${profile.level}`);
  setEl('sclLevel',    profile.goal || 'Daily conversation');
  setEl('liveBtnSub',  `${profile.targetLanguage} ${profile.level} · ${profile.preferredMode || 'Guided'}`);
}

// ── IDLE SCREEN ───────────────────────────────────────────────────────────────
function renderIdleScreen(profile, doc) {
  const card = document.getElementById('idleProfileCard');
  if (profile) {
    card.style.display = 'block';
    const flag = profile.flag || getLangFlag(profile.targetLanguage);
    setEl('ipcFlag',  flag);
    setEl('ipcLang',  profile.targetLanguage);
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

  // idleStartBtn is wired by session-bridge.js (via initSession) — no duplicate listener needed here.
}

// ── RECENT SESSIONS ───────────────────────────────────────────────────────────
async function loadRecentSessions(uid, profileId) {
  const container = document.getElementById('idleRecentContent');
  if (!container) return;

  try {
    const sessions = await loadUserSessionHistory(uid, 5);

    const filtered = profileId
      ? sessions.filter(s => !s.profileId || s.profileId === profileId)
      : sessions;

    if (!filtered.length) {
      container.innerHTML = '<div class="idle-recent-empty">No sessions yet. Start your first one!</div>';
      return;
    }

    container.innerHTML = filtered.map(s => {
      const date    = s.endedAt ? new Date(s.endedAt) : null;
      const dateStr = date ? date.toLocaleDateString('en', { month:'short', day:'numeric' }) : '';
      const dur     = s.durationSeconds ? `${Math.round(s.durationSeconds / 60)} min` : '';
      const score   = s.scores?.overall ? `${Math.round(s.scores.overall)}%` : '';
      const flag    = getLangFlag(s.scenarioTitle?.split(' ')[0] || activeProfile?.targetLanguage || 'German');

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

  if (activeProfile?.level) {
    const nextLevel = { A1:'A2', A2:'B1', B1:'B2', B2:'C1', C1:'C2' }[activeProfile.level] || 'next level';
    setEl('xpLabel', `XP to ${nextLevel}`);
  }

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
  // HTML IDs are wd-0 (Sun) through wd-6 (Sat), matching JS getDay() values.
  const today = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  for (let jsDay = 0; jsDay <= 6; jsDay++) {
    const daysAgo = (today - jsDay + 7) % 7;
    const el = document.getElementById('wd-' + jsDay);
    if (el) el.classList.toggle('on', daysAgo < Math.min(streak, 7));
  }
}

// ── TWO-STATE SWITCHING ───────────────────────────────────────────────────────
window.addEventListener('aura:session-started', () => enterSessionState());
window.addEventListener('aura:session-ended',   () => enterIdleState());

let _statePoller = null;
let _viewState = 'unknown';
function startStatePoller() {
  if (_statePoller) return;
  _statePoller = setInterval(() => {
    const idleEl = document.getElementById('idle-screen');
    const sessionEl = document.getElementById('session-screen');
    if (!idleEl || !sessionEl) return;

    if (window.sessionActive === true && _viewState !== 'session') {
      enterSessionState();
    } else if (window.sessionActive !== true && _viewState !== 'idle') {
      enterIdleState();
    }
  }, 500);
}
startStatePoller();
enterIdleState();

function enterSessionState() {
  if (_viewState === 'session') return;
  _viewState = 'session';
  document.getElementById('idle-screen').style.display    = 'none';
  document.getElementById('session-screen').classList.add('active');
  document.getElementById('liveStatsCard').style.display  = 'block';
  document.getElementById('endSessionBtn').style.display  = '';
  document.getElementById('endSessionBtn').style.visibility = 'visible';
  document.getElementById('summaryBtn').style.display     = '';
  document.getElementById('sessionTimer').style.display   = '';

  const badge    = document.getElementById('sessionStatusBadge');
  const badgeTxt = document.getElementById('sessionStatusText');
  if (badge)    badge.classList.remove('idle');
  if (badgeTxt) badgeTxt.textContent = 'Session Active';

  if (activeProfile) {
    setEl('topbarSessionInfo', `· ${activeProfile.targetLanguage} ${activeProfile.level} · ${activeProfile.preferredMode === 'immersion' ? 'Immersion' : 'Guided'}`);
    setEl('rpTitle', 'Live Session');
    setEl('rpSub',   `${activeProfile.targetLanguage} ${activeProfile.level}`);
  }

  setEl('wordsSpoken', '0');
  setEl('correctCount', '0');
  setEl('errCount',     '0');
}

function enterIdleState() {
  if (_viewState === 'idle') return;
  _viewState = 'idle';
  document.getElementById('idle-screen').style.display    = 'flex';
  document.getElementById('session-screen').classList.remove('active');
  document.getElementById('liveStatsCard').style.display  = 'none';
  document.getElementById('endSessionBtn').style.display  = 'none';
  document.getElementById('endSessionBtn').style.visibility = 'hidden';
  document.getElementById('summaryBtn').style.display     = 'none';
  document.getElementById('sessionTimer').style.display   = 'none';

  const badge    = document.getElementById('sessionStatusBadge');
  const badgeTxt = document.getElementById('sessionStatusText');
  if (badge)    badge.classList.add('idle');
  if (badgeTxt) badgeTxt.textContent = 'Ready';

  setEl('topbarSessionInfo', '');
  setEl('rpTitle', 'Your Progress');

  if (currentUser) {
    loadRecentSessions(currentUser.uid, activeProfile?.id || null);
    renderSkillProgress(currentUser.uid, activeProfile?.id || null);
  }
}

// endSessionBtn click is handled by session-bridge.js (via initSession).
// Do NOT add a second listener here — it would cause a double confirm() dialog.

// summaryBtn is handled by session-bridge.js (via initSession) — shows the full summary overlay.

async function renderSkillProgress(uid, profileId) {
  const container = document.getElementById('skillProgressContent');
  if (!container) return;

  try {
    const sessions = await loadUserSessionHistory(uid, 20);
    const filtered = profileId ? sessions.filter(s => !s.profileId || s.profileId === profileId) : sessions;
    if (!filtered.length) return;

    const scored = filtered.filter(s => s.scores);
    if (!scored.length) return;

    const avg = (key) => {
      const vals = scored.map(s => s.scores[key]).filter(v => typeof v === 'number');
      return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
    };

    const skills = [
      { name: 'Overall',    val: avg('overall'),    color: 'linear-gradient(90deg,var(--purple),var(--blue))' },
      { name: 'Grammar',    val: avg('grammar'),    color: 'linear-gradient(90deg,var(--amber),#f59e0b)' },
      { name: 'Vocabulary', val: avg('vocabulary'), color: 'linear-gradient(90deg,var(--blue),#38bdf8)' },
      { name: 'Fluency',    val: avg('fluency'),    color: 'linear-gradient(90deg,var(--green),#22c55e)' },
    ].filter(s => s.val !== null);

    if (!skills.length) return;

    container.innerHTML = skills.map(s => `
      <div class="prog-row">
        <div class="prog-top">
          <span class="prog-name">${s.name}</span>
          <span class="prog-pct">${s.val}%</span>
        </div>
        <div class="prog-track">
          <div class="prog-fill" style="width:${s.val}%;background:${s.color};"></div>
        </div>
      </div>
    `).join('');

    const note = document.getElementById('skillProgressNote');
    if (note) note.textContent = `avg of ${scored.length} session${scored.length>1?'s':''} `;
  } catch(e) {}
}

// ── LIVE STATS from session-bridge events ─────────────────────────────────────
window.addEventListener('aura:stats', (e) => {
  const { wordsSpoken, correctCount, errCount } = e.detail || {};
  if (wordsSpoken  != null) setEl('wordsSpoken',  wordsSpoken);
  if (correctCount != null) setEl('correctCount', correctCount);
  if (errCount     != null) setEl('errCount',     errCount);
  if (correctCount != null || errCount != null) {
    updateAccuracyRing(correctCount || 0, errCount || 0);
  }
});

setInterval(() => {
  if (!window.sessionActive) return;
  const c = parseInt(document.getElementById('correctCount')?.textContent || '0', 10);
  const e = parseInt(document.getElementById('errCount')?.textContent     || '0', 10);
  updateAccuracyRing(c, e);
}, 2000);

// ── MEMORY PANEL ─────────────────────────────────────────────────────────────
async function loadMemoryPanel(user, profileId) {
  const container = document.getElementById('memoryCards');
  if (!container) return;

  try {
    // user.getIdToken() returns the Supabase access_token via wrapUser
    const idToken = await user.getIdToken();
    if (!idToken) return;  // not signed in — nothing to load
    const url = `${WORKER_URL}/memory?language=${encodeURIComponent(
      window.__auraTargetLanguage || 'German'
    )}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) return;
    const memory  = await res.json();
    renderMemoryCards(memory, container);
  } catch (e) { /* keep placeholder */ }
}

function renderMemoryCards(memory, container) {
  if (!memory) return;

  const items = [];
  (memory.recurringMistakes  || []).slice(0,2).forEach(m  => items.push({ tag:'weak',   text: typeof m === 'string' ? m : m.pattern, note:'Recurring mistake' }));
  (memory.weakTopics         || []).slice(0,2).forEach(t  => items.push({ tag:'weak',   text:t, note:'Needs practice' }));
  (memory.masteredTopics     || []).slice(0,2).forEach(t  => items.push({ tag:'strong', text:t, note:'Mastered' }));
  (memory.breakthroughMoments||[]).slice(0,1).forEach(b  => items.push({ tag:'strong', text:b, note:'Breakthrough' }));
  if (memory.currentFocus) items.push({ tag:'goal', text:memory.currentFocus, note:'Current focus' });
  (memory.leftUnfinished || []).slice(0,1).forEach(u => items.push({ tag:'goal', text:u, note:'From last session' }));

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

  const isPaid  = doc?.isPaid || false;
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

  // Edit profile
  const editBtn = document.createElement('button');
  editBtn.style.cssText = `width:100%;padding:10px 14px;background:transparent;border:none;border-bottom:0.5px solid var(--border);display:flex;align-items:center;gap:10px;color:var(--purple);font-size:12.5px;font-family:'Inter',sans-serif;cursor:pointer;`;
  editBtn.innerHTML = '<span style="font-size:16px">✏️</span><span>Edit profile</span>';
  editBtn.addEventListener('click', () => { menu.remove(); showEditProfileModal(active); });
  menu.appendChild(editBtn);

  // Add profile
  const addBtn = document.createElement('button');
  addBtn.style.cssText = `width:100%;padding:10px 14px;background:transparent;border:none;border-bottom:0.5px solid var(--border);display:flex;align-items:center;gap:10px;color:${isPaid||profiles.length===0?'var(--purple)':'var(--muted)'};font-size:12.5px;font-family:'Inter',sans-serif;`;
  if (isPaid || profiles.length === 0) {
    addBtn.innerHTML = '<span style="font-size:16px">＋</span><span>Add learning profile</span>';
    addBtn.addEventListener('click', () => { menu.remove(); showAddProfileModal(); });
  } else {
    addBtn.innerHTML = '<span style="font-size:16px">＋</span><span>Multiple profiles · <a style="color:var(--purple);text-decoration:underline" href="/#pricing">Upgrade to Pro</a></span>';
    addBtn.addEventListener('click', (e) => {
      if (e.target.tagName !== 'A') window.location.href = '/#pricing';
      menu.remove();
    });
  }
  menu.appendChild(addBtn);

  // Sign out — Supabase
  const soBtn = document.createElement('button');
  soBtn.style.cssText = `width:100%;padding:10px 14px;background:transparent;border:none;display:flex;align-items:center;gap:10px;color:var(--red);font-size:12.5px;font-family:'Inter',sans-serif;`;
  soBtn.innerHTML = '<span>↩</span><span>Sign out</span>';
  soBtn.addEventListener('click', async () => {
    menu.remove();
    await supabase.auth.signOut();
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

  activeProfile        = profile;
  window._activeProfile = profile;
  await setActiveProfile(currentUser.uid, profile.id);
  renderSidebar(profile, userDoc);
  renderIdleScreen(profile, userDoc);
  renderRightPanel(userDoc);
  loadMemoryPanel(currentUser, profile.id);
  loadRecentSessions(currentUser.uid, profile.id);
  showToast(`Switched to ${profile.targetLanguage} ${profile.level}`);
}

async function handleDeleteProfile(profileId) {
  if (allProfiles.length <= 1)       { showToast('Cannot remove your only profile.'); return; }
  if (profileId === activeProfile?.id) { showToast('Switch to another profile first.'); return; }
  if (!confirm('Remove this profile?')) return;

  await deleteProfile(currentUser.uid, profileId);
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
    const lang   = overlay.querySelector('#np-lang').value;
    const level  = overlay.querySelector('#np-level').value;
    const native = overlay.querySelector('#np-native').value.trim() || 'English';
    const mode   = overlay.querySelector('#np-mode').value;
    const goal   = overlay.querySelector('#np-goal').value;
    const btn    = overlay.querySelector('#np-save');
    const errEl  = overlay.querySelector('#np-error');

    btn.disabled = true; btn.textContent = 'Creating…';
    const newP = await createProfile(currentUser.uid, { targetLanguage:lang, level, nativeLanguage:native, langPref:native, goal, preferredMode:mode });

    if (newP) {
      overlay.remove();
      allProfiles.push(newP);
      await handleSwitchProfile(newP);
      renderProfileSwitcher(allProfiles, newP, userDoc);
    } else {
      errEl.textContent = 'Could not create profile. Try again.';
      btn.disabled = false; btn.textContent = 'Create profile';
    }
  });
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = '/src/app/screens/auth.html';
});

// ── THEME ─────────────────────────────────────────────────────────────────────
const themeToggle = document.getElementById('themeToggle');
const htmlEl      = document.documentElement;
const savedTheme  = localStorage.getItem('aura-theme') || '';
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

if (dot)  dot.style.pointerEvents  = 'none';
if (ring) ring.style.pointerEvents = 'none';

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

// ── WAVEFORM ──────────────────────────────────────────────────────────────────
const waveform = document.getElementById('waveform');
if (waveform) {
  for (let i=0;i<38;i++) {
    const b = document.createElement('div');
    b.className = 'wf-bar'+(i>14&&i<24?' active':'');
    b.style.setProperty('--d', `${(0.8+Math.random()*0.8).toFixed(2)}s`);
    b.style.setProperty('--h', `${(6+Math.random()*24).toFixed(0)}px`);
    b.style.animationDelay = `${(Math.random()*0.5).toFixed(2)}s`;
    waveform.appendChild(b);
  }
  setInterval(() => {
    waveform.querySelectorAll('.wf-bar').forEach(b => {
      b.classList.toggle('active', Math.random()>0.45);
      b.style.setProperty('--h', `${(3+Math.random()*26).toFixed(0)}px`);
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

// ── SUGGESTION CHIPS ──────────────────────────────────────────────────────────
document.querySelectorAll('.sug-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const input = document.getElementById('chatInput');
    if (input) { input.value=chip.textContent.trim(); input.focus(); }
  });
});

// ── CHAT INPUT + SEND BUTTON ──────────────────────────────────────────────────
(function wireChatInput() {
  const input   = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  if (!input) return;

  function submitChat() {
    const text = input.value.trim();
    if (!text) return;
    if (typeof window.sendTextMessage === 'function') {
      window.sendTextMessage();
    }
  }

  sendBtn?.addEventListener('click', submitChat);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitChat(); }
  });
})();

// ── EDIT PROFILE MODAL ────────────────────────────────────────────────────────
// NOTE: All Firebase Firestore dynamic imports replaced with Supabase via updateProfile()
function showEditProfileModal(profile) {
  if (!profile) return;

  const overlay = document.createElement('div');
  overlay.id = 'edit-profile-overlay';
  overlay.style.cssText = `position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.75);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:24px;overflow-y:auto;`;

  const examDateVal    = profile.examDate && profile.examDate !== 'not_booked' ? profile.examDate : '';
  const examDateStatus = profile.examDate === 'not_booked' ? 'not_booked' : (profile.examDate ? 'booked' : '');

  overlay.innerHTML = `
    <div style="background:#13131e;border:0.5px solid rgba(255,255,255,0.13);border-radius:24px;padding:36px 32px;width:100%;max-width:560px;position:relative;">
      <h2 style="font-size:18px;font-weight:600;margin-bottom:4px;">Edit learning profile</h2>
      <p style="font-size:13px;color:rgba(232,232,242,0.5);margin-bottom:28px;">Changes take effect from your next session.</p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          <label style="font-size:11px;font-weight:500;color:rgba(232,232,242,0.5);display:block;margin-bottom:6px;">Target language</label>
          <select id="ep-lang" style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,0.13);color:#e8e8f2;font-family:'Inter',sans-serif;font-size:13px;outline:none;">
            ${['German','French','Japanese','Spanish','Italian','Mandarin','Korean','Portuguese','Arabic','Hindi'].map(l => `<option ${l === profile.targetLanguage ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:500;color:rgba(232,232,242,0.5);display:block;margin-bottom:6px;">Current level</label>
          <select id="ep-level" style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,0.13);color:#e8e8f2;font-family:'Inter',sans-serif;font-size:13px;outline:none;">
            ${['A1','A2','B1','B2','C1'].map(l => `<option ${l === profile.level ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <label style="font-size:11px;font-weight:500;color:rgba(232,232,242,0.5);display:block;margin-bottom:6px;">Learning goal</label>
        <select id="ep-goal" style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,0.13);color:#e8e8f2;font-family:'Inter',sans-serif;font-size:13px;outline:none;">
          <option value="exam"         ${profile.goal === 'exam'         ? 'selected' : ''}>Exam preparation</option>
          <option value="conversation" ${profile.goal === 'conversation' ? 'selected' : ''}>Daily conversation</option>
          <option value="professional" ${profile.goal === 'professional' ? 'selected' : ''}>Professional / Work</option>
          <option value="study_abroad" ${profile.goal === 'study_abroad' ? 'selected' : ''}>Study abroad</option>
        </select>
      </div>

      <div id="ep-exam-section" style="margin-bottom:16px;display:${profile.goal === 'exam' ? '' : 'none'};">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:11px;font-weight:500;color:rgba(232,232,242,0.5);display:block;margin-bottom:6px;">Exam name</label>
            <input id="ep-exam-name" type="text" value="${profile.examName || ''}" placeholder="e.g. Goethe B1"
              style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,0.13);color:#e8e8f2;font-family:'Inter',sans-serif;font-size:13px;outline:none;" />
          </div>
          <div>
            <label style="font-size:11px;font-weight:500;color:rgba(232,232,242,0.5);display:block;margin-bottom:6px;">Exam date</label>
            <select id="ep-exam-date-type" style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,0.13);color:#e8e8f2;font-family:'Inter',sans-serif;font-size:13px;outline:none;">
              <option value="booked"     ${examDateStatus === 'booked'     ? 'selected' : ''}>Date booked</option>
              <option value="not_booked" ${examDateStatus === 'not_booked' ? 'selected' : ''}>Not booked yet</option>
            </select>
          </div>
        </div>
        <div id="ep-date-picker-wrap" style="margin-top:10px;display:${examDateStatus === 'booked' ? '' : 'none'};">
          <input id="ep-exam-date" type="date" value="${examDateVal}"
            style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,0.13);color:#e8e8f2;font-family:'Inter',sans-serif;font-size:13px;outline:none;" />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          <label style="font-size:11px;font-weight:500;color:rgba(232,232,242,0.5);display:block;margin-bottom:6px;">Native language</label>
          <input id="ep-native" type="text" value="${profile.nativeLanguage || ''}" placeholder="e.g. Gujarati"
            style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,0.13);color:#e8e8f2;font-family:'Inter',sans-serif;font-size:13px;outline:none;" />
        </div>
        <div>
          <label style="font-size:11px;font-weight:500;color:rgba(232,232,242,0.5);display:block;margin-bottom:6px;">Correction language</label>
          <input id="ep-langpref" type="text" value="${profile.langPref || profile.nativeLanguage || ''}" placeholder="e.g. English"
            style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,0.13);color:#e8e8f2;font-family:'Inter',sans-serif;font-size:13px;outline:none;" />
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <label style="font-size:11px;font-weight:500;color:rgba(232,232,242,0.5);display:block;margin-bottom:6px;">Session mode</label>
        <select id="ep-mode" style="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,0.13);color:#e8e8f2;font-family:'Inter',sans-serif;font-size:13px;outline:none;">
          <option value="guided"    ${(profile.preferredMode || 'guided') === 'guided'    ? 'selected' : ''}>Guided — AURA corrects in your native language</option>
          <option value="immersion" ${profile.preferredMode === 'immersion' ? 'selected' : ''}>Immersion — maximum target language</option>
        </select>
      </div>

      <div style="margin-bottom:20px;">
        <label style="font-size:11px;font-weight:500;color:rgba(232,232,242,0.5);display:block;margin-bottom:8px;">Daily practice time</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;" id="ep-time-chips">
          ${[10,20,30,60].map(m => `
            <button type="button" data-val="${m}"
              style="padding:9px 16px;border-radius:999px;border:1px solid ${(profile.dailyMinutes||20)==m?'rgba(157,127,255,0.4)':'rgba(255,255,255,0.13)'};background:${(profile.dailyMinutes||20)==m?'rgba(157,127,255,0.12)':'transparent'};color:${(profile.dailyMinutes||20)==m?'#e8e8f2':'rgba(232,232,242,0.5)'};font-family:'Inter',sans-serif;font-size:13px;cursor:pointer;">
              ${m === 60 ? '1 hour' : m + ' min'}
            </button>`).join('')}
        </div>
      </div>

      <div id="ep-error" style="font-size:12px;color:#f87171;min-height:16px;margin-bottom:12px;"></div>

      <div style="display:flex;gap:10px;">
        <button id="ep-cancel" style="padding:12px 20px;border-radius:12px;background:transparent;border:0.5px solid rgba(255,255,255,0.13);color:rgba(232,232,242,0.5);font-family:'Inter',sans-serif;font-size:13px;cursor:pointer;">Cancel</button>
        <button id="ep-save"   style="flex:1;padding:12px 20px;border-radius:12px;background:linear-gradient(135deg,#7c5cfc,#4b8ef0);border:none;color:#fff;font-family:'Inter',sans-serif;font-size:13px;font-weight:500;cursor:pointer;">Save changes</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Wire exam section visibility
  const goalSel   = overlay.querySelector('#ep-goal');
  const examSec   = overlay.querySelector('#ep-exam-section');
  goalSel.addEventListener('change', () => {
    examSec.style.display = goalSel.value === 'exam' ? '' : 'none';
  });

  // Wire date picker visibility
  const dateTypeSel    = overlay.querySelector('#ep-exam-date-type');
  const datePickerWrap = overlay.querySelector('#ep-date-picker-wrap');
  datePickerWrap.style.display = dateTypeSel.value === 'booked' ? '' : 'none';
  dateTypeSel.addEventListener('change', () => {
    datePickerWrap.style.display = dateTypeSel.value === 'booked' ? '' : 'none';
  });

  // Wire daily minutes chips
  let selectedMinutes = profile.dailyMinutes || 20;
  overlay.querySelectorAll('#ep-time-chips button').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedMinutes = parseInt(btn.dataset.val);
      overlay.querySelectorAll('#ep-time-chips button').forEach(b => {
        const isActive = parseInt(b.dataset.val) === selectedMinutes;
        b.style.background   = isActive ? 'rgba(157,127,255,0.12)' : 'transparent';
        b.style.borderColor  = isActive ? 'rgba(157,127,255,0.4)'  : 'rgba(255,255,255,0.13)';
        b.style.color        = isActive ? '#e8e8f2'                 : 'rgba(232,232,242,0.5)';
      });
    });
  });

  overlay.querySelector('#ep-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // ── SAVE ─────────────────────────────────────────────────────────────────────
  overlay.querySelector('#ep-save').addEventListener('click', async () => {
    const errEl   = overlay.querySelector('#ep-error');
    const saveBtn = overlay.querySelector('#ep-save');
    errEl.textContent = '';

    const native   = overlay.querySelector('#ep-native').value.trim();
    const langpref = overlay.querySelector('#ep-langpref').value.trim();
    const goal     = overlay.querySelector('#ep-goal').value;
    const examName = overlay.querySelector('#ep-exam-name')?.value.trim() || null;
    const dateType = overlay.querySelector('#ep-exam-date-type')?.value;
    const dateVal  = overlay.querySelector('#ep-exam-date')?.value || null;

    if (!native) { errEl.textContent = 'Native language is required.'; return; }

    let examDate = null, examDateConfirmed = false;
    if (goal === 'exam') {
      if (dateType === 'not_booked') {
        examDate = 'not_booked'; examDateConfirmed = false;
      } else if (dateType === 'booked') {
        if (!dateVal) { errEl.textContent = 'Please enter your exam date.'; return; }
        examDate = dateVal; examDateConfirmed = true;
      }
    }

    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

    try {
      const updates = {
        targetLanguage:      overlay.querySelector('#ep-lang').value,
        level:               overlay.querySelector('#ep-level').value,
        goal,
        examName:            goal === 'exam' ? examName : null,
        examDate:            goal === 'exam' ? examDate : null,
        examDateConfirmed:   goal === 'exam' ? examDateConfirmed : false,
        nativeLanguage:      native,
        langPref:            langpref || native,
        preferredMode:       overlay.querySelector('#ep-mode').value,
        dailyMinutes:        selectedMinutes,
        flag:                getLangFlag(overlay.querySelector('#ep-lang').value),
      };

      // updateProfile() in firestore.js updates the profiles table AND users.extra_data
      await updateProfile(currentUser.uid, activeProfile.id, updates);

      // Update in-memory objects so the session picks up changes immediately
      if (activeProfile) { Object.assign(activeProfile, updates); window._activeProfile = activeProfile; }
      if (userDoc)        Object.assign(userDoc, updates);

      overlay.remove();
      renderSidebar(activeProfile, userDoc);
      renderIdleScreen(activeProfile, userDoc);
      renderRightPanel(userDoc);
      showToast('Profile updated. Changes apply from your next session.');
    } catch (err) {
      console.error('[AURA] edit profile failed:', err);
      errEl.textContent = 'Could not save. Please try again.';
      saveBtn.disabled = false; saveBtn.textContent = 'Save changes';
    }
  });
}

// ── SESSION CHART (stub) ──────────────────────────────────────────────────────
function buildSessionChart(uid, profileId) {
  // Placeholder — wired in post-session scoring
}

// ── ACCURACY RING ─────────────────────────────────────────────────────────────
function updateAccuracyRing(correct, errors) {
  const total = correct + errors;
  const pct   = total > 0 ? Math.round((correct / total) * 100) : 0;
  // IDs match the SVG elements in app-screens.html
  const label = document.getElementById('accPct');
  const ring  = document.getElementById('accRing');

  if (label) label.textContent = pct + '%';
  if (ring) {
    const circumference = 2 * Math.PI * 22; // r=22 matches the SVG circle
    ring.style.strokeDasharray  = circumference;
    ring.style.strokeDashoffset = circumference - (pct / 100) * circumference;
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
