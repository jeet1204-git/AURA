/**
 * session-adapter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop-in replacement for session-bridge.js in ui.js.
 *
 * ONE-LINE CHANGE IN ui.js:
 *   BEFORE: import { initSession, toggleMic, sendText, getSessionState }
 *             from './session-bridge.js';
 *   AFTER:  import { initSession, toggleMic, sendText, getSessionState }
 *             from './session-adapter.js';
 *
 * WHAT THIS DOES:
 *   1. Before every session start, reads the active Supabase profile and seeds
 *      store.js (selectedLevel, selectedLangPref, selectedSessionMode,
 *      selectedProgramType, selectedScenario) so session.js has the right
 *      blueprint data before it builds the system prompt.
 *   2. Delegates all actual session logic to session.js via window.startSession,
 *      which session.js registers at module init.
 *   3. Exposes the same public API surface ui.js expects from session-bridge.js.
 *   4. After session ends, triggers post-session scoring (P5) inside the
 *      dashboard without navigating away.
 *
 * NOTE: resolveScenarioForLevel() in scoring.js accepts an optional 3rd arg
 * (targetLanguage). If your version only takes 2 args, drop the 3rd arg below.
 */

import {
  setSelectedLevel,
  setSelectedScenario,
  setSelectedLangPref,
  setSelectedSessionMode,
  setSelectedProgramType,
} from '../state/store.js';

import { resolveScenarioForLevel } from '../config/scoring.js';

// ── Callbacks wired by ui.js ──────────────────────────────────────────────────
let _getIdToken         = () => Promise.resolve(null);
let _getUserDisplayName = () => 'there';
let _getActiveProfile   = () => null;

// ── Seed store from the active Supabase profile ───────────────────────────────
function seedStoreFromProfile(profile) {
  const level       = profile?.level          || 'A2';
  const langPref    = profile?.nativeLanguage || profile?.langPref || 'English';
  const mode        = profile?.preferredMode  || 'guided';
  const targetLang  = profile?.targetLanguage || 'German';
  const programType = profile?.goal === 'exam' ? 'exam' : 'general';

  setSelectedLevel(level);
  setSelectedLangPref(langPref);
  setSelectedSessionMode(mode);
  setSelectedProgramType(programType);

  // resolveScenarioForLevel lives in scoring.js and returns the best scenario
  // object for the given level. Passing targetLang lets it filter by language.
  const scenario = resolveScenarioForLevel(level, null, targetLang);
  if (scenario) setSelectedScenario(scenario);

  console.log('[AURA] session-adapter: store seeded from profile', {
    level, langPref, mode, programType,
    targetLang, scenarioId: scenario?.id ?? null,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function initSession(callbacks = {}) {
  if (callbacks.getIdToken)         _getIdToken         = callbacks.getIdToken;
  if (callbacks.getUserDisplayName) _getUserDisplayName = callbacks.getUserDisplayName;
  if (callbacks.getActiveProfile)   _getActiveProfile   = callbacks.getActiveProfile;

  // Start buttons (same targets as session-bridge.js)
  ['liveSessionBtn', 'idleStartBtn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', async () => {
      if (window.sessionActive) return;

      // 1. Seed store from current profile
      seedStoreFromProfile(_getActiveProfile());

      // 2. Delegate to session.js (registered on window at module init)
      if (typeof window.startSession === 'function') {
        await window.startSession();
      }
    });
  });

  // End session
  document.getElementById('endSessionBtn')?.addEventListener('click', async () => {
    if (!window.sessionActive) return;
    if (!confirm('End this session?')) return;
    if (typeof window.endSession === 'function') await window.endSession();
  });

  // Summary / score button
  document.getElementById('summaryBtn')?.addEventListener('click', () => {
    showPostSessionScreen();
  });

  // Post-session: when session.js fires this event, show scoring inside dashboard
  window.addEventListener('aura:session-ended', () => {
    triggerPostSessionScoring();
  });
}

export function toggleMic() {
  // session.js registers window.toggleMic
  if (typeof window.toggleMic === 'function') return window.toggleMic();
  return false;
}

export function sendText(text) {
  // session.js wires window.sendTextMessage to the text-input element
  const inp = document.getElementById('text-input');
  if (inp && typeof window.sendTextMessage === 'function') {
    inp.value = text;
    window.sendTextMessage();
    return;
  }
  // Direct WS fallback
  if (window.ws?.readyState === WebSocket.OPEN) {
    window.ws.send(JSON.stringify({
      clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true },
    }));
  }
}

export function getSessionState() {
  return window.sessionActive ? 'active' : 'idle';
}

// ── P5: Post-session scoring (wired in from evaluation.js) ───────────────────

async function triggerPostSessionScoring() {
  // Small delay so session.js cleanup finishes before we read evidence
  await new Promise(r => setTimeout(r, 250));

  try {
    const { renderScore, renderPostSessionCoaching } = await import('./evaluation.js');

    const evidence = typeof window.collectSessionEvidence === 'function'
      ? window.collectSessionEvidence()
      : null;

    // session.js sets window._lastSessionResult when Claude API scoring returns
    const result = window._lastSessionResult ?? null;

    showPostSessionScreen();

    if (result) {
      renderScore(result, evidence);
    } else if (evidence) {
      // No scored result yet — show the coaching-only view
      renderPostSessionCoaching(null, evidence);
    }
  } catch (err) {
    console.warn('[AURA] post-session scoring non-fatal:', err.message);
  }
}

function showPostSessionScreen() {
  // session.js already has a summary-overlay; also support a score-screen div
  const scoreScreen    = document.getElementById('score-screen');
  const summaryOverlay = document.getElementById('summary-overlay');

  if (scoreScreen) {
    scoreScreen.style.display = 'block';
    scoreScreen.classList.add('active');
  } else if (summaryOverlay) {
    summaryOverlay.classList.add('open');
  }
}
