import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, query, orderBy, limit, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { fbApp } from './auth.js';

export const db = getFirestore(fbApp);

// ── Analytics ─────────────────────────────────────────────────────────────────
export function compactAnalyticsMetadata(metadata = {}) {
  const out = {};
  if (metadata.level)      out.level      = metadata.level;
  if (metadata.scenarioId) out.scenarioId = metadata.scenarioId;
  if (metadata.mode)       out.mode       = metadata.mode;
  if (metadata.score)      out.score      = metadata.score;
  if (metadata.reason)     out.reason     = metadata.reason;
  return out;
}

export async function logAnalyticsEvent(eventName, metadata = {}) {
  const { currentUser } = await import('./auth.js').then(m => ({ currentUser: m.auth.currentUser }));
  if (!currentUser?.uid || !eventName) return;
  try {
    await addDoc(collection(db, 'analytics_events'), {
      userId:    currentUser.uid,
      eventName,
      createdAt: serverTimestamp(),
      metadata:  compactAnalyticsMetadata(metadata),
    });
  } catch (e) {}
}

// ── Free session counter ──────────────────────────────────────────────────────
export function getFreeSessionsUsedThisMonth(userProfile) {
  return parseInt(userProfile?.freeSessionsUsedThisMonth || '0', 10);
}

// ── Load user session history ─────────────────────────────────────────────────
export async function loadUserSessionHistory(uid, maxSessions = 30) {
  if (!uid) return [];
  try {
    const sessionsRef = collection(db, 'users', uid, 'sessions');
    let snap;
    try {
      snap = await getDocs(query(sessionsRef, orderBy('endedAt', 'desc'), limit(maxSessions)));
    } catch (orderedErr) {
      snap = await getDocs(query(sessionsRef, limit(maxSessions)));
    }
    const sessions = [];
    snap.forEach(d => sessions.push({ id: d.id, ...d.data() }));
    return sessions;
  } catch (e) {
    console.warn('[AURA] loadUserSessionHistory failed:', e?.message);
    return [];
  }
}

// ── Load user profile ─────────────────────────────────────────────────────────
export async function loadUserProfile(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) return snap.data();
    return null;
  } catch (e) {
    console.warn('[AURA] loadUserProfile failed:', e?.message);
    return null;
  }
}

// ── Load daily state ──────────────────────────────────────────────────────────
export async function loadDailyState(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'daily_state', 'current'));
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}

export async function saveDailyState(uid, data) {
  if (!uid) return;
  try {
    await setDoc(doc(db, 'users', uid, 'daily_state', 'current'), data);
  } catch (e) {
    console.warn('[AURA] saveDailyState failed:', e?.message);
  }
}

