/**
 * firestore.js — AURA Firestore layer
 * Clean schema. Every read/write in one place.
 * Collections: users, users/{uid}/sessions, users/{uid}/memory, analytics_events
 */

import {
  getFirestore,
  collection, doc,
  getDoc, getDocs, setDoc, updateDoc, addDoc,
  query, orderBy, limit,
  serverTimestamp, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { fbApp } from './auth.js';

export const db = getFirestore(fbApp);

// ─────────────────────────────────────────────────────────────────────────────
// USER PROFILE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load full user profile. Returns null if doc doesn't exist yet.
 */
export async function loadUserProfile(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.warn('[AURA] loadUserProfile failed:', e?.message);
    return null;
  }
}

/**
 * Create a brand-new user profile on first sign-in.
 * Only called if loadUserProfile() returns null.
 */
export async function createUserProfile(uid, { name, email }) {
  if (!uid) return;
  const today = todayString();
  const profileDoc = {
    name:          name || '',
    email:         email || '',
    createdAt:     serverTimestamp(),
    lastActiveAt:  serverTimestamp(),

    // Learning config — filled properly by onboarding
    targetLanguage: 'German',
    nativeLanguage: 'English',
    langPref:       'English',
    level:          null,          // null until onboarding complete
    preferredMode:  'guided',
    goal:           '',

    // Gamification
    xp:                         0,
    streak:                     0,
    lastSessionDate:            null,
    totalSessions:              0,
    totalMinutes:               0,

    // Access control
    isPaid:                     false,
    freeSessionsUsedThisMonth:  0,
    freeSessionsMonthKey:       monthKey(),

    // Onboarding
    onboardingComplete: false,
  };
  try {
    await setDoc(doc(db, 'users', uid), profileDoc);
    console.log('[AURA] createUserProfile ok', uid);
    return profileDoc;
  } catch (e) {
    console.warn('[AURA] createUserProfile failed:', e?.message);
  }
}

/**
 * Save onboarding answers. Marks onboarding complete.
 * Called once when user submits the onboarding form.
 */
export async function saveOnboarding(uid, { nativeLanguage, langPref, level, preferredMode, goal }) {
  if (!uid) return;
  try {
    await updateDoc(doc(db, 'users', uid), {
      nativeLanguage:     nativeLanguage || 'English',
      langPref:           langPref || nativeLanguage || 'English',
      level:              level || 'A2',
      preferredMode:      preferredMode || 'guided',
      goal:               goal || '',
      onboardingComplete: true,
      lastActiveAt:       serverTimestamp(),
    });
    console.log('[AURA] saveOnboarding ok');
  } catch (e) {
    console.warn('[AURA] saveOnboarding failed:', e?.message);
    throw e; // re-throw so UI can show error
  }
}

/**
 * Touch lastActiveAt on every dashboard load.
 */
