/**
 * ui.js — AURA Dashboard UI controller
 * Handles auth, theme, cursor, waveform, nav, goals.
 * Voice session is owned by session-bridge.js.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG, WORKER_URL } from '../config/constants.js';
import { loadUserProfile } from './firestore.js';
import { initSession } from './session-bridge.js';

// ── FIREBASE AUTH ─────────────────────────────────────────────────────────────
const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

let currentUser = null;

// Wire session buttons immediately — auth state fills in the token later
initSession({
  getIdToken:         () => currentUser ? currentUser.getIdToken() : Promise.resolve(null),
  getUserDisplayName: () => currentUser?.displayName || currentUser?.email?.split('@')[0] || 'there',
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = '/src/app/screens/auth.html';
    return;
  }
  currentUser = user;
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

  // 3. Load memory panel from Worker
  loadMemoryPanel(user);
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

  // Sub-label under name
  const subEl = document.getElementById('sbUserSub');
  if (subEl && profile.level) subEl.textContent = profile.level + ' · ' + (profile.targetLanguage || 'German');

  // Week dots
  renderWeekDots(profile.streak || 0);
}

function renderWeekDots(streak) {
  const dots = document.querySelectorAll('.wd');
  if (!dots.length) return;
  const today = new Date().getDay();
  const order = [1, 2, 3, 4, 5, 6, 0];
  dots.forEach((dot, i) => {
    const daysAgo = (today - order[i] + 7) % 7;
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

  (memory.recurringMistakes || []).slice(0, 2).forEach(m => {
    items.push({ tag: 'weak', text: m, note: 'Recurring mistake' });
  });
  (memory.weakTopics || []).slice(0, 2).forEach(t => {
    items.push({ tag: 'weak', text: t, note: 'Needs more practice' });
  });
  (memory.masteredTopics || []).slice(0, 2).forEach(t => {
    items.push({ tag: 'strong', text: t, note: 'Mastered' });
  });
  (memory.breakthroughMoments || []).slice(0, 1).forEach(b => {
    items.push({ tag: 'strong', text: b, note: 'Breakthrough' });
  });
  if (memory.currentFocus) {
    items.push({ tag: 'goal', text: memory.currentFocus, note: memory.lastSessionSummary ? 'Current focus' : '' });
  }
  (memory.leftUnfinished || []).slice(0, 1).forEach(u => {
    items.push({ tag: 'goal', text: u, note: 'Pick up from last session' });
  });

  if (!items.length) return;

  container.innerHTML = items.map(item => `
    <div class="mem-item">
      <div class="mem-tag ${item.tag}">${item.tag.charAt(0).toUpperCase() + item.tag.slice(1)}</div>
      <div class="mem-body">
        <div class="mem-text">${escHtml(item.text)}</div>
        ${item.note ? `<div class="mem-note">${escHtml(item.note)}</div>` : ''}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.mem-item').forEach(el => {
    el.addEventListener('mouseenter', () => ring?.classList.add('hover'));
    el.addEventListener('mouseleave', () => ring?.classList.remove('hover'));
  });

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
    const label = item.querySelector('.nav-icon')?.nextSibling?.textContent?.trim() || '';
    const builtScreens = ['Talk to AURA', 'Dashboard', 'Live Session'];
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

// ── SUGGESTION CHIPS ──────────────────────────────────────────────────────────
document.querySelectorAll('.sug-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const input = document.getElementById('chatInput');
    if (input) { input.value = chip.textContent.trim(); input.focus(); }
  });
});

// ── LOGOUT ───────────────────────────────────────────────────────────────────
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  try {
    await signOut(auth);
    window.location.href = '/src/app/screens/auth.html';
  } catch (e) {
    console.warn('[AURA] Sign out failed:', e?.message);
  }
});

// ── ORB CLICK ─────────────────────────────────────────────────────────────────
document.getElementById('auraOrb')?.addEventListener('click', () => {
  document.getElementById('auraOrb').classList.toggle('speaking');
});

// ── SESSION STATS ─────────────────────────────────────────────────────────────
window.addEventListener('aura:stats', (e) => {
  const { wordsSpoken, correctCount, errCount } = e.detail || {};
  const ws = document.getElementById('wordsSpoken');
  const cc = document.getElementById('correctCount');
  const ec = document.getElementById('errCount');
  if (ws && wordsSpoken != null) ws.textContent = wordsSpoken;
  if (cc && correctCount != null) cc.textContent = correctCount;
  if (ec && errCount    != null) ec.textContent = errCount;
});

// ── FADE ANIMATION ────────────────────────────────────────────────────────────
const fadeStyle = document.createElement('style');
fadeStyle.textContent = `
  @keyframes fadeInUp {
    from { opacity:0; transform:translate(-50%, 8px); }
    to   { opacity:1; transform:translate(-50%, 0);   }
  }
`;
document.head.appendChild(fadeStyle);