// ── Persist session progress ──────────────────────────────────────────────────
export async function persistSessionProgress({ uid, profileId, activeBlueprint, selectedScenario, selectedLevel, sessionStartedAt, result, completed, wordsUsed, conversationHistory, getActiveSessionMode }) {
  if (!uid || !(activeBlueprint || selectedScenario)) return;
  const endedAt   = new Date();
  const startedAt = sessionStartedAt || endedAt;
  const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));

  const weakAreas = [];
  const scoreMap  = [
    ['fluency',        result?.fluency],
    ['grammar',        result?.grammar],
    ['vocabulary',     result?.vocabulary],
    ['taskCompletion', result?.taskCompletion],
    ['connectorUse',   result?.connectorUse],
  ];
  scoreMap.forEach(([key, val]) => {
    if (typeof val === 'number' && val < 75) weakAreas.push(key);
  });

  const sessionId      = `sess_${endedAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
  const sourceScenario = activeBlueprint || selectedScenario;
  const activeMode     = sourceScenario?.programType === 'exam' ? 'exam' : getActiveSessionMode(sourceScenario?.level);
  const sessionLevel   = sourceScenario?.level || selectedLevel || 'A1';

  const sessionDoc = {
    sessionId,
    uid,
    profileId:      profileId || null,
    level:          sessionLevel,
    scenarioId:     sourceScenario?.scenarioId || sourceScenario?.id || null,
    scenarioTitle:  sourceScenario?.title || null,
    mode:           activeMode,
    programType:    sourceScenario?.programType || 'general',
    examPart:       sourceScenario?.examPart    || null,
    startedAt:      startedAt.toISOString(),
    endedAt:        endedAt.toISOString(),
    durationSeconds,
    completed:      !!completed,
    scores:         result || null,
    weakAreas,
    wordCount:      wordsUsed?.size || 0,
    turnCount:      conversationHistory?.filter(m => m.role === 'user').length || 0,
  };

  try {
    await setDoc(doc(db, 'users', uid, 'sessions', sessionId), sessionDoc);
    const userUpdate = { lastSessionAt: endedAt.toISOString() };
    if (result?.overall) userUpdate.lastScore = result.overall;
    await updateDoc(doc(db, 'users', uid), userUpdate);
  } catch (e) {
    console.warn('[AURA] persistSessionProgress failed:', e?.message);
  }
}

// ── Profile system ────────────────────────────────────────────────────────────

const LANG_FLAGS = {
  German: '🇩🇪', French: '🇫🇷', Japanese: '🇯🇵', Spanish: '🇪🇸',
  Italian: '🇮🇹', Mandarin: '🇨🇳', Portuguese: '🇧🇷', Korean: '🇰🇷',
  Arabic: '🇸🇦', Hindi: '🇮🇳',
};
export function getLangFlag(lang) { return LANG_FLAGS[lang] || '🌍'; }

export async function loadProfiles(uid) {
  if (!uid) return [];
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'profiles'));
    const profiles = [];
    snap.forEach(d => profiles.push({ id: d.id, ...d.data() }));
    profiles.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    return profiles;
  } catch (e) {
    console.warn('[AURA] loadProfiles failed:', e?.message);
    return [];
  }
}

export async function createProfile(uid, data) {
  if (!uid) return null;
  try {
    const profileId = `prof_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const profileDoc = {
      targetLanguage: data.targetLanguage || 'German',
      level:          data.level          || 'A1',
      nativeLanguage: data.nativeLanguage || 'English',
      langPref:       data.langPref       || data.nativeLanguage || 'English',
      goal:           data.goal           || 'Daily conversation',
      preferredMode:  data.preferredMode  || 'guided',
      flag:           getLangFlag(data.targetLanguage || 'German'),
      createdAt:      serverTimestamp(),
      updatedAt:      serverTimestamp(),
    };
    await setDoc(doc(db, 'users', uid, 'profiles', profileId), profileDoc);
    return { id: profileId, ...profileDoc };
  } catch (e) {
    console.warn('[AURA] createProfile failed:', e?.message);
    return null;
  }
}

export async function updateProfile(uid, profileId, data) {
  if (!uid || !profileId) return;
  try {
    await updateDoc(doc(db, 'users', uid, 'profiles', profileId), {
      ...data,
      flag:      getLangFlag(data.targetLanguage || 'German'),
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('[AURA] updateProfile failed:', e?.message);
  }
}

export async function deleteProfile(uid, profileId) {
  if (!uid || !profileId) return;
  try {
    await deleteDoc(doc(db, 'users', uid, 'profiles', profileId));
  } catch (e) {
    console.warn('[AURA] deleteProfile failed:', e?.message);
  }
}

export async function setActiveProfile(uid, profileId) {
  if (!uid || !profileId) return;
  try {
    await updateDoc(doc(db, 'users', uid), { activeProfileId: profileId, updatedAt: serverTimestamp() });
  } catch (e) {
    console.warn('[AURA] setActiveProfile failed:', e?.message);
  }
}

export async function loadProfileMemory(uid, profileId) {
  if (!uid || !profileId) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'memory', profileId));
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}

// Migrate existing flat user data into profiles subcollection (runs once per user)
export async function migrateUserToProfiles(uid, userDoc) {
  if (!uid || !userDoc) return [];
  const existing = await loadProfiles(uid);
  if (existing.length > 0) {
    if (!userDoc.activeProfileId) await setActiveProfile(uid, existing[0].id);
    return existing;
  }
  const firstProfile = await createProfile(uid, {
    targetLanguage: userDoc.targetLanguage || 'German',
    level:          userDoc.level          || 'A1',
    nativeLanguage: userDoc.nativeLanguage || 'English',
    langPref:       userDoc.langPref       || 'English',
    goal:           userDoc.goal           || 'Daily conversation',
    preferredMode:  userDoc.preferredMode  || 'guided',
  });
  if (firstProfile) {
    await setActiveProfile(uid, firstProfile.id);
    return [firstProfile];
  }
  return [];
}
