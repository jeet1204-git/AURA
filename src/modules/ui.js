/**
 * ui.js — AURA Dashboard UI controller
 * Handles auth, theme, cursor, waveform, nav, goals, profile switching.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG, WORKER_URL } from '../config/constants.js';
import {
  loadUserProfile, loadProfiles, createProfile, updateProfile,
  deleteProfile, setActiveProfile, migrateUserToProfiles, getLangFlag
} from './firestore.js';
import { initSession } from './session-bridge.js';

// ── FIREBASE AUTH ─────────────────────────────────────────────────────────────
const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

let currentUser    = null;
let allProfiles    = [];
let activeProfile  = null;

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
  const displayName = user.displayName || user.email?.split('@')[0] || 'Learner';
  const nameEl   = document.getElementById('sbUserName');
  const avatarEl = document.getElementById('sbAvatar');
  if (nameEl)   nameEl.textContent   = displayName;
  if (avatarEl) avatarEl.textContent = displayName[0].toUpperCase();

  // Load root user doc
  let userDoc = null;
  try { userDoc = await loadUserProfile(user.uid); } catch (e) {}

  // Migrate flat profile data into profiles subcollection if needed
  try {
    allProfiles = await migrateUserToProfiles(user.uid, userDoc || {});
  } catch (e) {
    console.warn('[AURA] profile migration failed:', e?.message);
    allProfiles = [];
  }

  // Determine active profile
  const activeId = userDoc?.activeProfileId || allProfiles[0]?.id || null;
  activeProfile  = allProfiles.find(p => p.id === activeId) || allProfiles[0] || null;

  // Render sidebar user card and profile switcher
  renderActiveProfile(activeProfile, userDoc);
  renderProfileSwitcher(allProfiles, activeProfile, userDoc);

  // Load memory panel
  loadMemoryPanel(user, activeProfile?.id || null);
}

// ── RENDER ACTIVE PROFILE IN SIDEBAR ─────────────────────────────────────────
function renderActiveProfile(profile, userDoc) {
  const subEl   = document.getElementById('sbUserSub');
  const levelEl = document.querySelector('.scl-level');
  const sclName = document.querySelector('.scl-name');
  const sclFlag = document.querySelector('.scl-flag');

  if (profile) {
    if (subEl)   subEl.textContent   = `${profile.level} · ${profile.targetLanguage}`;
    if (levelEl) levelEl.textContent = `${profile.level} · ${profile.targetLanguage}`;
    if (sclName) sclName.textContent = `${profile.targetLanguage} ${profile.level}`;
    if (sclFlag) sclFlag.textContent = profile.flag || getLangFlag(profile.targetLanguage);
  } else {
    // No profile yet
    if (subEl) subEl.textContent = 'No profile set';
  }

  // XP / streak from root user doc
  if (userDoc) {
    const streakEl = document.querySelector('.streak-count');
    if (streakEl && userDoc.streak != null) streakEl.textContent = userDoc.streak;
    const xpVal  = document.querySelector('.xp-val');
    const xpFill = document.querySelector('.xp-fill');
    if (userDoc.xp != null) {
      const pct = Math.min(100, Math.round((userDoc.xp / 1000) * 100));
      if (xpVal)  xpVal.textContent    = `${userDoc.xp} / 1000`;
      if (xpFill) xpFill.style.width   = pct + '%';
    }
    renderWeekDots(userDoc.streak || 0);
  }
}

// ── PROFILE SWITCHER DROPDOWN ─────────────────────────────────────────────────
function renderProfileSwitcher(profiles, active, userDoc) {
  const sbUser = document.querySelector('.sb-user');
  if (!sbUser) return;

  const isPaid = userDoc?.isPaid || false;
  const canAdd = isPaid || profiles.length === 0;

  // Make user card clickable
  sbUser.style.cursor = 'pointer';
  sbUser.setAttribute('title', 'Manage learning profiles');

  // Add chevron indicator
  let chevron = sbUser.querySelector('.sb-chevron');
  if (!chevron) {
    chevron = document.createElement('span');
    chevron.className = 'sb-chevron';
    chevron.style.cssText = 'margin-left:auto;font-size:10px;color:var(--muted);transition:transform .2s;';
    chevron.textContent = '⌄';
    sbUser.appendChild(chevron);
  }

  // Remove old listener by cloning
  const newCard = sbUser.cloneNode(true);
  sbUser.parentNode.replaceChild(newCard, sbUser);

  newCard.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleProfileMenu(profiles, active, isPaid, canAdd, newCard);
  });
}

let _menuOpen = false;

function toggleProfileMenu(profiles, active, isPaid, canAdd, anchor) {
  // Close if already open
  const existing = document.getElementById('profile-menu');
  if (existing) { existing.remove(); _menuOpen = false; return; }
  _menuOpen = true;

  const menu = document.createElement('div');
  menu.id = 'profile-menu';
  menu.style.cssText = `
    position:absolute; left:8px; right:8px; top:${anchor.offsetTop + anchor.offsetHeight + 6}px;
    background:var(--surface2); border:0.5px solid var(--border2);
    border-radius:12px; z-index:500; overflow:hidden;
    box-shadow:0 8px 32px rgba(0,0,0,.5);
  `;

  // Profile list
  profiles.forEach(p => {
    const item = document.createElement('button');
    item.style.cssText = `
      width:100%; padding:10px 14px; background:transparent; border:none;
      display:flex; align-items:center; gap:10px; text-align:left;
      color:var(--text); font-size:12.5px; font-family:'Inter',sans-serif;
      border-bottom:0.5px solid var(--border);
      ${p.id === active?.id ? 'background:rgba(157,127,255,.1);' : ''}
    `;
    item.innerHTML = `
      <span style="font-size:18px">${p.flag || getLangFlag(p.targetLanguage)}</span>
      <span style="flex:1">
        <span style="display:block;font-weight:500">${p.targetLanguage} ${p.level}</span>
        <span style="font-size:10px;color:var(--muted)">${p.goal || 'Practice'}</span>
      </span>
      ${p.id === active?.id ? '<span style="color:var(--purple);font-size:11px">Active</span>' : ''}
      ${profiles.length > 1 ? `<span class="del-profile" data-id="${p.id}" style="color:var(--muted);font-size:11px;padding:2px 6px;border-radius:6px" title="Remove">✕</span>` : ''}
    `;

    // Switch profile on click
    item.addEventListener('click', async (e) => {
      if (e.target.classList.contains('del-profile')) {
        e.stopPropagation();
        await handleDeleteProfile(e.target.dataset.id, profiles, active);
        return;
      }
      if (p.id !== active?.id) await handleSwitchProfile(p);
      menu.remove(); _menuOpen = false;
    });
    menu.appendChild(item);
  });

  // Add profile button
  const addBtn = document.createElement('button');
  addBtn.style.cssText = `
    width:100%; padding:10px 14px; background:transparent; border:none;
    display:flex; align-items:center; gap:10px; text-align:left;
    color:${canAdd ? 'var(--purple)' : 'var(--muted)'};
    font-size:12.5px; font-family:'Inter',sans-serif;
    border-bottom:0.5px solid var(--border);
  `;
  addBtn.innerHTML = canAdd
    ? '<span style="font-size:16px">＋</span><span>Add learning profile</span>'
    : '<span style="font-size:16px">＋</span><span>Upgrade to Pro for multiple profiles</span>';

  addBtn.addEventListener('click', () => {
    menu.remove(); _menuOpen = false;
    if (canAdd) showAddProfileModal(profiles);
  });
  menu.appendChild(addBtn);

  // Sign out
  const signOutBtn = document.createElement('button');
  signOutBtn.style.cssText = `
    width:100%; padding:10px 14px; background:transparent; border:none;
    display:flex; align-items:center; gap:10px; text-align:left;
    color:var(--red); font-size:12.5px; font-family:'Inter',sans-serif;
  `;
  signOutBtn.innerHTML = '<span style="font-size:14px">↩</span><span>Sign out</span>';
  signOutBtn.addEventListener('click', async () => {
    menu.remove(); _menuOpen = false;
    await signOut(auth);
    window.location.href = '/src/app/screens/auth.html';
  });
  menu.appendChild(signOutBtn);

  // Insert into sidebar
  const sidebar = document.querySelector('.sidebar');
  sidebar.style.position = 'relative';
  sidebar.appendChild(menu);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', () => { menu.remove(); _menuOpen = false; }, { once: true });
  }, 0);
}

async function handleSwitchProfile(profile) {
  // End session if active
  if (window.sessionActive) {
    const ok = confirm('A session is active. End it and switch profiles?');
    if (!ok) return;
    if (typeof window.endSession === 'function') await window.endSession().catch(() => {});
  }
  activeProfile = profile;
  await setActiveProfile(currentUser.uid, profile.id);
  renderActiveProfile(profile, null);
  loadMemoryPanel(currentUser, profile.id);

  // Show toast
  showToast(`Switched to ${profile.targetLanguage} ${profile.level}`);
}

async function handleDeleteProfile(profileId, profiles, active) {
  if (profiles.length <= 1) { showToast('Cannot remove your only profile.'); return; }
  if (profileId === active?.id) { showToast('Switch to another profile first.'); return; }
  if (!confirm('Remove this profile? Its session history stays saved.')) return;
  await deleteProfile(currentUser.uid, profileId);
  allProfiles = allProfiles.filter(p => p.id !== profileId);
  renderProfileSwitcher(allProfiles, activeProfile, null);
  showToast('Profile removed.');
}

// ── ADD PROFILE MODAL ─────────────────────────────────────────────────────────
function showAddProfileModal(existingProfiles) {
  const overlay = document.createElement('div');
  overlay.id = 'add-profile-overlay';
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:1000;
    background:rgba(0,0,0,.7); backdrop-filter:blur(6px);
    display:flex; align-items:center; justify-content:center; padding:24px;
  `;

  overlay.innerHTML = `
    <div style="background:var(--surface);border:0.5px solid var(--border2);border-radius:20px;
      padding:32px;width:100%;max-width:480px;box-shadow:0 24px 80px rgba(0,0,0,.5);">
      <h2 style="font-size:18px;font-weight:600;margin-bottom:6px;letter-spacing:-.3px;">New learning profile</h2>
      <p style="font-size:13px;color:var(--muted);margin-bottom:24px;line-height:1.5;">
        Each profile has its own sessions, progress, and AURA memory.
      </p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px;">Target language</label>
          <select id="np-lang" style="width:100%;padding:10px 12px;border-radius:10px;
            background:rgba(255,255,255,.04);border:0.5px solid var(--border2);
            color:var(--text);font-family:'Inter',sans-serif;font-size:13px;outline:none;">
            <option>German</option><option>French</option><option>Japanese</option>
            <option>Spanish</option><option>Italian</option><option>Mandarin</option>
            <option>Korean</option><option>Portuguese</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px;">Current level</label>
          <select id="np-level" style="width:100%;padding:10px 12px;border-radius:10px;
            background:rgba(255,255,255,.04);border:0.5px solid var(--border2);
            color:var(--text);font-family:'Inter',sans-serif;font-size:13px;outline:none;">
            <option>A1</option><option>A2</option><option selected>B1</option>
            <option>B2</option><option>C1</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px;">Native language</label>
          <input id="np-native" type="text" placeholder="e.g. Gujarati" value="${activeProfile?.nativeLanguage || ''}"
            style="width:100%;padding:10px 12px;border-radius:10px;
            background:rgba(255,255,255,.04);border:0.5px solid var(--border2);
            color:var(--text);font-family:'Inter',sans-serif;font-size:13px;outline:none;"/>
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px;">Mode</label>
          <select id="np-mode" style="width:100%;padding:10px 12px;border-radius:10px;
            background:rgba(255,255,255,.04);border:0.5px solid var(--border2);
            color:var(--text);font-family:'Inter',sans-serif;font-size:13px;outline:none;">
            <option value="guided">Guided</option>
            <option value="immersion">Immersion</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:20px;">
        <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px;">Goal</label>
        <select id="np-goal" style="width:100%;padding:10px 12px;border-radius:10px;
          background:rgba(255,255,255,.04);border:0.5px solid var(--border2);
          color:var(--text);font-family:'Inter',sans-serif;font-size:13px;outline:none;">
          <option>Daily conversation</option>
          <option>Exam preparation</option>
          <option>Grammar accuracy</option>
          <option>Pronunciation</option>
          <option>Job interviews</option>
        </select>
      </div>

      <div style="display:flex;gap:10px;">
        <button id="np-cancel" style="flex:1;padding:12px;border-radius:12px;background:transparent;
          border:0.5px solid var(--border2);color:var(--muted2);font-family:'Inter',sans-serif;font-size:13px;">
          Cancel
        </button>
        <button id="np-save" style="flex:2;padding:12px;border-radius:12px;
          background:linear-gradient(135deg,#7c5cfc,#4b8ef0);border:none;
          color:#fff;font-family:'Inter',sans-serif;font-size:13px;font-weight:500;">
          Create profile
        </button>
      </div>
      <div id="np-error" style="margin-top:10px;font-size:12px;color:var(--red);min-height:16px;"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#np-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#np-save').addEventListener('click', async () => {
    const lang   = overlay.querySelector('#np-lang').value;
    const level  = overlay.querySelector('#np-level').value;
    const native = overlay.querySelector('#np-native').value.trim() || 'English';
    const mode   = overlay.querySelector('#np-mode').value;
    const goal   = overlay.querySelector('#np-goal').value;
    const errEl  = overlay.querySelector('#np-error');
    const saveBtn = overlay.querySelector('#np-save');

    saveBtn.disabled    = true;
    saveBtn.textContent = 'Creating…';
    errEl.textContent   = '';

    const newProfile = await createProfile(currentUser.uid, {
      targetLanguage: lang, level, nativeLanguage: native,
      langPref: native, goal, preferredMode: mode,
    });

    if (newProfile) {
      overlay.remove();
      allProfiles.push(newProfile);
      await handleSwitchProfile(newProfile);
      renderProfileSwitcher(allProfiles, newProfile, null);
      showToast(`Profile created: ${lang} ${level}`);
    } else {
      errEl.textContent   = 'Could not create profile. Please try again.';
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Create profile';
    }
  });
}

// ── LOGOUT (now handled inside profile menu, but keep button wiring) ──────────
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = '/src/app/screens/auth.html';
});

// ── RENDER PROFILE helper ─────────────────────────────────────────────────────
function renderProfile(profile) {
  const streakEl = document.querySelector('.streak-count');
  if (streakEl && profile.streak != null) streakEl.textContent = profile.streak;
  const xpVal  = document.querySelector('.xp-val');
  const xpFill = document.querySelector('.xp-fill');
  if (profile.xp != null) {
    const pct = Math.min(100, Math.round((profile.xp / 1000) * 100));
    if (xpVal)  xpVal.textContent  = `${profile.xp} / 1000`;
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
async function loadMemoryPanel(user, profileId) {
  const memoryCards = document.querySelector('.memory-cards');
  if (!memoryCards) return;
  try {
    const idToken = await user.getIdToken();
    const url = profileId
      ? `${WORKER_URL}/memory?userId=${user.uid}&profileId=${profileId}`
      : `${WORKER_URL}/memory?userId=${user.uid}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
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
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg) {
  const existing = document.getElementById('aura-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'aura-toast';
  t.style.cssText = `
    position:fixed;bottom:32px;left:50%;transform:translateX(-50%);
    background:var(--surface2);border:0.5px solid var(--border2);
    color:var(--text);padding:10px 20px;border-radius:10px;
    font-size:13px;font-weight:500;z-index:9000;
    box-shadow:0 8px 32px rgba(0,0,0,.4);
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
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
document.querySelectorAll('button, a, .sug-chip, .nav-item, .mem-item, .sb-user').forEach(el => {
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
    if (!builtScreens.some(s => label.includes(s))) showToast(label + ' is coming soon');
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
