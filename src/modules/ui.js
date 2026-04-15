/**
 * ui.js — AURA Dashboard UI controller
 *
 * Owns everything the user sees and touches in app-screens.html:
 *   - Theme
 *   - Custom cursor
 *   - Session timer
 *   - Waveform
 *   - Orb state
 *   - Chat (text fallback + live session routing)
 *   - Nav, goals, corrections
 *   - Auth gate (Firebase → redirect to auth.html if signed out)
 *   - Wires to session.js for the real Gemini Live session
 *
 * Does NOT own: WebSocket, mic, audio playback — those live in session.js.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG } from '../config/constants.js';
import { startSession, endSession, toggleMic, sendText, getSessionState } from './session.js';

// ── FIREBASE AUTH GATE ────────────────────────────────────────────────────────
const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

let currentUser = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // Not signed in — send to auth page
    window.location.href = '/src/app/screens/auth.html';
    return;
  }
  currentUser = user;
  onUserReady(user);
});

function onUserReady(user) {
  // Populate sidebar user block
  const nameEl = document.getElementById('sbUserName');
  const subEl  = document.getElementById('sbUserSub');
  const avatarEl = document.getElementById('sbAvatar');

  if (nameEl) nameEl.textContent = user.displayName || user.email?.split('@')[0] || 'Learner';
  if (subEl)  subEl.textContent  = user.email || '';
  if (avatarEl) {
    avatarEl.textContent = (user.displayName || user.email || 'A')[0].toUpperCase();
  }
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
function bindCursorHover() {
  document.querySelectorAll('button, a, .sug-chip, .nav-item, .mem-item').forEach(el => {
    el.addEventListener('mouseenter', () => ring.classList.add('hover'));
    el.addEventListener('mouseleave', () => ring.classList.remove('hover'));
  });
}
document.addEventListener('mousedown', () => ring.classList.add('click'));
document.addEventListener('mouseup',   () => ring.classList.remove('click'));
bindCursorHover();

// ── SESSION TIMER ─────────────────────────────────────────────────────────────
let timerSeconds = 0;
let timerInterval = null;
const timerEl = document.getElementById('sessionTimer');

function startTimer() {
  timerSeconds = 0;
  timerInterval = setInterval(() => {
    timerSeconds++;
    const h = String(Math.floor(timerSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((timerSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(timerSeconds % 60).padStart(2, '0');
    if (timerEl) timerEl.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ── WAVEFORM ──────────────────────────────────────────────────────────────────
const waveform = document.getElementById('waveform');
const BARS = 38;
const wfBars = [];

if (waveform) {
  for (let i = 0; i < BARS; i++) {
    const b = document.createElement('div');
    b.className = 'wf-bar' + (i > 14 && i < 24 ? ' active' : '');
    b.style.setProperty('--d', `${(0.8 + Math.random() * 0.8).toFixed(2)}s`);
    b.style.setProperty('--h', `${(6 + Math.random() * 24).toFixed(0)}px`);
    b.style.animationDelay = `${(Math.random() * 0.5).toFixed(2)}s`;
    waveform.appendChild(b);
    wfBars.push(b);
  }
  setInterval(() => {
    wfBars.forEach(b => {
      b.classList.toggle('active', Math.random() > 0.45);
      b.style.setProperty('--h', `${(3 + Math.random() * 26).toFixed(0)}px`);
    });
  }, 900);
}

// ── ORB STATE ─────────────────────────────────────────────────────────────────
const auraOrb = document.getElementById('auraOrb');

function setOrbSpeaking(on) {
  auraOrb?.classList.toggle('speaking', on);
}

// ── SESSION STATUS LABEL ──────────────────────────────────────────────────────
const statusEl = document.querySelector('.session-status');

function setStatus(label, color) {
  if (!statusEl) return;
  const dot = statusEl.querySelector('.status-dot');
  if (dot) dot.style.background = color || 'var(--green)';
  // Replace text node only
  const nodes = [...statusEl.childNodes];
  const textNode = nodes.find(n => n.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = ' ' + label;
  else statusEl.append(' ' + label);
}

// ── CHAT ──────────────────────────────────────────────────────────────────────
const messagesWrap  = document.getElementById('messagesWrap');
const typingEl      = document.getElementById('typingIndicator');
const chatInput     = document.getElementById('chatInput');
const sendBtn       = document.getElementById('sendBtn');

function scrollBottom() {
  if (messagesWrap) messagesWrap.scrollTop = messagesWrap.scrollHeight;
}

function addMsg(role, text) {
  if (!messagesWrap) return;
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'ai' ? 'ai' : 'me');
  div.innerHTML = `<div class="msg-label">${role === 'ai' ? 'AURA' : 'YOU'}</div><div class="bubble">${text}</div>`;
  if (typingEl) {
    messagesWrap.insertBefore(div, typingEl);
  } else {
    messagesWrap.appendChild(div);
  }
  scrollBottom();
  return div;
}

function showTyping(on) {
  if (typingEl) typingEl.style.display = on ? 'flex' : 'none';
  if (on) scrollBottom();
}

// Text send — routes through live session if active, else REST fallback
let sending = false;

async function handleSend() {
  if (sending) return;
  const text = chatInput?.value.trim();
  if (!text) return;

  const state = getSessionState?.();
  if (state === 'active') {
    // Route through live Gemini session
    addMsg('me', text);
    chatInput.value = '';
    sendText(text);
    return;
  }

  // Fallback: REST API
  sending = true;
  if (sendBtn) sendBtn.disabled = true;
  addMsg('me', text);
  chatInput.value = '';
  showTyping(true);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: `You are AURA, a warm AI language tutor. The student is learning German at B1 level.
Their native language is Gujarati; they also speak English.
Reply in max 3 sentences. Respond in English with German examples.
If they make a grammar error, gently correct it once.
If correct, praise them and ask a follow-up question.
Occasionally add a short tip in Gujarati (italicized).
No bullet points. Be warm and conversational.`,
        messages: [{ role: 'user', content: text }]
      })
    });
    const data = await res.json();
    showTyping(false);
    addMsg('ai', data.content?.[0]?.text || 'Sehr gut! Keep going.');
  } catch {
    showTyping(false);
    addMsg('ai', 'Sehr gut! Your German is coming along well. Want to try another sentence?');
  }

  sending = false;
  if (sendBtn) sendBtn.disabled = false;
}

sendBtn?.addEventListener('click', handleSend);
chatInput?.addEventListener('keydown', e => { if (e.key === 'Enter') handleSend(); });

// ── SUGGESTION CHIPS ──────────────────────────────────────────────────────────
document.querySelectorAll('.sug-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (chatInput) {
      chatInput.value = chip.textContent.trim();
      chatInput.focus();
    }
  });
});

// ── LIVE SESSION BUTTON ───────────────────────────────────────────────────────
const liveBtn = document.getElementById('liveSessionBtn');

liveBtn?.addEventListener('click', async () => {
  if (!currentUser) {
    addMsg('ai', 'Please sign in to start a live voice session.');
    return;
  }

  const state = getSessionState?.();
  if (state === 'active') return;

  liveBtn.disabled = true;
  setStatus('Connecting…', 'var(--amber)');
  addMsg('ai', '✨ Starting live voice session — one moment…');

  try {
    const idToken = await currentUser.getIdToken();
    await startSession({ idToken });
  } catch (err) {
    addMsg('ai', `⚠️ Couldn't connect: ${err.message}`);
    setStatus('Disconnected', 'var(--red)');
    liveBtn.disabled = false;
  }
});

// ── SESSION EVENTS (fired by session.js) ─────────────────────────────────────
document.addEventListener('aura:connected', () => {
  setStatus('Live · Voice', 'var(--green)');
  setOrbSpeaking(true);
  startTimer();
  addMsg('ai', "Hey! I'm connected. Say something in German whenever you're ready 🎙️");
  if (liveBtn) liveBtn.disabled = false;
});

document.addEventListener('aura:speaking', () => setOrbSpeaking(true));
document.addEventListener('aura:silent',   () => setOrbSpeaking(false));

document.addEventListener('aura:transcript', e => {
  addMsg('ai', e.detail.text);
});

document.addEventListener('aura:mutechange', e => {
  const micIcon = document.querySelector('#micBtn .vc-icon');
  if (micIcon) micIcon.textContent = e.detail.muted ? '🔇' : '🎙️';
  document.getElementById('micBtn')?.classList.toggle('mic-active', !e.detail.muted);
});

document.addEventListener('aura:error', e => {
  addMsg('ai', `⚠️ ${e.detail.error}`);
  setStatus('Error', 'var(--red)');
  if (liveBtn) liveBtn.disabled = false;
});

document.addEventListener('aura:ended', () => {
  setStatus('Session ended', 'var(--muted)');
  setOrbSpeaking(false);
  stopTimer();
  if (liveBtn) liveBtn.disabled = false;
});

// ── MIC BUTTON ────────────────────────────────────────────────────────────────
const micBtn = document.getElementById('micBtn');
micBtn?.addEventListener('click', () => {
  const state = getSessionState?.();
  if (state !== 'active') return;
  toggleMic();
});

// ── END SESSION BUTTON ────────────────────────────────────────────────────────
const endBtn = document.getElementById('endSessionBtn');
endBtn?.addEventListener('click', async () => {
  const state = getSessionState?.();
  if (state !== 'active') return;
  if (!confirm('End this session? Your progress will be saved.')) return;

  endBtn.disabled = true;
  setStatus('Ending…', 'var(--amber)');
  addMsg('ai', 'Wrapping up your session…');

  await endSession();

  stopTimer();
  addMsg('ai', 'Great work today! Your session has been saved. See you next time 👋');
  endBtn.disabled = false;
});

// ── NAV ITEMS ─────────────────────────────────────────────────────────────────
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

// ── COUNT-UP ANIMATION (stats) ────────────────────────────────────────────────
function countUp(el, target, duration = 800) {
  if (!el) return;
  let val = 0;
  const step = target / Math.ceil(duration / 16);
  const timer = setInterval(() => {
    val = Math.min(val + step, target);
    el.textContent = Math.round(val);
    if (val >= target) clearInterval(timer);
  }, 16);
}

setTimeout(() => {
  countUp(document.getElementById('wordsSpoken'), 34);
  countUp(document.getElementById('correctCount'), 8);
  countUp(document.getElementById('errCount'), 2);
}, 400);

// ── ORB CLICK (manual toggle for demo) ───────────────────────────────────────
auraOrb?.addEventListener('click', () => {
  auraOrb.classList.toggle('speaking');
});
