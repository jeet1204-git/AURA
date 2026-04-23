/**
 * agents.js
 * AURA's brain. Five agents. Each does one job.
 * Gemini Live is the mouth and ears. This file is the mind.
 *
 * AGENTS:
 *   1. memoryAgent     — reads the full student picture before session
 *   2. curriculumAgent — picks what to teach today
 *   3. errorAgent      — classifies a mistake and writes it to DB
 *   4. instructionAgent— builds the short Gemini instruction from all context
 *   5. consolidationAgent — writes everything back after session ends
 */

const SUPABASE_URL = 'https://wkdwjhpeaahonuixqgwq.supabase.co';

function h(env) {
  return {
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'apikey':        env.SUPABASE_SERVICE_KEY,
    'Content-Type':  'application/json',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. MEMORY AGENT
// Reads the full student picture from user_memory + profiles + error_log.
// Returns one clean object the other agents can read from.
// ─────────────────────────────────────────────────────────────────────────────
export async function memoryAgent(env, userId, language = 'German') {
  const [memoryRes, profileRes, errorsRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/user_memory?user_id=eq.${userId}&language=eq.${encodeURIComponent(language)}&select=*&limit=1`,
      { headers: h(env) }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=active_profile_id,extra_data`,
      { headers: h(env) }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/error_log?user_id=eq.${userId}&language=eq.${encodeURIComponent(language)}&order=occurrence_count.desc&limit=10&select=error_type,error_category,occurrence_count,severity,is_recurring,example_wrong,example_right,node_id`,
      { headers: h(env) }
    ),
  ]);

  const memoryRows  = memoryRes.ok  ? await memoryRes.json()  : [];
  const userRows    = profileRes.ok ? await profileRes.json() : [];
  const errorRows   = errorsRes.ok  ? await errorsRes.json()  : [];

  const mem  = memoryRows?.[0]  || {};
  const user = userRows?.[0]    || {};

  // Load the active profile if it exists
  let profile = {};
  if (user.active_profile_id) {
    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.active_profile_id}&select=*&limit=1`,
      { headers: h(env) }
    );
    if (profRes.ok) {
      const rows = await profRes.json();
      profile = rows?.[0] || {};
    }
  }

  const recurringErrors = errorRows.filter(e => e.is_recurring);
  const topErrors       = errorRows.slice(0, 5);

  return {
    // Session continuity
    hasHistory:          !!mem.last_session_date,
    lastSessionDate:     mem.last_session_date     || null,
    lastSessionSummary:  mem.last_session_summary  || '',
    currentFocus:        mem.current_focus         || null,
    leftUnfinished:      mem.left_unfinished        || [],

    // Student model
    level:               profile.level             || mem.current_level  || 'A2',
    inferredLevel:       mem.inferred_level         || null,
    totalSessions:       mem.total_sessions         || 0,
    totalMinutes:        mem.total_minutes           || 0,
    streakDays:          mem.streak_days             || 0,
    learningStyle:       mem.learning_style          || 'balanced',
    preferredPace:       mem.preferred_pace          || 'normal',
    emotionalBaseline:   mem.emotional_baseline      || 'neutral',
    frustrationTriggers: mem.frustration_triggers    || [],
    breakthroughMoments: mem.breakthrough_moments    || [],
    personalFacts:       mem.personal_facts          || {},

    // Curriculum position
    currentNodeId:       profile.current_node_id   || null,
    nextNodeId:          profile.next_node_id       || null,
    weakNodeIds:         profile.weak_node_ids      || [],
    strongNodeIds:       profile.strong_node_ids    || [],

    // Profile
    targetLanguage:      profile.target_language    || language,
    nativeLanguage:      profile.native_language    || 'English',
    langPref:            profile.lang_pref          || profile.native_language || 'English',
    preferredMode:       profile.preferred_mode     || 'guided',
    goal:                profile.goal               || 'conversation',
    examName:            profile.exam_name          || null,
    examDate:            profile.exam_date          || null,
    dailyMinutes:        profile.daily_minutes      || 20,
    profileId:           profile.id                 || null,

    // Error picture
    topErrors,
    recurringErrors,
    hasRecurringErrors:  recurringErrors.length > 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. CURRICULUM AGENT
// Reads student_progress for this student + language.
// Decides which node to work on today.
// Priority order:
//   1. Node that is due for spaced repetition review (next_review_at <= now)
//   2. Node currently 'practicing' with lowest mastery
//   3. Next unstarted node whose prerequisites are all mastered
//   4. Fall back to profile.current_node_id if set
// ─────────────────────────────────────────────────────────────────────────────
export async function curriculumAgent(env, userId, language, studentMemory) {
  const now = new Date().toISOString();

  // Fetch all progress for this student + language
  const progressRes = await fetch(
    `${SUPABASE_URL}/rest/v1/student_progress?user_id=eq.${userId}&language=eq.${encodeURIComponent(language)}&select=*`,
    { headers: h(env) }
  );
  const progress = progressRes.ok ? await progressRes.json() : [];

  const progressMap = {};
  for (const row of progress) progressMap[row.node_id] = row;

  const masteredIds = progress
    .filter(p => p.status === 'mastered')
    .map(p => p.node_id);

  // Priority 1: due for review
  const dueForReview = progress.find(p =>
    p.status === 'mastered' &&
    p.next_review_at &&
    p.next_review_at <= now
  );
  if (dueForReview) {
    const node = await fetchNode(env, dueForReview.node_id);
    return { node, reason: 'spaced_repetition_review', progressRow: dueForReview };
  }

  // Priority 2: currently practicing with lowest mastery
  const practicing = progress
    .filter(p => p.status === 'practicing')
    .sort((a, b) => a.mastery_score - b.mastery_score);
  if (practicing.length > 0) {
    const node = await fetchNode(env, practicing[0].node_id);
    return { node, reason: 'continue_practicing', progressRow: practicing[0] };
  }

  // Priority 3: next unstarted node — prerequisites met
  const allNodes = await fetchNodesForLevel(env, language, studentMemory.level);
  for (const node of allNodes) {
    if (progressMap[node.id]?.status === 'mastered') continue;
    if (progressMap[node.id]?.status === 'practicing') continue;
    const prereqsMet = (node.prerequisites || []).every(p => masteredIds.includes(p));
    if (prereqsMet) {
      return { node, reason: 'new_node', progressRow: null };
    }
  }

  // Priority 4: fall back to profile's current node
  if (studentMemory.currentNodeId) {
    const node = await fetchNode(env, studentMemory.currentNodeId);
    if (node) return { node, reason: 'profile_current', progressRow: progressMap[studentMemory.currentNodeId] || null };
  }

  // No node found — student may have completed all nodes at this level
  return { node: null, reason: 'level_complete', progressRow: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ERROR AGENT
// Called after each student utterance.
// Takes the transcript + eval result, writes to session_utterances + error_log.
// Uses Gemini only for classification. All writes are ours.
// ─────────────────────────────────────────────────────────────────────────────
export async function errorAgent(env, userId, sessionId, utteranceIndex, {
  transcript,
  confidence,
  language,
  nodeId,
  evalResult,
}) {
  const corrections = evalResult?.corrections || [];
  const errorCount  = corrections.length;
  const accuracy    = evalResult?.accuracy ?? (errorCount === 0 ? 1.0 : Math.max(0.3, 1 - errorCount * 0.2));
  const xpEarned    = evalResult?.xpDelta  ?? (errorCount === 0 ? 15 : 5);
  const emotional   = evalResult?.memorySignals?.emotionalSignal || 'neutral';

  // Write utterance row
  const uttRes = await fetch(`${SUPABASE_URL}/rest/v1/session_utterances`, {
    method:  'POST',
    headers: { ...h(env), 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      session_id:           sessionId,
      user_id:              userId,
      language,
      utterance_index:      utteranceIndex,
      transcript,
      transcript_confidence: confidence || null,
      node_id:              nodeId || null,
      error_count:          errorCount,
      accuracy_score:       accuracy,
      xp_earned:            xpEarned,
      emotional_signal:     emotional,
    }),
  });
  if (!uttRes.ok) console.error('[errorAgent] utterance write failed:', await uttRes.text());

  // Write each error to error_log (upsert — increment occurrence_count)
  for (const correction of corrections) {
    const errorType = correction.rule
      ? slugify(correction.rule)
      : 'unknown_error';

    // Try to fetch existing error row
    const existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/error_log?user_id=eq.${userId}&language=eq.${encodeURIComponent(language)}&error_type=eq.${encodeURIComponent(errorType)}&select=id,occurrence_count,resolved_count`,
      { headers: h(env) }
    );
    const existRows = existRes.ok ? await existRes.json() : [];
    const existing  = existRows?.[0];

    if (existing) {
      const newCount   = (existing.occurrence_count || 1) + 1;
      const isRecurring = newCount >= 3;
      await fetch(
        `${SUPABASE_URL}/rest/v1/error_log?id=eq.${existing.id}`,
        {
          method:  'PATCH',
          headers: { ...h(env), 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            occurrence_count: newCount,
            is_recurring:     isRecurring,
            last_seen_at:     new Date().toISOString(),
            example_wrong:    correction.wrong || null,
            example_right:    correction.right || null,
            updated_at:       new Date().toISOString(),
          }),
        }
      );
    } else {
      // First time seeing this error — insert
      await fetch(`${SUPABASE_URL}/rest/v1/error_log`, {
        method:  'POST',
        headers: { ...h(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          user_id:         userId,
          language,
          error_type:      errorType,
          error_category:  correction.category || 'grammar',
          node_id:         nodeId || null,
          occurrence_count: 1,
          severity:        correction.severity || 'medium',
          example_wrong:   correction.wrong    || null,
          example_right:   correction.right    || null,
          first_seen_at:   new Date().toISOString(),
          last_seen_at:    new Date().toISOString(),
        }),
      });
    }
  }

  // Update student_progress mastery score for the current node
  if (nodeId) {
    await updateNodeProgress(env, userId, nodeId, language, accuracy, errorCount === 0);
  }

  return { errorCount, accuracy, xpEarned, emotional };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. INSTRUCTION AGENT
// Takes studentMemory + curriculumResult + topErrors.
// Builds a SHORT, precise instruction for Gemini Live.
// This replaces the 200-line prompt. Maximum 5 sentences total.
// ─────────────────────────────────────────────────────────────────────────────
export function instructionAgent(studentMemory, curriculumResult) {
  const {
    targetLanguage, level, nativeLanguage, langPref,
    preferredMode, goal, examName, examDate,
    hasHistory, lastSessionDate, lastSessionSummary,
    currentFocus, leftUnfinished, personalFacts,
    recurringErrors, breakthroughMoments, learningStyle,
    preferredPace, emotionalBaseline, totalSessions,
  } = studentMemory;

  const { node, reason } = curriculumResult;

  // Script enforcement
  const scriptNotes = {
    Gujarati: 'ગુજરાતી script only — never romanised.',
    Hindi:    'हिंदी Devanagari only — never romanised.',
    Arabic:   'Arabic script only.',
    Japanese: 'hiragana/kanji only.',
    Mandarin: 'Chinese characters only.',
    Korean:   'Hangul only.',
  };
  const scriptNote = scriptNotes[langPref] || '';

  // Mode
  const modeStr = preferredMode === 'immersion'
    ? `Speak ONLY in ${targetLanguage}. Use ${langPref} only if student is silent 15+ seconds.`
    : `Speak in ${targetLanguage}. Use ${langPref} for corrections only — one sentence max.`;

  // Today's teaching focus from curriculum agent
  let focusStr = '';
  if (node) {
    focusStr = reason === 'spaced_repetition_review'
      ? `TODAY: Review "${node.title}" — student has not practiced this in a while. Test retention, do not re-teach from scratch.`
      : reason === 'new_node'
      ? `TODAY: Introduce "${node.title}" — ${node.description}. Start simple, build up.`
      : `TODAY: Continue practicing "${node.title}" — ${node.description}.`;
  } else if (currentFocus) {
    focusStr = `TODAY: ${currentFocus}`;
  }

  // Recurring errors — top 3 only
  const errorStr = recurringErrors.length
    ? `WATCH FOR: ${recurringErrors.slice(0, 3).map(e => e.error_type.replace(/_/g, ' ')).join(', ')} — student keeps making these mistakes.`
    : '';

  // Exam urgency
  let examStr = '';
  if (goal === 'exam' && examName && examDate && examDate !== 'not_booked') {
    const daysLeft = Math.ceil((new Date(examDate) - Date.now()) / 86_400_000);
    if (daysLeft > 0) examStr = `EXAM: ${examName} in ${daysLeft} days — prioritise exam-style practice.`;
  }

  // Opening instruction
  let openingStr = '';
  if (!hasHistory || totalSessions === 0) {
    openingStr = level === 'A1'
      ? `OPENING: Greet in ${langPref}. Explain you are AURA. Ask if they have heard any ${targetLanguage} before. Start from zero.`
      : `OPENING: Greet warmly in ${targetLanguage}. Ask one simple question to get them speaking. Two sentences max.`;
  } else {
    const daysSince = lastSessionDate
      ? Math.floor((Date.now() - new Date(lastSessionDate)) / 86_400_000)
      : 0;
    const dayStr = daysSince === 0 ? 'earlier today' : daysSince === 1 ? 'yesterday' : `${daysSince} days ago`;
    const unfinished = leftUnfinished?.length ? leftUnfinished[0] : null;
    openingStr = unfinished
      ? `OPENING: Greet in ${targetLanguage} like you remember them. Reference "${unfinished}" naturally. Ask one question to resume.`
      : `OPENING: Greet in ${targetLanguage}. Mention they practiced ${dayStr}. Ask one question to start.`;
  }

  // Pace and style
  const paceStr = preferredPace === 'slow'
    ? 'Speak slowly. Pause after each sentence. Wait for the student.'
    : preferredPace === 'fast'
    ? 'Keep pace brisk. Push student to respond faster.'
    : '';

  // Personal facts — weave naturally, never recite
  const factsStr = Object.keys(personalFacts || {}).length
    ? `PERSONAL: ${Object.entries(personalFacts).slice(0, 3).map(([k,v]) => `${k}=${v}`).join(', ')} — weave into conversation naturally.`
    : '';

  // Assemble — keep it short
  const parts = [
    `You are AURA, a ${targetLanguage} tutor. Student is ${level} level. Native: ${nativeLanguage}. Corrections in: ${langPref}${scriptNote ? ' (' + scriptNote + ')' : ''}.`,
    modeStr,
    focusStr,
    errorStr,
    examStr,
    openingStr,
    paceStr,
    factsStr,
    `RULES: Never output markdown, bullets, or JSON aloud. After each response write silently: ##CORRECTION##{"wrong":"...","right":"...","note":"..."}##END## or ##CORRECTION##none##END##`,
  ].filter(Boolean).join('\n');

  return parts;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. CONSOLIDATION AGENT
// Called once when session ends.
// Reads session_utterances for this session.
// Updates: user_memory, student_progress, profiles (level up if needed).
// Uses a small Gemini call only for the session summary sentence.
// All DB writes are ours.
// ─────────────────────────────────────────────────────────────────────────────
export async function consolidationAgent(env, userId, sessionId, language, profileId, geminiApiKey) {
  const now = new Date().toISOString();

  // Read all utterances for this session
  const uttRes = await fetch(
    `${SUPABASE_URL}/rest/v1/session_utterances?session_id=eq.${sessionId}&order=utterance_index.asc&select=*`,
    { headers: h(env) }
  );
  const utterances = uttRes.ok ? await uttRes.json() : [];

  const totalUtterances = utterances.length;
  const avgAccuracy     = totalUtterances
    ? utterances.reduce((s, u) => s + (u.accuracy_score || 0), 0) / totalUtterances
    : 0;
  const totalXp         = utterances.reduce((s, u) => s + (u.xp_earned || 0), 0);
  const totalWords      = utterances.reduce((s, u) => s + (u.transcript?.split(' ').length || 0), 0);
  const nodesPracticed  = [...new Set(utterances.map(u => u.node_id).filter(Boolean))];
  const emotionCounts   = {};
  for (const u of utterances) {
    if (u.emotional_signal) emotionCounts[u.emotional_signal] = (emotionCounts[u.emotional_signal] || 0) + 1;
  }
  const dominantEmotion = Object.entries(emotionCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || 'neutral';

  // Read current memory
  const memRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_memory?user_id=eq.${userId}&language=eq.${encodeURIComponent(language)}&select=*&limit=1`,
    { headers: h(env) }
  );
  const memRows = memRes.ok ? await memRes.json() : [];
  const currentMem = memRows?.[0] || {};

  // Read error log — top recurring errors after this session
  const errRes = await fetch(
    `${SUPABASE_URL}/rest/v1/error_log?user_id=eq.${userId}&language=eq.${encodeURIComponent(language)}&order=occurrence_count.desc&limit=5&select=error_type,occurrence_count,is_recurring,node_id`,
    { headers: h(env) }
  );
  const topErrors = errRes.ok ? await errRes.json() : [];

  // Generate a 2-sentence summary with a tiny Gemini call
  const transcriptText = utterances.map(u => u.transcript).filter(Boolean).join(' | ');
  let summary = `Practiced ${nodesPracticed.length} topic(s) with ${Math.round(avgAccuracy * 100)}% accuracy.`;

  if (transcriptText && geminiApiKey) {
    try {
      const summaryRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text:
              `Summarize this language learning session in exactly 2 sentences. Focus on what was practiced and how the student did. Be specific.\n\nTRANSCRIPT SNIPPETS: ${transcriptText.slice(0, 800)}\n\nReturn ONLY the 2 sentences, nothing else.`
            }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 100 },
          }),
        }
      );
      if (summaryRes.ok) {
        const sd = await summaryRes.json();
        const s  = sd?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (s) summary = s;
      }
    } catch (e) {
      console.error('[consolidationAgent] summary call failed:', e);
    }
  }

  // Determine next focus
  const weakNodes  = topErrors.filter(e => e.node_id).map(e => e.node_id);
  const nextFocus  = weakNodes.length
    ? `Review errors in ${weakNodes.slice(0,2).join(', ')} from this session`
    : nodesPracticed.length
    ? `Continue from ${nodesPracticed[nodesPracticed.length - 1]}`
    : currentMem.current_focus || 'continue from where we left off';

  // Check for level up — if all nodes at current level mastered
  const levelUpCheck = await checkLevelUp(env, userId, language, currentMem.current_level || 'A2');

  // Update streak
  const lastActiveDate = currentMem.last_active_date;
  const todayStr       = now.slice(0, 10);
  const yesterdayStr   = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const newStreak      = lastActiveDate === yesterdayStr
    ? (currentMem.streak_days || 0) + 1
    : lastActiveDate === todayStr
    ? (currentMem.streak_days || 0)
    : 1;

  // Write updated memory
  const memUpdate = {
    last_session_id:      sessionId,
    last_session_date:    now,
    last_session_summary: summary,
    current_focus:        nextFocus,
    left_unfinished:      [],
    current_level:        levelUpCheck.newLevel || currentMem.current_level || 'A2',
    inferred_level:       levelUpCheck.inferredLevel || currentMem.inferred_level,
    total_sessions:       (currentMem.total_sessions || 0) + 1,
    total_minutes:        (currentMem.total_minutes  || 0) + Math.round(totalWords / 120),
    streak_days:          newStreak,
    last_active_date:     todayStr,
    emotional_baseline:   dominantEmotion,
    breakthrough_moments: currentMem.breakthrough_moments || [],
    personal_facts:       currentMem.personal_facts || {},
    learning_style:       currentMem.learning_style  || 'balanced',
    preferred_pace:       currentMem.preferred_pace   || 'normal',
    frustration_triggers: currentMem.frustration_triggers || [],
  };

  if (memRows.length > 0) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/user_memory?user_id=eq.${userId}&language=eq.${encodeURIComponent(language)}`,
      {
        method:  'PATCH',
        headers: { ...h(env), 'Prefer': 'return=minimal' },
        body:    JSON.stringify(memUpdate),
      }
    );
  } else {
    await fetch(`${SUPABASE_URL}/rest/v1/user_memory`, {
      method:  'POST',
      headers: { ...h(env), 'Prefer': 'return=minimal' },
      body:    JSON.stringify({ user_id: userId, language, ...memUpdate }),
    });
  }

  // Update aura_sessions row
  await fetch(
    `${SUPABASE_URL}/rest/v1/aura_sessions?id=eq.${sessionId}`,
    {
      method:  'PATCH',
      headers: { ...h(env), 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        ended_at:        now,
        ended_naturally: true,
        xp_earned:       totalXp,
        words_spoken:    totalWords,
        accuracy:        avgAccuracy,
        mood_signals:    dominantEmotion,
        topics_covered:  nodesPracticed,
      }),
    }
  );

  // Update profile: session count, XP, level if levelled up, weak nodes
  if (profileId) {
    const profilePatch = {
      session_count: (await getProfileSessionCount(env, profileId)) + 1,
      total_xp:      totalXp,
      weak_node_ids: weakNodes,
    };
    if (levelUpCheck.didLevelUp) {
      profilePatch.level           = levelUpCheck.newLevel;
      profilePatch.last_level_up_at = now;
    }
    if (nodesPracticed.length > 0) {
      profilePatch.current_node_id = nodesPracticed[nodesPracticed.length - 1];
    }
    await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}`,
      {
        method:  'PATCH',
        headers: { ...h(env), 'Prefer': 'return=minimal' },
        body:    JSON.stringify(profilePatch),
      }
    );
  }

  return {
    ok:           true,
    summary,
    nextFocus,
    totalXp,
    avgAccuracy,
    newStreak,
    levelUp:      levelUpCheck.didLevelUp ? levelUpCheck.newLevel : null,
    nodesPracticed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function fetchNode(env, nodeId) {
  if (!nodeId) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/curriculum_nodes?id=eq.${encodeURIComponent(nodeId)}&select=*&limit=1`,
    { headers: h(env) }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

async function fetchNodesForLevel(env, language, level) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/curriculum_nodes?language=eq.${encodeURIComponent(language)}&cefr_level=eq.${level}&order=sort_order.asc&select=*`,
    { headers: h(env) }
  );
  if (!res.ok) return [];
  return await res.json();
}

async function updateNodeProgress(env, userId, nodeId, language, accuracy, wasCorrect) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/student_progress?user_id=eq.${userId}&node_id=eq.${encodeURIComponent(nodeId)}&select=*&limit=1`,
    { headers: h(env) }
  );
  const rows = res.ok ? await res.json() : [];
  const existing = rows?.[0];

  const now = new Date().toISOString();

  if (existing) {
    const newTimesCorrect  = (existing.times_correct  || 0) + (wasCorrect ? 1 : 0);
    const newTimesWrong    = (existing.times_wrong     || 0) + (wasCorrect ? 0 : 1);
    const newTimesPracticed = (existing.times_practiced || 0) + 1;

    // Mastery: rolling average weighted toward recent performance
    const newMastery = Math.min(1.0,
      (existing.mastery_score * 0.7) + (accuracy * 0.3)
    );

    const newStatus = newMastery >= 0.85
      ? 'mastered'
      : newMastery >= 0.4
      ? 'practicing'
      : 'introduced';

    // Spaced repetition: if mastered, schedule next review
    let nextReview = null;
    if (newStatus === 'mastered') {
      const intervalDays = Math.min(30, Math.pow(2, Math.floor(newTimesPracticed / 3)));
      nextReview = new Date(Date.now() + intervalDays * 86_400_000).toISOString();
    }

    await fetch(
      `${SUPABASE_URL}/rest/v1/student_progress?user_id=eq.${userId}&node_id=eq.${encodeURIComponent(nodeId)}`,
      {
        method:  'PATCH',
        headers: { ...h(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          mastery_score:   newMastery,
          times_practiced: newTimesPracticed,
          times_correct:   newTimesCorrect,
          times_wrong:     newTimesWrong,
          status:          newStatus,
          last_practiced:  now,
          mastered_at:     newStatus === 'mastered' && !existing.mastered_at ? now : existing.mastered_at,
          next_review_at:  nextReview,
          updated_at:      now,
        }),
      }
    );
  } else {
    // First time practicing this node
    await fetch(`${SUPABASE_URL}/rest/v1/student_progress`, {
      method:  'POST',
      headers: { ...h(env), 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        user_id:         userId,
        node_id:         nodeId,
        language,
        status:          'introduced',
        mastery_score:   accuracy * 0.3,
        times_practiced: 1,
        times_correct:   wasCorrect ? 1 : 0,
        times_wrong:     wasCorrect ? 0 : 1,
        first_seen_at:   now,
        last_practiced:  now,
        updated_at:      now,
      }),
    });
  }
}

async function checkLevelUp(env, userId, language, currentLevel) {
  const levelOrder = ['A1', 'A2', 'B1', 'B2', 'C1'];
  const currentIdx = levelOrder.indexOf(currentLevel);
  if (currentIdx === levelOrder.length - 1) return { didLevelUp: false };

  // Check how many nodes at current level are mastered
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/student_progress?user_id=eq.${userId}&language=eq.${encodeURIComponent(language)}&status=eq.mastered&select=node_id`,
    { headers: h(env) }
  );
  const mastered = res.ok ? await res.json() : [];
  const masteredIds = mastered.map(r => r.node_id);

  const allNodesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/curriculum_nodes?language=eq.${encodeURIComponent(language)}&cefr_level=eq.${currentLevel}&select=id`,
    { headers: h(env) }
  );
  const allNodes = allNodesRes.ok ? await allNodesRes.json() : [];
  const totalAtLevel   = allNodes.length;
  const masteredAtLevel = allNodes.filter(n => masteredIds.includes(n.id)).length;

  // Level up if 80% of current level nodes are mastered
  if (totalAtLevel > 0 && masteredAtLevel / totalAtLevel >= 0.8) {
    const newLevel = levelOrder[currentIdx + 1];
    return { didLevelUp: true, newLevel, inferredLevel: newLevel };
  }
  return { didLevelUp: false };
}

async function getProfileSessionCount(env, profileId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${profileId}&select=session_count&limit=1`,
    { headers: h(env) }
  );
  const rows = res.ok ? await res.json() : [];
  return rows?.[0]?.session_count || 0;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
