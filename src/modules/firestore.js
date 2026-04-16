/**
 * firestore.js — AURA Firestore layer
 *
 * Collections:
 *   users/{uid}                        — root profile (shared with GME, AURA adds its own fields)
 *   users/{uid}/profiles/{profileId}   — one doc per learning profile (language/level/mode/goal)
 *   users/{uid}/sessions/{sessionId}   — one doc per completed session (Worker-write only)
 *   users/{uid}/memory/{profileId}     — AURA's persistent memory per profile (Worker-write only)
 *   analytics_events/{auto}            — lightweight event log
 */

import {
  getFirestore,
  collection, doc,
  getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  query, orderBy, limit,
  serverTimestamp, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { fbApp } from './auth.js';

export const db = getFirestore(fbApp);

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const LANG_FLAGS = {
  German: '🇩🇪', French: '🇫🇷', Japanese: '🇯🇵', Spanish: '🇪🇸',
  Italian: '🇮🇹', Mandarin: '🇨🇳', Korean: '🇰🇷', Portuguese: '🇵🇹',
  Arabic: '🇸🇦', Hindi: '🇮🇳', Dutch: '🇳🇱', Russian: '🇷🇺',
};

export function getLangFlag(language) {
  return LANG_FLAGS[language] || '🌍';
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT USER PROFILE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load the root user document (shared between AURA and GME).
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
 * Ensure the root user document has AURA's required fields.
 * Safe to call on every login — only writes if fields are missing.
 * Does NOT touch any GME fields.
 */
export async function ensureUserDoc(uid, { name, email }) {
  if (!uid) return;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const data = snap.exists() ? snap.data() : {};

    const patch = {};
    if (!data.name  && name)  patch.name  = name;
    if (!data.email && email) patch.email = email;
    if (!data.createdAt)      patch.createdAt = serverTimestamp();

    // AURA-specific fields — only set if not already present
    if (data.xp              === undefined) patch.xp              = 0;
    if (data.streak          === undefined) patch.streak          = 0;
    if (data.lastSessionDate === undefined) patch.lastSessionDate = null;
    if (data.totalSessions   === undefined) patch.totalSessions   = 0;
    if (data.totalMinutes    === undefined) patch.totalMinutes    = 0;
    if (data.isPaid          === undefined) patch.isPaid          = false;
    if (data.freeSessionsUsedThisMonth === undefined) patch.freeSessionsUsedThisMonth = 0;
    if (data.freeSessionsMonthKey      === undefined) patch.freeSessionsMonthKey      = monthKey();
    if (data.activeProfileId === undefined) patch.activeProfileId = null;

    if (Object.keys(patch).length > 0) {
      if (snap.exists()) {
        await updateDoc(doc(db, 'users', uid), patch);
      } else {
        await setDoc(doc(db, 'users', uid), patch);
      }
    }

    patch.lastActiveAt = serverTimestamp();
    await updateDoc(doc(db, 'users', uid), { lastActiveAt: serverTimestamp() }).catch(() => {});
  } catch (e) {
    console.warn('[AURA] ensureUserDoc failed:', e?.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILES SUBCOLLECTION
// Each profile = one language + level + mode + goal combination.
// Paid users can have multiple. Free users get one.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load all profiles for a user.
 */
export async function loadProfiles(uid) {
  if (!uid) return [];
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'profiles'));
    const profiles = [];
    snap.forEach(d => profiles.push({ id: d.id, ...d.data() }));
    return profiles;
  } catch (e) {
    console.warn('[AURA] loadProfiles failed:', e?.message);
    return [];
  }
}

/**
 * Create a new learning profile.
 */
export async function createProfile(uid, { targetLanguage, level, nativeLanguage, langPref, goal, preferredMode }) {
  if (!uid) return null;
  try {
    const profileId = `prof_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const profileDoc = {
      id:             profileId,
      targetLanguage: targetLanguage || 'German',
      level:          level          || 'A2',
      nativeLanguage: nativeLanguage || 'English',
      langPref:       langPref       || nativeLanguage || 'English',
      goal:           goal           || 'Daily conversation',
      preferredMode:  preferredMode  || 'guided',
      flag:           getLangFlag(targetLanguage || 'German'),
      createdAt:      serverTimestamp(),
    };
    await setDoc(doc(db, 'users', uid, 'profiles', profileId), profileDoc);

    // If this is the first profile, set it as active
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (!userSnap.data()?.activeProfileId) {
      await updateDoc(doc(db, 'users', uid), { activeProfileId: profileId });
    }

    console.log('[AURA] createProfile ok', profileId);
    return profileDoc;
  } catch (e) {
    console.warn('[AURA] createProfile failed:', e?.message);
    return null;
  }
}

/**
 * Delete a profile. Does not delete its sessions or memory (historical data kept).
 */
export async function deleteProfile(uid, profileId) {
  if (!uid || !profileId) return;
  try {
    await deleteDoc(doc(db, 'users', uid, 'profiles', profileId));
  } catch (e) {
    console.warn('[AURA] deleteProfile failed:', e?.message);
  }
}

/**
 * Set the active profile on the root user doc.
 */
export async function setActiveProfile(uid, profileId) {
  if (!uid) return;
  try {
    await updateDoc(doc(db, 'users', uid), { activeProfileId: profileId });
  } catch (e) {
    console.warn('[AURA] setActiveProfile failed:', e?.message);
  }
}

/**
 * Migration helper: if user has no profiles subcollection yet, create one
 * from whatever fields exist on the root user doc (from old AURA or GME).
 * Safe to call on every login — no-ops if profiles already exist.
 */
export async function migrateUserToProfiles(uid, userDoc) {
  if (!uid) return [];

  // Check if profiles already exist
  const existing = await loadProfiles(uid);
  if (existing.length > 0) return existing;

  // Try to build a profile from existing root doc fields
  const lang   = userDoc?.targetLanguage || 'German';
  const level  = ['A1','A2','B1','B2','C1','C2'].includes(userDoc?.level) ? userDoc.level : 'A2';
  const native = userDoc?.nativeLanguage || userDoc?.langPref || 'English';
  const goal   = userDoc?.goal || 'Daily conversation';
  const mode   = userDoc?.preferredMode || 'guided';

  const newProfile = await createProfile(uid, {
    targetLanguage: lang,
    level,
    nativeLanguage: native,
    langPref:       native,
    goal,
    preferredMode:  mode,
  });

  return newProfile ? [newProfile] : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION HISTORY
// Sessions are written by the Cloudflare Worker (Service Account).
// Client can only read.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load last N sessions for a user (most recent first).
 * Optionally filter by profileId.
 */
export async function loadUserSessionHistory(uid, maxSessions = 20) {
  if (!uid) return [];
  try {
    const ref  = collection(db, 'users', uid, 'sessions');
    let snap;
    try {
      snap = await getDocs(query(ref, orderBy('endedAt', 'desc'), limit(maxSessions)));
    } catch {
      snap = await getDocs(query(ref, limit(maxSessions)));
    }
    const sessions = [];
    snap.forEach(d => sessions.push({ id: d.id, ...d.data() }));
    return sessions;
  } catch (e) {
    console.warn('[AURA] loadUserSessionHistory failed:', e?.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AURA MEMORY
// Memory is written by the Cloudflare Worker after each session.
// Client reads it at session start to inject into the system prompt.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load AURA's persistent memory for a specific profile.
 */
export async function loadMemory(uid, profileId) {
  if (!uid || !profileId) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'memory', profileId));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.warn('[AURA] loadMemory failed:', e?.message);
    return null;
  }
}

/**
 * Build the auraContextBlock string injected into the system prompt.
 * Summarises recurring mistakes and current focus for this profile.
 */
export async function buildAuraContext(uid, profileId) {
  const memory = await loadMemory(uid, profileId);
  if (!memory) return '';

  const lines = [];

  if (memory.recurringMistakes?.length) {
    lines.push('STUDENT HISTORY — recurring mistakes from previous sessions:');
    memory.recurringMistakes.slice(0, 5).forEach(m => {
      lines.push(`- "${m.pattern}" (seen ${m.seenCount}x) → correct form: "${m.example}"`);
    });
  }

  if (memory.strongAreas?.length) {
    lines.push(`Strong areas: ${memory.strongAreas.join(', ')}`);
  }

  if (memory.currentFocus) {
    lines.push(`Current focus: ${memory.currentFocus} — pay gentle extra attention here.`);
  }

  return lines.length
    ? '\n\nSTUDENT CONTEXT:\n' + lines.join('\n')
    : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCESS CONTROL
// ─────────────────────────────────────────────────────────────────────────────

const FREE_SESSIONS_PER_MONTH = 3;

export async function checkSessionAccess(uid) {
  const profile = await loadUserProfile(uid);
  if (!profile) return { allowed: false, reason: 'no_profile' };
  if (profile.isPaid || profile.isPaidStudent) return { allowed: true, reason: 'paid' };

  const currentMonthKey = monthKey();
  const used = profile.freeSessionsMonthKey === currentMonthKey
    ? (profile.freeSessionsUsedThisMonth || 0)
    : 0;

  if (used >= FREE_SESSIONS_PER_MONTH) {
    return { allowed: false, reason: 'trial_limit', used, limit: FREE_SESSIONS_PER_MONTH };
  }
  return { allowed: true, reason: 'trial', used, remaining: FREE_SESSIONS_PER_MONTH - used };
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

export async function logAnalyticsEvent(eventName, metadata = {}) {
  if (!eventName) return;
  try {
    const { auth } = await import('./auth.js');
    const uid = auth?.currentUser?.uid || null;
    await addDoc(collection(db, 'analytics_events'), {
      userId:    uid,
      eventName,
      createdAt: serverTimestamp(),
      metadata:  compactMeta(metadata),
    });
  } catch (e) {}
}

function compactMeta(m = {}) {
  const out = {};
  ['level', 'scenarioId', 'mode', 'score', 'reason', 'durationSeconds', 'profileId'].forEach(k => {
    if (m[k] !== undefined) out[k] = m[k];
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function monthKey() {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}
