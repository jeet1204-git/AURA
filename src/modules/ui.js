/**
 * ui.js — AURA Dashboard UI controller
 * Handles auth, theme, cursor, waveform, nav, goals.
 * Voice session is owned by session-bridge.js.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG } from '../config/constants.js';
import { initSession } from './session-bridge.js';

// ── FIREBASE AUTH ─────────────────────────────────────────────────────────────
const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

let currentUser = null;

// Wire buttons immediately — don't wait for auth
initSession({
  getIdToken: () => currentUser ? currentUser.getIdToken() : Promise.resolve(null),
  getUserDisplayName: () => currentUser?.displayName || currentUser?.email?.split('@')[0] || 'there',
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // Auth gate disabled during development
    // window.location.href = '/src/app/screens/auth.html';
    return;
  }
  currentUser = user;
  onUserReady(user);
});

function onUserReady(user) {
  const nameEl   = document.getElementById('sbUserName');
  const subEl    = document.getElementById('sbUserSub');
  const avatarEl = document.getElementById('sbAvatar');
  if (nameEl)   nameEl.textContent   = user.displayName || user.email?.split('@')[0] || 'Learner';
  if (subEl)    subEl.textContent    = user.email || '';
  if (avatarEl) avatarEl.textContent = (user.displayName || user.email || 'A')[0].toUpperCase();
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
  dot.style.left = mx + 'px'; dot.style.top = my + 'px';
});
(function animCursor() {
  rx += (mx - rx) * 0.14; ry += (my - ry) * 0.14;
  ring.style.left = rx + 'px'; ring.style.top = ry + 'px';
  requestAnimationFrame(animCursor);
})();
document.querySelectorAll('button, a, .sug-chip, .nav-item, .mem-item').forEach(el => {
  el.addEventListener('mouseenter', () => ring.classList.add('hover'));
  el.addEventListener('mouseleave', () => ring.classList.remove('hover'));
});
document.addEventListener('mousedown', () => ring.classList.add('click'));
document.addEventListener('mouseup',   () => ring.classList.remove('click'));

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
  });
});

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

// ── ORB CLICK (demo toggle) ───────────────────────────────────────────────────
document.getElementById('auraOrb')?.addEventListener('click', () => {
  document.getElementById('auraOrb').classList.toggle('speaking');
});

// ── COUNT-UP STATS ────────────────────────────────────────────────────────────
function countUp(el, target, duration = 800) {
  if (!el) return;
  let val = 0;
  const step = target / Math.ceil(duration / 16);
  const t = setInterval(() => {
    val = Math.min(val + step, target);
    el.textContent = Math.round(val);
    if (val >= target) clearInterval(t);
  }, 16);
}
setTimeout(() => {
  countUp(document.getElementById('wordsSpoken'), 34);
  countUp(document.getElementById('correctCount'), 8);
  countUp(document.getElementById('errCount'), 2);
}, 400);
