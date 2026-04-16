/**
 * ui.js — AURA Dashboard UI controller
 * Handles auth, theme, cursor, waveform, nav, goals.
 * Voice session is owned by session.js (full engine).
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG, WORKER_URL } from '../config/constants.js';
import { loadUserProfile } from './firestore.js';

// Side-effect import — registers window.startSession, window.endSession,
// window.toggleMic, window.sendTextMessage, and all other session globals.
import './session.js';

// ── FIREBASE AUTH ─────────────────────────────────────────────────────────────
const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

let currentUser = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = '/src/app/screens/auth.html';
    return;
  }
  currentUser = user;
  // Push into store.js window proxy so session.js can read it immediately
  window.currentUser = user;
  onUserReady(user);
});

// ── ON USER READY ─────────────────────────────────────────────────────────────
async function onUserReady(user) {
  // 1. Fill sidebar with Firebase Auth data immediately (no flicker)
  const nameEl   = document.getElementById('sbUserName');
  const subEl    = document.getElementById('sbUserSub');
  const avatarEl = document.getElementById('sbAvatar');
  const displayName = user.displayName || user.email?.split('@')[0] || 'Learner';
  if (nameEl)   nameEl.textContent   = displayName;
  if (subEl)    subEl.textContent    = user.email || '';
  if (avatarEl) avatarEl.textContent = displayName[0].toUpperCase();

  // 2. Load Firestore profile for streak, XP, level
  let profile = null;
  try {
    profile = await loadUserProfile(user.uid);
    if (profile) renderProfile(profile);
  } catch (e) {
    console.warn('[AURA] Could not load profile:', e?.message);
  }

  // 3. Seed store.js globals from profile so session.js has what it needs
  //    before the user presses Start. Defaults to A2 guided conversation.
  initSessionState(profile);

  // 4. Load memory panel from Worker
  loadMemoryPanel(user);
}

// ── SEED SESSION STATE ────────────────────────────────────────────────────────
// session.js reads selectedLevel, selectedLangPref, selectedScenario etc. from
// window (proxied by store.js). We set them here from the Firestore profile so
// the first session is personalised, with safe A2 guided defaults.
function initSessionState(profile) {
  window.selectedLevel       = profile?.level            || 'A2';
  window.selectedLangPref    = profile?.nativeLanguage   || profile?.langPref || 'English';
  window.selectedSessionMode = profile?.preferredMode    || 'guided';
  window.selectedProgramType = 'general';

  // Let session.js resolve the actual scenario object on startSession().
  // resolveScenarioForLevel is exposed on window by session.js after import.
  if (typeof window.resolveScenarioForLevel === 'function') {
    window.selectedScenario = window.resolveScenarioForLevel(window.selectedLevel, null) || null;
  } else {
    window.selectedScenario = null;
  }

  console.log('[AURA][ui] session state seeded', {
    level:    window.selectedLevel,
    langPref: window.selectedLangPref,
    mode:     window.selectedSessionMode,
    scenario: window.selectedScenario?.id || null,
  });
}

// ── RENDER PROFILE (streak, XP, level) ───────────────────────────────────────
function renderProfile(profile) {
  // Streak
  const streakEl = document.querySelector('.streak-count');
  if (streakEl && profile.streak != null) streakEl.textContent = profile.streak;

  // XP bar
  const xpVal  = document.querySelector('.xp-val');
  const xpFill = document.querySelector('.xp-fill');
  if (profile.xp != null) {
    const xp    = profile.xp;
    const xpMax = 1000;
    const pct   = Math.min(100, Math.round((xp / xpMax) * 100));
    if (xpVal)  xpVal.textContent = `${xp} / ${xpMax}`;
    if (xpFill) xpFill.style.width = pct + '%';
  }

  // Level in sidebar language card
  const levelEl = document.querySelector('.scl-level');
  if (levelEl && profile.level) levelEl.textContent = profile.level + ' · ' + (profile.targetLanguage || 'German');

  // Sub-label under name — show level instead of email if present
  const subEl = document.getElementById('sbUserSub');
  if (subEl && profile.level) subEl.textContent = profile.level + ' · ' + (profile.targetLanguage || 'German');

  // Week dots — mark today and streak days
  renderWeekDots(profile.streak || 0);
}

function renderWeekDots(streak) {
  const dots = document.querySelectorAll('.wd');
  if (!dots.length) return;
  const today = new Date().getDay(); // 0 = Sunday
  // Map our M T W T F S S order to JS day index
  const order = [1, 2, 3, 4, 5, 6, 0];
  dots.forEach((dot, i) => {
    const dayIndex = order[i];
    const daysAgo = (today - dayIndex + 7) % 7;
    dot.classList.toggle('on', daysAgo < Math.min(streak, 7));
  });
}

// ── MEMORY PANEL ─────────────────────────────────────────────────────────────
async function loadMemoryPanel(user) {
  const memoryCards = document.querySelector('.memory-cards');
  if (!memoryCards) return;

  try {
    const idToken = await user.getIdToken();
    const res = await fetch(`${WORKER_URL}/memory?userId=${user.uid}`, {
      headers: { Authorization: `Bearer ${idToken}` }
    });
    if (!res.ok) return;
    const memory = await res.json();
    renderMemoryPanel(memory, memoryCards);
  } catch (e) {
    console.warn('[AURA] Could not load memory:', e?.message);
  }
}

function renderMemoryPanel(memory, container) {
  if (!memory || !container) return;

  const items = [];

  // Recurring mistakes -> Weak
  (memory.recurringMistakes || []).slice(0, 2).forEach(m => {
    items.push({ tag: 'weak', text: m, note: 'Recurring mistake' });
  });

  // Weak topics -> Weak
  (memory.weakTopics || []).slice(0, 2).forEach(t => {
    items.push({ tag: 'weak', text: t, note: 'Needs more practice' });
  });

  // Mastered topics -> Strong
  (memory.masteredTopics || []).slice(0, 2).forEach(t => {
    items.push({ tag: 'strong', text: t, note: 'Mastered' });
  });

  // Breakthrough moments -> Strong
  (memory.breakthroughMoments || []).slice(0, 1).forEach(b => {
    items.push({ tag: 'strong', text: b, note: 'Breakthrough' });
  });

  // Current focus -> Goal
  if (memory.currentFocus) {
    items.push({ tag: 'goal', text: memory.currentFocus, note: memory.lastSessionSummary ? 'Current focus' : '' });
  }

  // Left unfinished from last session
  (memory.leftUnfinished || []).slice(0, 1).forEach(u => {
    items.push({ tag: 'goal', text: u, note: 'Pick up from last session' });
  });

  if (!items.length) return; // keep placeholder if nothing to show

  container.innerHTML = items.map(item => `
    <div class="mem-item">
      <div class="mem-tag ${item.tag}">${item.tag.charAt(0).toUpperCase() + item.tag.slice(1)}</div>
      <div class="mem-body">
        <div class="mem-text">${escHtml(item.text)}</div>
        ${item.note ? `<div class="mem-note">${escHtml(item.note)}</div>` : ''}
      </div>
    </div>
  `).join('');

  // Re-attach cursor hover listeners for new elements
  container.querySelectorAll('.mem-item').forEach(el => {
    el.addEventListener('mouseenter', () => ring?.classList.add('hover'));
    el.addEventListener('mouseleave', () => ring?.classList.remove('hover'));
  });

  // Also update Recent Corrections from memory
  renderCorrections(memory);
}

function renderCorrections(memory) {
  const corrSection = document.querySelector('.rp-card:last-of-type');
  if (!corrSection) return;
  const mistakes = memory.recurringMistakes || [];
  if (!mistakes.length) return;

  const items = mistakes.slice(0, 3).map(m => `
    <div class="correction-item">
      <div class="ci-icon">&#8594;</div>
      <div>
        <div class="ci-wrong">${escHtml(m)}</div>
        <div class="ci-note">Recurring pattern — keep an eye on this</div>
      </div>
    </div>
  `).join('');

  const label = corrSection.querySelector('.rp-card-label');
  if (label) label.insertAdjacentHTML('afterend', items);
  corrSection.querySelectorAll('.correction-item:not(:first-of-type)').forEach(el => el.remove());
  corrSection.insertAdjacentHTML('beforeend', items);
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── THEME ─────────────────────────────────────────────────────────────────────
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;
const savedTheme = localStorage.getItem('aura-theme') || '';
html.setAttribute('data-theme', savedTheme);
if (themeToggle) {
  themeToggle.textContent = savedTheme === 'light' ? '🌙' : '☀️';
  themeToggle.addEventListener('click', () => {
    const next = html.getAttribute('data-theme') === 'light' ? '' : 'light';
    html.setAttribute('data-theme', next);
    themeToggle.textContent = next === 'light' ? '🌙' : '☀️';
    localStorage.setItem('aura-theme', next);
  });
}

// ── CUSTOM CURSOR ─────────────────────────────────────────────────────────────
const dot  = document.getElementById('cursorDot');
const ring = document.getElementById('cursorRing');
let mx = 0, my = 0, rx = 0, ry = 0;
document.addEventListener('mousemove', e => {
  mx = e.clientX; my = e.clientY;
  if (dot) { dot.style.left = mx + 'px'; dot.style.top = my + 'px'; }
});
(function animCursor() {
  rx += (mx - rx) * 0.14; ry += (my - ry) * 0.14;
  if (ring) { ring.style.left = rx + 'px'; ring.style.top = ry + 'px'; }
  requestAnimationFrame(animCursor);
})();
document.querySelectorAll('button, a, .sug-chip, .nav-item, .mem-item').forEach(el => {
  el.addEventListener('mouseenter', () => ring?.classList.add('hover'));
  el.addEventListener('mouseleave', () => ring?.classList.remove('hover'));
});
document.addEventListener('mousedown', () => ring?.classList.add('click'));
document.addEventListener('mouseup',   () => ring?.classList.remove('click'));

// ── WAVEFORM ──────────────────────────────────────────────────────────────────
const waveform = document.getElementById('waveform');
if (waveform) {
  for (let i = 0; i < 38; i++) {
    const b = document.createElement('div');
    b.className = 'wf-bar' + (i > 14 && i < 24 ? ' active' : '');
    b.style.setProperty('--d', `${(0.8 + Math.random() * 0.8).toFixed(2)}s`);
    b.style.setProperty('--h', `${(6 + Math.random() * 24).toFixed(0)}px`);
    b.style.animationDelay = `${(Math.random() * 0.5).toFixed(2)}s`;
    waveform.appendChild(b);
  }
  setInterval(() => {
    waveform.querySelectorAll('.wf-bar').forEach(b => {
      b.classList.toggle('active', Math.random() > 0.45);
      b.style.setProperty('--h', `${(3 + Math.random() * 26).toFixed(0)}px`);
    });
  }, 900);
}

// ── NAV ───────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    // Coming soon for unbuilt sections
    const label = item.querySelector('.nav-icon')?.nextSibling?.textContent?.trim() || '';
    const builtScreens = ['Talk to AURA', 'Dashboard'];
    if (!builtScreens.some(s => label.includes(s))) {
      showComingSoon(label);
    }
  });
});

function showComingSoon(label) {
  const existing = document.getElementById('coming-soon-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'coming-soon-toast';
  t.style.cssText = `
    position:fixed; bottom:32px; left:50%; transform:translateX(-50%);
    background:var(--surface2); border:0.5px solid var(--border2);
    color:var(--text); padding:10px 20px; border-radius:10px;
    font-size:13px; font-weight:500; z-index:9000;
    box-shadow:0 8px 32px rgba(0,0,0,0.4);
    animation: fadeInUp .2s ease;
  `;
  t.textContent = (label || 'This section') + ' is coming soon';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ── LANGUAGE SWITCHER ─────────────────────────────────────────────────────────
document.querySelectorAll('.ls-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ls-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── GOAL CHECKBOXES ───────────────────────────────────────────────────────────
document.querySelectorAll('.goal-row').forEach(row => {
  row.addEventListener('click', () => {
    const check = row.querySelector('.goal-check');
    const text  = row.querySelector('.goal-text');
    const done  = check.classList.toggle('done');
    check.textContent = done ? '✓' : '';
    text?.classList.toggle('done', done);
  });
});
