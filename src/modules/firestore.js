/**
 * firestore.js — AURA data layer (Supabase edition)
 * Drop-in replacement for the Firestore module.
 * Same exported function signatures — no changes needed in ui.js imports.
 *
 * Table mapping:
 *   users/{uid}              → public.users          (id = Supabase UUID)
 *   users/{uid}/profiles     → public.profiles       (user_id = Supabase UUID)
 *   users/{uid}/sessions     → public.aura_sessions  (user_id = Supabase UUID)
 *   users/{uid}/memory       → public.user_memory    (user_id + doc_id='core')
 *   analytics_events         → public.analytics_events
 */
import { supabase } from './supabase-client.js';
import { FREE_SESSION_LIMIT } from '../config/constants.js';

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
// ROOT USER PROFILE  (public.users)
// ─────────────────────────────────────────────────────────────────────────────

export async function loadUserProfile(uid) {
  if (!uid) return null;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', uid)
      .single();

    if (error || !data) return null;

    // Merge top-level columns + extra_data into a flat object
    const ex = data.extra_data || {};
    return {
      isPaid:                      data.is_paid                      || false,
      isPaidStudent:               data.is_paid_student              || false,
      freeSessionsUsedThisMonth:   data.free_sessions_used_this_month || 0,
      freeSessionsMonthKey:        data.free_sessions_month_key       || null,
      activeProfileId:             data.active_profile_id             || null,
      subscription:                data.subscription                  || null,
      email:                       data.email                         || null,
      displayName:                 data.display_name                  || null,
      // AURA-specific fields stored in extra_data
      xp:               ex.xp               || 0,
      streak:           ex.streak           || 0,
      lastSessionDate:  ex.lastSessionDate  || null,
      totalSessions:    ex.totalSessions    || 0,
      totalMinutes:     ex.totalMinutes     || 0,
      ...ex,
    };
  } catch (e) {
    console.warn('[AURA] loadUserProfile failed:', e?.message);
    return null;
  }
}

/**
 * Ensure the user row has AURA's required fields.
 * Safe to call on every login — only writes missing fields.
 */
