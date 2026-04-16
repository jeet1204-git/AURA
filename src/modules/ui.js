/**
 * ui.js — AURA Dashboard UI controller
 * Handles auth, theme, cursor, waveform, nav, goals.
 * Voice session is owned by session.js (full engine).
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG, WORKER_URL } from '../config/constants.js';
import { loadUserProfile } from './firestore.js';

// ── DOM SHIMS ─────────────────────────────────────────────────────────────────
// session.js was written for the old monolithic HTML and uses different element
// IDs than app-screens.html. We inject hidden alias elements so session.js
// finds what it needs without any changes to that file.
// Rules: shims that purely receive data are hidden; shims that produce output
// are mirrored to the visible counterpart via MutationObserver or events.
(function installShims() {
  function shim(id, tag = 'div') {
    if (document.getElementById(id)) return;
    const el = document.createElement(tag);
    el.id = id;
    el.style.display = 'none';
    document.body.appendChild(el);
  }

  // Screen-toggle shims — session.js calls .style.display on these
  shim('speak-setup');
  shim('speak-session');
  shim('speak-score');
  shim('speaking-interface');

  // Conversation area — session.js appends .msg-block divs here;
  // mirror their text into the visible #messagesWrap
  shim('conversation-area');
  const convArea = document.getElementById('conversation-area');
  const messagesWrap = document.getElementById('messagesWrap');
  if (convArea && messagesWrap) {
    const mo = new MutationObserver(() => {
      const blocks = convArea.querySelectorAll('.msg-block:not([data-mirrored])');
      blocks.forEach(block => {
        block.setAttribute('data-mirrored', '1');
        const who   = block.querySelector('.msg-who');
        const text  = block.querySelector('.msg-text');
        if (!text) return;
        const isUser = who && (who.classList.contains('student') || who.classList.contains('user') || who.textContent.trim().toLowerCase() === 'you');
        const div = document.createElement('div');
        div.className = 'msg ' + (isUser ? 'me' : 'ai');
        div.innerHTML = `<div class="msg-label">${isUser ? 'YOU' : 'AURA'}</div><div class="bubble"></div>`;
        const bubble = div.querySelector('.bubble');
        bubble.textContent = text.textContent;
        // Stream updates
        const textObs = new MutationObserver(() => { bubble.textContent = text.textContent; messagesWrap.scrollTop = messagesWrap.scrollHeight; });
        textObs.observe(text, { childList: true, characterData: true, subtree: true });
        const typing = document.getElementById('typingIndicator');
        typing ? messagesWrap.insertBefore(div, typing) : messagesWrap.appendChild(div);
        messagesWrap.scrollTop = messagesWrap.scrollHeight;
      });
    });
    mo.observe(convArea, { childList: true });
  }

  // Timer — session.js writes to #session-timer; mirror to #sessionTimer
  shim('session-timer', 'span');
  const shimTimer  = document.getElementById('session-timer');
  const realTimer  = document.getElementById('sessionTimer');
  if (shimTimer && realTimer) {
    new MutationObserver(() => { realTimer.textContent = shimTimer.textContent; })
      .observe(shimTimer, { childList: true, characterData: true, subtree: true });
  }

  // Mic button — session.js looks for #mic-btn; alias to #micBtn
  const micBtn = document.getElementById('micBtn');
  if (micBtn && !document.getElementById('mic-btn')) {
    micBtn.id = 'mic-btn micBtn'; // keep both; querySelector('#micBtn') still works
    // Simpler: just create an alias getter on window
    Object.defineProperty(document, '_micBtnAlias', { value: true });
  }
  // Cleanest alias: override getElementById for this one ID
  const _origGetById = document.getElementById.bind(document);
  document.getElementById = function(id) {
    if (id === 'mic-btn') return _origGetById('micBtn') || _origGetById('mic-btn');
    if (id === 'msg-input') return _origGetById('chatInput') || _origGetById('msg-input');
    if (id === 'word-count-num' || id === 'word-count-num-desk') return _origGetById('wordsSpoken') || _origGetById(id);
    if (id === 'sesh-timer') return _origGetById('sessionTimer') || _origGetById('sesh-timer');
    return _origGetById(id);
  };

  // Other shims session.js may reference (safe no-ops if not found)
  shim('scenario-select', 'select');
  shim('silence-modal');
  shim('silence-countdown');
  shim('silence-countdown-text', 'span');
  shim('privacy-modal');
  shim('board-idle');
  shim('sesh-emoji', 'span');
  shim('mode-recommendation');
  shim('input-area');
  shim('add-time-btn', 'button');
  shim('aura-debug');
  shim('listening-pill');
  shim('deepgram-status');
  shim('text-input', 'input');

  // Pre-populate scenario-select with a default A2 entry so
  // resolveScenarioForLevel has something to resolve against
  const sel = document.getElementById('scenario-select');
  if (sel && sel.options.length === 0) {
    const opt = document.createElement('option');
    opt.value = 'daily_conversation';
    opt.text  = '☕ Daily Conversation';
    opt.dataset.level = 'A2';
    opt.dataset.role  = 'Friend';
    opt.dataset.emoji = '☕';
    opt.dataset.desc  = 'A casual daily conversation practice session';
    sel.appendChild(opt);
    sel.value = 'daily_conversation';
  }
})();

// Side-effect import — after shims are installed, so session.js DOM lookups
// on module parse (if any) find the shim elements.
// Note: ES module imports are hoisted, so we use dynamic import to control order.
let _sessionImported = false;
async function ensureSessionImported() {
  if (_sessionImported) return;
  _sessionImported = true;
  await import('./session.js');
}

// ── FIREBASE AUTH ─────────────────────────────────────────────────────────────
const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = '/src/app/screens/auth.html';
    return;
  }
  currentUser = user;
  window.currentUser = user; // store.js proxy reads this

  // Import session.js now that we have a user
  await ensureSessionImported();

  onUserReady(user);
});

// ── ON USER READY ─────────────────────────────────────────────────────────────
async function onUserReady(user) {
  // 1. Fill sidebar with Firebase Auth data immediately
  const nameEl   = document.getElementById('sbUserName');
  const subEl    = document.getElementById('sbUserSub');
  const avatarEl = document.getElementById('sbAvatar');
  const displayName = user.displayName || user.email?.split('@')[0] || 'Learner';
  if (nameEl)   nameEl.textContent   = displayName;
  if (subEl)    subEl.textContent    = user.email || '';
  if (avatarEl) avatarEl.textContent = displayName[0].toUpperCase();

  // 2. Load Firestore profile
  let profile = null;
  try {
    profile = await loadUserProfile(user.uid);
    if (profile) renderProfile(profile);
  } catch (e) {
    console.warn('[AURA] Could not load profile:', e?.message);
  }

  // 3. Seed store.js globals from profile before session starts
  initSessionState(profile);

  // 4. Wire session buttons now that session.js is loaded and state is ready
  wireSessionButtons();

  // 5. Load memory panel
  loadMemoryPanel(user);
}

// ── SEED SESSION STATE ────────────────────────────────────────────────────────
function initSessionState(profile) {
  window.selectedLevel       = profile?.level          || 'A2';
  window.selectedLangPref    = profile?.nativeLanguage || profile?.langPref || 'English';
  window.selectedSessionMode = profile?.preferredMode  || 'guided';
  window.selectedProgramType = 'general';
  window.selectedInputMode   = 'both';

  // Resolve the scenario via session.js if it is already loaded
  if (typeof window.resolveScenarioForLevel === 'function') {
    window.selectedScenario = window.resolveScenarioForLevel(window.selectedLevel, null) || null;
  } else {
    // Provide a default object that matches the shim option above
    window.selectedScenario = {
      id:    'daily_conversation',
      title: 'Daily Conversation',
      level: window.selectedLevel,
      role:  'Friend',
      emoji: '☕',
      desc:  'A casual daily conversation practice session',
    };
  }

  console.log('[AURA][ui] session state seeded', {
    level:    window.selectedLevel,
    langPref: window.selectedLangPref,
    mode:     window.selectedSessionMode,
    scenario: window.selectedScenario?.id || null,
  });
}

// ── WIRE SESSION BUTTONS ──────────────────────────────────────────────────────
function wireSessionButtons() {
  // Start button
  document.getElementById('liveSessionBtn')?.addEventListener('click', async () => {
    if (window.sessionActive) return;
    if (typeof window.startSession === 'function') {
      await window.startSession();
    }
  });

  // End button
  document.getElementById('endSessionBtn')?.addEventListener('click', async () => {
    if (!window.sessionActive) return;
    if (!confirm('End this session? Your progress will be saved.')) return;
    if (typeof window.endSession === 'function') {
      await window.endSession();
    }
  });

  // Mic button — session.js wires toggleMic to #mic-btn (aliased to #micBtn above)
  document.getElementById('micBtn')?.addEventListener('click', () => {
    if (!window.sessionActive) return;
    if (typeof window.toggleMic === 'function') window.toggleMic();
  });

  // Text send button
  document.getElementById('sendBtn')?.addEventListener('click', handleSend);
  document.getElementById('chatInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSend();
  });

  // Suggestion chips
  document.querySelectorAll('.sug-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('chatInput');
      if (input) { input.value = chip.textContent.trim(); input.focus(); }
    });
  });
}

// ── TEXT SEND HANDLER ─────────────────────────────────────────────────────────
let _sending = false;
async function handleSend() {
  if (_sending) return;
  const input = document.getElementById('chatInput');
  const text  = input?.value.trim();
  if (!text) return;

  // If session active, route through session.js WebSocket
  if (window.sessionActive && window.ws?.readyState === WebSocket.OPEN) {
    addMsg('me', text);
    input.value = '';
    window.ws.send(JSON.stringify({
      clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true }
    }));
    return;
  }

  // Otherwise use Anthropic text fallback
  _sending = true;
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) sendBtn.disabled = true;
  addMsg('me', text);
  input.value = '';
  const typing = document.getElementById('typingIndicator');
  const wrap   = document.getElementById('messagesWrap');
  if (typing) { typing.style.display = 'flex'; if (wrap) wrap.scrollTop = wrap.scrollHeight; }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: `You are AURA, a warm AI language tutor. The student is learning ${window.selectedLangPref ? 'German' : 'German'} at level ${window.selectedLevel || 'A2'}. Their native language is ${window.selectedLangPref || 'English'}. Reply in max 3 sentences. Correct grammar errors gently. Ask a follow-up if correct. No bullet points.`,
        messages: [{ role: 'user', content: text }]
      })
    });
    const data = await res.json();
    if (typing) typing.style.display = 'none';
    addMsg('ai', data.content?.[0]?.text || 'Sehr gut! Keep going.');
  } catch {
    if (typing) typing.style.display = 'none';
    addMsg('ai', 'Sehr gut! Your German is coming along well. Try another sentence?');
  }

  _sending = false;
  if (sendBtn) sendBtn.disabled = false;
}

function addMsg(role, text) {
  const wrap = document.getElementById('messagesWrap');
  if (!wrap) return;
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'ai' ? 'ai' : 'me');
  div.innerHTML = `<div class="msg-label">${role === 'ai' ? 'AURA' : 'YOU'}</div><div class="bubble"></div>`;
  div.querySelector('.bubble').textContent = text;
  const typing = document.getElementById('typingIndicator');
  typing ? wrap.insertBefore(div, typing) : wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

// ── RENDER PROFILE (streak, XP, level) ───────────────────────────────────────
function renderProfile(profile) {
  const streakEl = document.querySelector('.streak-count');
  if (streakEl && profile.streak != null) streakEl.textContent = profile.streak;

  const xpVal  = document.querySelector('.xp-val');
  const xpFill = document.querySelector('.xp-fill');
  if (profile.xp != null) {
    const xp    = profile.xp;
    const xpMax = 1000;
    const pct   = Math.min(100, Math.round((xp / xpMax) * 100));
    if (xpVal)  xpVal.textContent = `${xp} / ${xpMax}`;
    if (xpFill) xpFill.style.width = pct + '%';
  }

  const levelEl = document.querySelector('.scl-level');
  if (levelEl && profile.level) levelEl.textContent = profile.level + ' · ' + (profile.targetLanguage || 'German');

  const subEl = document.getElementById('sbUserSub');
  if (subEl && profile.level) subEl.textContent = profile.level + ' · ' + (profile.targetLanguage || 'German');

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
  (memory.recurringMistakes || []).slice(0, 2).forEach(m => items.push({ tag: 'weak',   text: m, note: 'Recurring mistake' }));
  (memory.weakTopics        || []).slice(0, 2).forEach(t => items.push({ tag: 'weak',   text: t, note: 'Needs more practice' }));
  (memory.masteredTopics    || []).slice(0, 2).forEach(t => items.push({ tag: 'strong', text: t, note: 'Mastered' }));
  (memory.breakthroughMoments || []).slice(0, 1).forEach(b => items.push({ tag: 'strong', text: b, note: 'Breakthrough' }));
  if (memory.currentFocus) items.push({ tag: 'goal', text: memory.currentFocus, note: 'Current focus' });
  (memory.leftUnfinished || []).slice(0, 1).forEach(u => items.push({ tag: 'goal', text: u, note: 'Pick up from last session' }));
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