export async function touchLastActive(uid) {
  if (!uid) return;
  try {
    await updateDoc(doc(db, 'users', uid), { lastActiveAt: serverTimestamp() });
  } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save a completed session and update user stats.
 * Call this when a session ends.
 *
 * @param {string} uid
 * @param {object} session
 *   - blueprint: the active blueprint object
 *   - durationSeconds: number
 *   - wordCount: number
 *   - turnCount: number
 *   - scores: { overall, fluency, grammar, vocabulary, taskCompletion }
 *   - corrections: [{ wrong, right, note }]
 */
export async function saveSession(uid, session) {
  if (!uid || !session) return;

  const {
    blueprint,
    durationSeconds = 0,
    wordCount       = 0,
    turnCount       = 0,
    scores          = null,
    corrections     = [],
  } = session;

  const weakAreas = scores
    ? Object.entries(scores)
        .filter(([k, v]) => k !== 'overall' && typeof v === 'number' && v < 75)
        .map(([k]) => k)
    : [];

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now       = serverTimestamp();

  const sessionDoc = {
    sessionId,
    level:         blueprint?.level        || 'A2',
    mode:          blueprint?.mode         || 'guided',
    scenarioId:    blueprint?.scenarioId   || null,
    scenarioTitle: blueprint?.title        || null,
    startedAt:     now,   // approximation — real startedAt needs to be passed in
    endedAt:       now,
    durationSeconds,
    wordCount,
    turnCount,
    scores:        scores || null,
    corrections:   corrections.slice(0, 20), // cap at 20
    weakAreas,
  };

  try {
    // 1. Write session doc
    await setDoc(doc(db, 'users', uid, 'sessions', sessionId), sessionDoc);

    // 2. Update user aggregate stats
    const xpEarned  = computeXP({ durationSeconds, scores, corrections });
    const today     = todayString();
    const userSnap  = await getDoc(doc(db, 'users', uid));
    const userData  = userSnap.exists() ? userSnap.data() : {};
    const newStreak = computeStreak(userData.lastSessionDate, userData.streak || 0, today);

    const userUpdate = {
      lastActiveAt:    now,
      lastSessionDate: today,
      streak:          newStreak,
      totalSessions:   increment(1),
      totalMinutes:    increment(Math.round(durationSeconds / 60)),
      xp:              increment(xpEarned),
    };

    // Handle monthly free session counter
    const currentMonthKey = monthKey();
    if (!userData.isPaid) {
      if (userData.freeSessionsMonthKey !== currentMonthKey) {
        // New month — reset counter
        userUpdate.freeSessionsMonthKey      = currentMonthKey;
        userUpdate.freeSessionsUsedThisMonth = 1;
      } else {
        userUpdate.freeSessionsUsedThisMonth = increment(1);
      }
    }

    await updateDoc(doc(db, 'users', uid), userUpdate);

    console.log('[AURA] saveSession ok', { sessionId, xpEarned, streak: newStreak });
    return { sessionId, xpEarned, streak: newStreak };
  } catch (e) {
    console.warn('[AURA] saveSession failed:', e?.message);
  }
}

/**
 * Load last N sessions for a user (most recent first).
 */
export async function loadSessionHistory(uid, maxSessions = 20) {
  if (!uid) return [];
  try {
    const ref  = collection(db, 'users', uid, 'sessions');
    const snap = await getDocs(query(ref, orderBy('endedAt', 'desc'), limit(maxSessions)));
    const sessions = [];
    snap.forEach(d => sessions.push({ id: d.id, ...d.data() }));
    return sessions;
  } catch (e) {
    console.warn('[AURA] loadSessionHistory failed:', e?.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AURA MEMORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load AURA's persistent memory for a user.
 * Returns null if no memory exists yet.
 */
export async function loadMemory(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'memory', 'current'));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.warn('[AURA] loadMemory failed:', e?.message);
    return null;
  }
}

/**
 * Update AURA's persistent memory after a session.
 * Merges new corrections into recurring mistakes, updates strong areas.
 *
 * @param {string} uid
 * @param {object} sessionData  — { corrections, weakAreas, scores }
 */
export async function updateMemory(uid, sessionData) {
  if (!uid) return;
  const { corrections = [], weakAreas = [], scores = null } = sessionData;

  try {
    const existing = (await loadMemory(uid)) || {
      recurringMistakes: [],
      strongAreas:       [],
      currentFocus:      null,
      lastUpdatedAt:     null,
    };

    // Merge corrections into recurringMistakes
    const mistakeMap = {};
    (existing.recurringMistakes || []).forEach(m => {
      mistakeMap[m.pattern] = m;
    });
    corrections.forEach(c => {
      const key = c.wrong || c.right || '';
      if (!key) return;
      if (mistakeMap[key]) {
        mistakeMap[key].seenCount++;
        mistakeMap[key].lastSeen = todayString();
        mistakeMap[key].example  = c.right || mistakeMap[key].example;
      } else {
        mistakeMap[key] = {
          pattern:   key,
          example:   c.right || '',
          note:      c.note  || '',
          seenCount: 1,
          lastSeen:  todayString(),
        };
      }
    });

    // Keep top 15 most-seen mistakes
    const recurringMistakes = Object.values(mistakeMap)
      .sort((a, b) => b.seenCount - a.seenCount)
      .slice(0, 15);

    // Strong areas = score dimensions above 85 in this session
    const strongAreas = scores
      ? Object.entries(scores)
          .filter(([k, v]) => k !== 'overall' && typeof v === 'number' && v >= 85)
          .map(([k]) => k)
      : existing.strongAreas;

    // Current focus = top weak area
    const currentFocus = weakAreas[0] || existing.currentFocus || null;

    await setDoc(doc(db, 'users', uid, 'memory', 'current'), {
      recurringMistakes,
      strongAreas,
      currentFocus,
      lastUpdatedAt: serverTimestamp(),
    });

    console.log('[AURA] updateMemory ok', { mistakes: recurringMistakes.length });
  } catch (e) {
    console.warn('[AURA] updateMemory failed:', e?.message);
  }
}

/**
 * Build the auraContextBlock string that gets injected into the system prompt.
 * Call this before starting a session.
 */
export async function buildAuraContext(uid) {
  const memory = await loadMemory(uid);
  if (!memory) return '';

  const lines = [];

  if (memory.recurringMistakes?.length) {
    lines.push('STUDENT RECURRING MISTAKES (from previous sessions):');
    memory.recurringMistakes.slice(0, 5).forEach(m => {
      lines.push(`- "${m.pattern}" (seen ${m.seenCount}x) → correct: "${m.example}"`);
    });
  }

  if (memory.strongAreas?.length) {
    lines.push(`STUDENT STRONG AREAS: ${memory.strongAreas.join(', ')}`);
  }

  if (memory.currentFocus) {
    lines.push(`CURRENT FOCUS AREA: ${memory.currentFocus} — apply gentle extra attention here.`);
  }

  return lines.length
    ? '\n\nSTUDENT HISTORY CONTEXT:\n' + lines.join('\n')
    : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCESS CONTROL
// ─────────────────────────────────────────────────────────────────────────────

const FREE_SESSIONS_PER_MONTH = 3;

/**
 * Check if the user can start a session.
 * Returns { allowed: bool, reason: string }
 */
export async function checkSessionAccess(uid) {
  const profile = await loadUserProfile(uid);
  if (!profile) return { allowed: false, reason: 'no_profile' };
  if (profile.isPaid) return { allowed: true, reason: 'paid' };

  const currentMonthKey = monthKey();
  const used = profile.freeSessionsMonthKey === currentMonthKey
    ? (profile.freeSessionsUsedThisMonth || 0)
    : 0; // new month, reset

  if (used >= FREE_SESSIONS_PER_MONTH) {
    return { allowed: false, reason: 'trial_limit', used, limit: FREE_SESSIONS_PER_MONTH };
  }
  return { allowed: true, reason: 'trial', used, remaining: FREE_SESSIONS_PER_MONTH - used };
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

export async function logEvent(eventName, metadata = {}, uid = null) {
  if (!eventName) return;
  try {
    await addDoc(collection(db, 'analytics_events'), {
      userId:    uid || null,
      eventName,
      createdAt: serverTimestamp(),
      metadata:  compactMeta(metadata),
    });
  } catch (e) {}
}

function compactMeta(m = {}) {
  const out = {};
  ['level', 'scenarioId', 'mode', 'score', 'reason', 'durationSeconds'].forEach(k => {
    if (m[k] !== undefined) out[k] = m[k];
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function todayString() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function monthKey() {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function computeStreak(lastSessionDate, currentStreak, today) {
  if (!lastSessionDate) return 1; // first session ever
  if (lastSessionDate === today) return currentStreak; // already practiced today
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (lastSessionDate === yesterday) return currentStreak + 1; // extending streak
  return 1; // streak broken
}

function computeXP({ durationSeconds, scores, corrections }) {
  let xp = 0;
  xp += Math.min(50, Math.floor(durationSeconds / 60) * 5); // 5 XP per minute, cap 50
  if (scores?.overall) xp += Math.floor(scores.overall / 10); // up to 10 XP from score
  xp += Math.max(0, 5 - corrections.length) * 2; // bonus for clean session
  return Math.max(1, xp);
}
