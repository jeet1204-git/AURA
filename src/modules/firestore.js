import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, query, orderBy, limit, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
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
export async function persistSessionProgress({ uid, activeBlueprint, selectedScenario, selectedLevel, sessionStartedAt, result, completed, wordsUsed, conversationHistory, getActiveSessionMode }) {
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