export async function ensureUserDoc(uid, { name, email }) {
  if (!uid) return;
  try {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', uid)
      .single();

    const ex = data?.extra_data || {};
    const needsPatch = !ex.xp_initialized;

    if (needsPatch) {
      const patch = {
        xp_initialized:          true,
        xp:                      ex.xp               !== undefined ? ex.xp              : 0,
        streak:                  ex.streak            !== undefined ? ex.streak           : 0,
        lastSessionDate:         ex.lastSessionDate   !== undefined ? ex.lastSessionDate  : null,
        totalSessions:           ex.totalSessions     !== undefined ? ex.totalSessions    : 0,
        totalMinutes:            ex.totalMinutes      !== undefined ? ex.totalMinutes     : 0,
        ...ex,
      };

      await supabase
        .from('users')
        .update({
          display_name: data?.display_name || name || null,
          email:        data?.email        || email || null,
          extra_data:   patch,
        })
        .eq('id', uid);
    }
  } catch (e) {
    console.warn('[AURA] ensureUserDoc failed:', e?.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILES  (public.profiles)
// ─────────────────────────────────────────────────────────────────────────────

export async function loadProfiles(uid) {
  if (!uid) return [];
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []).map(rowToProfile);
  } catch (e) {
    console.warn('[AURA] loadProfiles failed:', e?.message);
    return [];
  }
}

export async function createProfile(uid, { targetLanguage, level, nativeLanguage, langPref, goal, preferredMode }) {
  if (!uid) return null;
  try {
    const row = {
      id:              crypto.randomUUID(),   // explicit UUID — safety net alongside DB default
      user_id:         uid,
      target_language: targetLanguage  || 'German',
      level:           level           || 'A2',
      native_language: nativeLanguage  || 'English',
      lang_pref:       langPref        || nativeLanguage || 'English',
      goal:            goal            || 'Daily conversation',
      preferred_mode:  preferredMode   || 'guided',
      flag:            getLangFlag(targetLanguage || 'German'),
    };

    const { data: inserted, error } = await supabase
      .from('profiles')
      .insert(row)
      .select('*')
      .single();
    if (error) throw error;

    // If this is the first profile, mark it active on the users row.
    // Use conditional update to reduce race window on concurrent profile creation.
    if (inserted?.id) {
      await supabase
        .from('users')
        .update({ active_profile_id: inserted.id })
        .eq('id', uid)
        .is('active_profile_id', null);
    }

    return rowToProfile(inserted || row);
  } catch (e) {
    console.warn('[AURA] createProfile failed:', e?.message);
    return null;
  }
}

export async function deleteProfile(uid, profileId) {
  if (!uid || !profileId) return;
  try {
    await supabase.from('profiles').delete().eq('id', profileId).eq('user_id', uid);
  } catch (e) {
    console.warn('[AURA] deleteProfile failed:', e?.message);
  }
}

export async function setActiveProfile(uid, profileId) {
  if (!uid) return;
  try {
    await supabase
      .from('users')
      .update({ active_profile_id: profileId })
      .eq('id', uid);
  } catch (e) {
    console.warn('[AURA] setActiveProfile failed:', e?.message);
  }
}

/**
 * Update a profile row. Also syncs key fields to users.extra_data
 * so the Cloudflare Worker's readUserProfile() picks up the latest values.
 */
export async function updateProfile(uid, profileId, updates) {
  if (!uid || !profileId) return;
  try {
    const profileRow = {
      target_language:      updates.targetLanguage,
      level:                updates.level,
      native_language:      updates.nativeLanguage,
      lang_pref:            updates.langPref,
      goal:                 updates.goal,
      preferred_mode:       updates.preferredMode,
      flag:                 getLangFlag(updates.targetLanguage || 'German'),
      exam_name:            updates.examName     || null,
      exam_date:            updates.examDate     || null,
      exam_date_confirmed:  updates.examDateConfirmed || false,
      daily_minutes:        updates.dailyMinutes || 20,
    };
    // Remove undefined fields
    Object.keys(profileRow).forEach(k => profileRow[k] === undefined && delete profileRow[k]);

    await supabase
      .from('profiles')
      .update(profileRow)
      .eq('id', profileId)
      .eq('user_id', uid);

    // Sync to users.extra_data for the Worker
    const { data: u } = await supabase.from('users').select('extra_data').eq('id', uid).single();
    const ex = u?.extra_data || {};
    await supabase.from('users').update({
      extra_data: {
        ...ex,
        targetLanguage:  updates.targetLanguage,
        currentLevel:    updates.level,
        level:           updates.level,
        nativeLanguage:  updates.nativeLanguage,
        langPref:        updates.langPref,
        preferredMode:   updates.preferredMode,
        goal:            updates.goal,
        examName:        updates.examName     || null,
        examDate:        updates.examDate     || null,
        dailyMinutes:    updates.dailyMinutes || ex.dailyMinutes || 20,
      },
    }).eq('id', uid);
  } catch (e) {
    console.warn('[AURA] updateProfile failed:', e?.message);
    throw e;
  }
}

/**
 * Migration helper: if user has no profiles yet, create one from existing fields.
 */
export async function migrateUserToProfiles(uid, userDoc) {
  if (!uid) return [];

  const existing = await loadProfiles(uid);
  if (existing.length > 0) return existing;

  const lang   = userDoc?.targetLanguage || 'German';
  const level  = ['A1','A2','B1','B2','C1','C2'].includes(userDoc?.level) ? userDoc.level : 'A2';
  const native = userDoc?.nativeLanguage || userDoc?.langPref || 'English';
  const goal   = userDoc?.goal           || 'Daily conversation';
  const mode   = userDoc?.preferredMode  || 'guided';

  const newProfile = await createProfile(uid, {
    targetLanguage: lang, level, nativeLanguage: native,
    langPref: native, goal, preferredMode: mode,
  });

  return newProfile ? [newProfile] : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION HISTORY  (public.aura_sessions)
// ─────────────────────────────────────────────────────────────────────────────

export async function loadUserSessionHistory(uid, maxSessions = 20) {
  if (!uid) return [];
  try {
    const { data, error } = await supabase
      .from('aura_sessions')
      .select('*')
      .eq('user_id', uid)
      .order('ended_at', { ascending: false })
      .limit(maxSessions);

    if (error) throw error;
    return (data || []).map(sessionRowToObj);
  } catch (e) {
    console.warn('[AURA] loadUserSessionHistory failed:', e?.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AURA MEMORY  (public.user_memory)
// ─────────────────────────────────────────────────────────────────────────────

export async function loadMemory(uid, profileId) {
  if (!uid) return null;
  try {
    // Try profile-specific doc first, fall back to 'core' (written by the Worker)
    const docIds = profileId ? [profileId, 'core'] : ['core'];
    for (const docId of docIds) {
      const { data } = await supabase
        .from('user_memory')
        .select('content')
        .eq('user_id', uid)
        .eq('doc_id', docId)
        .single();
      if (data?.content && Object.keys(data.content).length) return data.content;
    }
    return null;
  } catch (e) {
    console.warn('[AURA] loadMemory failed:', e?.message);
    return null;
  }
}

export async function buildAuraContext(uid, profileId) {
  const memory = await loadMemory(uid, profileId);
  if (!memory) return '';

  const lines = [];

  if (memory.recurringMistakes?.length) {
    lines.push('STUDENT HISTORY — recurring mistakes from previous sessions:');
    memory.recurringMistakes.slice(0, 5).forEach(m => {
      const text = typeof m === 'string' ? m : `"${m.pattern}" (seen ${m.seenCount}x) → correct: "${m.example}"`;
      lines.push(`- ${text}`);
    });
  }

  if (memory.strongAreas?.length) {
    lines.push(`Strong areas: ${memory.strongAreas.join(', ')}`);
  }

  if (memory.currentFocus) {
    lines.push(`Current focus: ${memory.currentFocus}`);
  }

  return lines.length ? '\n\nSTUDENT CONTEXT:\n' + lines.join('\n') : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCESS CONTROL
// ─────────────────────────────────────────────────────────────────────────────

const FREE_SESSIONS_PER_MONTH = FREE_SESSION_LIMIT;

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
// ANALYTICS  (public.analytics_events)
// ─────────────────────────────────────────────────────────────────────────────

export async function logAnalyticsEvent(eventName, metadata = {}) {
  if (!eventName) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('analytics_events').insert({
      user_id:    user?.id || null,
      event_type: eventName,
      extra_data: compactMeta(metadata),
    });
  } catch (e) {}
}

function compactMeta(m = {}) {
  const out = {};
  ['level','scenarioId','mode','score','reason','durationSeconds','profileId'].forEach(k => {
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

function rowToProfile(row) {
  return {
    id:             row.id,
    targetLanguage: row.target_language,
    level:          row.level,
    nativeLanguage: row.native_language,
    langPref:       row.lang_pref,
    goal:           row.goal,
    preferredMode:  row.preferred_mode,
    flag:           row.flag || getLangFlag(row.target_language || 'German'),
    examName:       row.exam_name            || null,
    examDate:       row.exam_date            || null,
    examDateConfirmed: row.exam_date_confirmed || false,
    dailyMinutes:   row.daily_minutes        || 20,
    createdAt:      row.created_at,
  };
}

function sessionRowToObj(s) {
  const startMs = s.started_at ? new Date(s.started_at).getTime() : null;
  const endMs   = s.ended_at   ? new Date(s.ended_at).getTime()   : null;
  const durationSeconds = (startMs && endMs) ? Math.round((endMs - startMs) / 1000) : null;

  const accuracy = typeof s.accuracy === 'number' ? s.accuracy : null;

  return {
    id:              s.id,
    endedAt:         s.ended_at,
    startedAt:       s.started_at,
    durationSeconds,
    transcript:      s.transcript,
    corrections:     s.corrections,
    topicsCovered:   s.topics_covered,
    xpEarned:        s.xp_earned,
    wordsSpoken:     s.words_spoken,
    accuracy,
    // ui.js renders s.scores.overall as a percentage score
    scores: accuracy !== null ? { overall: accuracy * 100 } : null,
    mode:          s.mode,
    scenarioTitle: s.scenario_title,
    level:         s.level,
    endedNaturally: s.ended_naturally,
  };
}
