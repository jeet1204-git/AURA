import { WORKER_URL, DEEPGRAM_WORKER_URL, GEMINI_WS_EPHEMERAL, MODEL, SILENCE_MS, DEFAULT_SESSION_SECONDS, FREE_SESSION_LIMIT } from '../config/constants.js';
import { SESSION_STATES, SESSION_TRANSITIONS, STAGE, BLUEPRINT_POLICIES, SCENARIOS, resolveScenarioForLevel } from '../config/scoring.js';
import { A2_EXAM_TOPICS, A2_EXAM_CUE_SETS, EXAM_DEFAULT_PASS_THRESHOLDS, EXAM_CUE_KEYWORD_GROUPS } from '../config/exam-topics.js';
import { buildSystemPrompt } from './prompts.js';
import { buildPracticeEvalPrompt, buildExamEvalPrompt, renderScore, renderPostSessionCoaching, buildFeedbackRecord, resetPostSessionCoaching, escHtml, toast } from './evaluation.js';
import { getWorkletBlobUrl, createWorklet, ensurePlaybackWorklet, enqueueAudio } from '../audio/worklets.js';
import { auth, getIdToken } from './auth.js';
import { db, persistSessionProgress, loadUserSessionHistory, loadDailyState, saveDailyState, logAnalyticsEvent } from './firestore.js';
import { resetSession as storeResetSession, setAudioCtx, setMicCtx, setMicStream, setWorkletNode, setPlaybackNode, setWs, setDgWs, setSessionActive, setDgClosingByApp } from '../state/store.js';

// ── STORE STATE SHADOWS ───────────────────────────────────────────────────────
// store.js owns these variables and exposes them on window via Object.defineProperties.
// session.js reads them as bare names. Because ES module imports of `let` bindings
// are live but read-only, we instead declare local `let` shadows here that stay
// in sync with window (which store.js already keeps up to date).
// Rule: always assign via the setter below so window (and therefore store.js) also updates.

function _get(k)    { return window[k]; }
function _set(k, v) { window[k] = v; }   // store.js setter is wired on window

// Declare every store variable as a local that proxies window on first read.
// We use getters on a plain object and destructure — but the simplest correct
// approach for a module that mutates state is just to use window.X everywhere.
// However that would require touching every line. Instead we use a Proxy on
// the module's local binding via a tiny helper that makes bare names work:

// The following are the only variables session.js WRITES to. We declare them
// as local lets initialised from window, and every assignment uses a small
// inline helper defined immediately after.
let sessionActive       = window.sessionActive       ?? false;
let sessionSeconds      = window.sessionSeconds      ?? 1200;
let sessionStartedAt    = window.sessionStartedAt    ?? null;
let sessionPaused       = window.sessionPaused       ?? false;
let sessionTimerInterval= window.sessionTimerInterval?? null;
let correctionTimeout   = window.correctionTimeout   ?? null;
let addTimeUsed         = window.addTimeUsed         ?? false;
let turnCount           = window.turnCount           ?? 0;
let micMuted            = window.micMuted            ?? false;
let dgClosingByApp      = window.dgClosingByApp      ?? false;
let ws                  = window.ws                  ?? null;
let dgWs                = window.dgWs                ?? null;
let audioCtx            = window.audioCtx            ?? null;
let micCtx              = window.micCtx              ?? null;
let micStream           = window.micStream           ?? null;
let workletNode         = window.workletNode         ?? null;
let playbackNode        = window.playbackNode        ?? null;
let conversationHistory = window.conversationHistory ?? [];
let wordsUsed           = window.wordsUsed           ?? new Set();
let errorPatterns       = window.errorPatterns       ?? {};
let auraContextBlock    = window.auraContextBlock    ?? '';
let liveEventLog        = window.liveEventLog        ?? [];
let canonicalTurns      = window.canonicalTurns      ?? [];
let activeBlueprint     = window.activeBlueprint     ?? null;
let selectedLevel       = window.selectedLevel       ?? 'A1';
let selectedScenario    = window.selectedScenario    ?? null;
let selectedSessionMode = window.selectedSessionMode ?? 'guided';
let selectedLangPref    = window.selectedLangPref    ?? 'English';
let selectedProgramType      = window.selectedProgramType      ?? 'general';
let selectedExamPart         = window.selectedExamPart         ?? 'teil1';
let selectedExamRunType      = window.selectedExamRunType      ?? 'practice';
let selectedExamTopicId      = window.selectedExamTopicId      ?? null;
let selectedExaminerStyle    = window.selectedExaminerStyle    ?? 'standard';
let selectedInputMode        = window.selectedInputMode        ?? 'both';
let isPaidStudent            = window.isPaidStudent            ?? false;
let currentUser              = window.currentUser              ?? null;
let userProfile              = window.userProfile              ?? null;
let userSessionHistory       = window.userSessionHistory       ?? [];
let lastUserSpeechTime       = window.lastUserSpeechTime       ?? null;
let userMemorySnapshot       = window.userMemorySnapshot       ?? null;

// Local-only state (not in store.js)
let currentUserText          = '';
let currentUserEntryEl       = null;
let currentAiText            = '';
let currentAiEntryEl         = null;
let chalkEraseTimer          = null;
let silenceTimer             = null;
let silenceCountdownInterval = null;
let sessionDerivedMetrics    = {
  totalUserTurns: 0, averageUserTurnLength: 0, oneWordUserAnswerCount: 0,
  clarificationPromptCount: 0, estimatedIndependentResponseCount: 0, totalAssistantTurns: 0,
};

// Sync all local shadows back to window after every assignment.
// We wrap this in a function called after any batch of assignments.
function _syncToStore() {
  window.sessionActive        = sessionActive;
  window.sessionSeconds       = sessionSeconds;
  window.sessionStartedAt     = sessionStartedAt;
  window.sessionPaused        = sessionPaused;
  window.sessionTimerInterval = sessionTimerInterval;
  window.correctionTimeout    = correctionTimeout;
  window.addTimeUsed          = addTimeUsed;
  window.turnCount            = turnCount;
  window.micMuted             = micMuted;
  window.dgClosingByApp       = dgClosingByApp;
  window.ws                   = ws;
  window.dgWs                 = dgWs;
  window.audioCtx             = audioCtx;
  window.micCtx               = micCtx;
  window.micStream            = micStream;
  window.workletNode          = workletNode;
  window.playbackNode         = playbackNode;
  window.conversationHistory  = conversationHistory;
  window.wordsUsed            = wordsUsed;
  window.errorPatterns        = errorPatterns;
  window.auraContextBlock     = auraContextBlock;
  window.liveEventLog         = liveEventLog;
  window.canonicalTurns       = canonicalTurns;
  window.activeBlueprint      = activeBlueprint;
  window.selectedLevel        = selectedLevel;
  window.selectedScenario     = selectedScenario;
  window.selectedSessionMode  = selectedSessionMode;
  window.selectedLangPref     = selectedLangPref;
  window.selectedProgramType  = selectedProgramType;
  window.selectedInputMode    = selectedInputMode;
  window.selectedExamPart     = selectedExamPart;
  window.selectedExamRunType  = selectedExamRunType;
  window.selectedExamTopicId  = selectedExamTopicId;
  window.selectedExaminerStyle= selectedExaminerStyle;
  window.lastUserSpeechTime   = lastUserSpeechTime;
  window.userMemorySnapshot   = userMemorySnapshot;
}

// Re-read all mutable store vars from window (call at session start so we
// pick up anything store.js or session-adapter.js set after module init).
function _syncFromStore() {
  sessionActive        = window.sessionActive        ?? sessionActive;
  sessionSeconds       = window.sessionSeconds       ?? sessionSeconds;
  sessionPaused        = window.sessionPaused        ?? sessionPaused;
  addTimeUsed          = window.addTimeUsed          ?? addTimeUsed;
  turnCount            = window.turnCount            ?? turnCount;
  micMuted             = window.micMuted             ?? micMuted;
  activeBlueprint      = window.activeBlueprint      ?? activeBlueprint;
  selectedLevel        = window.selectedLevel        ?? selectedLevel;
  selectedScenario     = window.selectedScenario     ?? selectedScenario;
  selectedSessionMode  = window.selectedSessionMode  ?? selectedSessionMode;
  selectedLangPref     = window.selectedLangPref     ?? selectedLangPref;
  selectedProgramType  = window.selectedProgramType  ?? selectedProgramType;
  isPaidStudent        = window.isPaidStudent        ?? isPaidStudent;
  currentUser          = window.currentUser          ?? currentUser;
  userProfile          = window.userProfile          ?? userProfile;
  userSessionHistory   = window.userSessionHistory   ?? userSessionHistory;
  selectedInputMode    = window.selectedInputMode    ?? selectedInputMode;
  selectedExamPart     = window.selectedExamPart     ?? selectedExamPart;
  selectedExamRunType  = window.selectedExamRunType  ?? selectedExamRunType;
  selectedExamTopicId  = window.selectedExamTopicId  ?? selectedExamTopicId;
  selectedExaminerStyle= window.selectedExaminerStyle?? selectedExaminerStyle;
  lastUserSpeechTime   = window.lastUserSpeechTime   ?? lastUserSpeechTime;
  userMemorySnapshot   = window.userMemorySnapshot   ?? userMemorySnapshot;
}
// ── END STORE STATE SHADOWS ───────────────────────────────────────────────────

// Shorthand used throughout this module — safe null-returning getElementById.
const _el = id => document.getElementById(id);

let _sessionState = SESSION_STATES.IDLE;

function getSessionState() {
  return _sessionState;
}

function transitionSessionState(next, meta = {}) {
  const current = _sessionState;
  const allowed = SESSION_TRANSITIONS[current];

  if (!allowed) {
    console.error('[AURA][SSM] no transition table entry for current state', { current, attemptedNext: next });
    return false;
  }

  if (!allowed.includes(next)) {
    console.error('[AURA][SSM] ILLEGAL TRANSITION blocked', {
      from: current,
      to: next,
      allowed,
      ...meta,
    });
    return false;
  }

  _sessionState = next;
  console.log(`[AURA][SSM] ${current} -> ${next}`, meta);
  return true;
}

function resetSessionState() {
  const previous = _sessionState;
  _sessionState = SESSION_STATES.IDLE;
  console.log(`[AURA][SSM] state reset to IDLE (was: ${previous})`);
}
// ── END SESSION STATE MACHINE ─────────────────────────────────────────────────

// ── STAGE PROGRESSION ENGINE ──────────────────────────────────────────────────
// Phase C — stages are real enforced runtime objects with entry/exit tracking.
// The session state machine owns macro state (TASK_ACTIVE etc).
// The stage engine owns micro state within a live session.
// Exam sessions bypass the stage engine entirely — their flow is prompt-controlled.


// Runtime stage state — reset on every session start via initStageEngine()
let _stage = {
  current:       null,   // current STAGE value
  index:         0,      // index into activeBlueprint.stage_flow
  enteredAt:     null,   // Date
  userTurnsInStage: 0,
  expansionSignalFired: false,
};

function initStageEngine() {
  _stage = {
    current:              null,
    index:                0,
    enteredAt:            null,
    userTurnsInStage:     0,
    expansionSignalFired: false,
  };
}

function getCurrentStage() {
  return _stage.current;
}

function enterStage(stageName, meta = {}) {
  const prev = _stage.current;
  _stage.current          = stageName;
  _stage.enteredAt        = new Date();
  _stage.userTurnsInStage = 0;
  console.log(`[AURA][STAGE] ${prev || 'none'} -> ${stageName}`, meta);
  pushEvent('stage_entered', { stage: stageName, prev, ...meta });
  // Update system prompt to reflect new stage context.
  // Gemini Live does not support mid-session system instruction updates via the
  // WebSocket protocol, so we send a silent client turn that re-anchors behavior.
  _sendStageAnchor(stageName);
}

function _sendStageAnchor(stageName) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!activeBlueprint || activeBlueprint.programType === 'exam') return;

  const langConfig = buildPromptLanguageConfig();
  const corrLang   = langConfig.correctionLang;
  const greetWord  = langConfig.greetWord;
  const anchors = {
    [STAGE.WARMUP]:    `[SYSTEM: stage=warmup. Do NOT speak this tag aloud. Your opening is TWO parts — do them in order with no mixing: PART 1: Say only the greeting word "${greetWord}" in ${corrLang} — nothing else, nothing added. PART 2: Immediately continue in German only: "Ich bin AURA. Heute üben wir: ${activeBlueprint.title}." Then ask your first warmup question IN GERMAN. Example: "Wie heißen Sie?" All warmup questions must be in German. Use ${corrLang} only for corrections from this point on.]`,
    [STAGE.TASK]:      `[SYSTEM: stage=task. Do NOT speak this tag aloud. Warmup is complete. You are now in the main scenario: ${activeBlueprint.title}. You play: ${activeBlueprint.role}. Continue the conversation in German — respond to what the student just said and stay in character. Do NOT produce a new opening line. Speak German only. Correct mistakes briefly in ${corrLang}.]`,
    [STAGE.EXPANSION]: `[SYSTEM: stage=expansion. Do NOT speak this. Core task done. Continue in German — push for richer answers, connectors, details. Same scenario.]`,
    [STAGE.WRAPUP]:    `[SYSTEM: stage=wrapup. Do NOT speak this. Close the session warmly in German in 1-2 sentences.]`,
  };

  const anchor = anchors[stageName];
  if (!anchor) return;

  try {
    ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: anchor }] }],
        turnComplete: true,
      },
    }));
  } catch(e) {
    console.warn('[AURA][STAGE] failed to send stage anchor', e);
  }
}

// Called after every completed user turn. Evaluates whether the current stage
// should advance based on blueprint exit conditions.
function tickStageEngine() {
  if (!activeBlueprint || activeBlueprint.programType === 'exam') return;
  if (!_stage.current) return;

  const bp           = activeBlueprint;
  const ip           = bp.interaction_policy  || {};
  const cp           = bp.completion_policy   || {};
  const stageFlow    = bp.stage_flow          || [];
  const userTurns    = canonicalTurns.filter(t => t.speaker === 'user');
  const totalTurns   = userTurns.length;
  const inStageTurns = _stage.userTurnsInStage;

  _stage.userTurnsInStage++;

  if (_stage.current === STAGE.WARMUP) {
    const required = bp.warmup_config?.question_count || 2;
    // Advance after the learner has answered warmup questions (1 turn per question)
    if (inStageTurns >= required) {
      _advanceStage();
    }
    return;
  }

  if (_stage.current === STAGE.TASK) {
    const minTurns = cp.min_user_turns || 6;
    // Advance to expansion once the learner has enough turns and has produced
    // at least one response of 5+ words (basic proxy for task objective met)
    const hasExpanded = userTurns.some(t =>
      t.text.trim().split(/\s+/).filter(Boolean).length >= 5
    );
    if (totalTurns >= minTurns && hasExpanded && !_stage.expansionSignalFired) {
      _stage.expansionSignalFired = true;
      _advanceStage();
    }
    return;
  }

  if (_stage.current === STAGE.EXPANSION) {
    // Advance to wrapup after 3 expansion turns or if total turns near session end
    const wrapupTriggerTurns = (cp.min_user_turns || 6) + 5;
    if (inStageTurns >= 3 || totalTurns >= wrapupTriggerTurns) {
      _advanceStage();
    }
    return;
  }

  // WRAPUP — no auto-advance; session ends via endSession()
}

function _advanceStage() {
  const stageFlow = activeBlueprint?.stage_flow || [];
  const nextIndex = _stage.index + 1;
  if (nextIndex >= stageFlow.length) {
    console.log('[AURA][STAGE] all stages complete — session ready to close');
    return;
  }
  _stage.index = nextIndex;
  enterStage(stageFlow[nextIndex].stage, { auto: true });
}

// Boots the stage engine at session start, entering either warmup or task
// depending on blueprint warmup_config.
function bootStageEngine() {
  if (!activeBlueprint || activeBlueprint.programType === 'exam') return;
  initStageEngine();
  const stageFlow = activeBlueprint.stage_flow || [];
  if (!stageFlow.length) return;
  const firstStage = stageFlow[0].stage;
  enterStage(firstStage, { trigger: 'session_boot' });
}
// ── END STAGE PROGRESSION ENGINE ─────────────────────────────────────────────

function makeSessionEventId(prefix='evt') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}

function pushEvent(type, payload = {}) {
  const entry = {
    id: makeSessionEventId('evt'),
    ts: new Date().toISOString(),
    type,
    payload: payload || {},
  };
  liveEventLog.push(entry);
  return entry;
}

function appendCanonicalTurn(speaker, text, meta = {}) {
  const clean = (text || '').trim();
  if (!clean) return null;
  const bp = activeBlueprint || {};
  const turn = {
    id: makeSessionEventId('turn'),
    ts: new Date().toISOString(),
    speaker,
    text: clean,
    level: meta.level || bp.level || selectedLevel || null,
    mode: meta.mode || bp.mode || selectedSessionMode || null,
    scenarioId: meta.scenarioId || bp.scenarioId || selectedScenario?.id || null,
    ...meta,
  };
  canonicalTurns.push(turn);
  return turn;
}

// ── EVIDENCE COLLECTION ENGINE ───────────────────────────────────────────────
// Phase D — structured evidence gathered turn-by-turn from canonicalTurns.
// collectSessionEvidence() produces a rich evidence record that the scoring
// prompt reads directly. Scoring becomes deterministic from evidence, not a
// single Gemini guess at a raw transcript.

function collectSessionEvidence() {
  // Exclude non-German speech markers — they are system placeholders, not real student turns.
  const userTurns      = canonicalTurns.filter(t => t.speaker === 'user' && !t.nonGerman);
  const assistantTurns = canonicalTurns.filter(t => t.speaker === 'assistant');
  const bp             = activeBlueprint || {};
  const cp             = bp.completion_policy || {};

  // ── Turn length metrics ───────────────────────────────────────────────────
  const userLengths = userTurns.map(t =>
    t.text.trim().split(/\s+/).filter(Boolean).length
  );
  const totalUserWords    = userLengths.reduce((s, n) => s + n, 0);
  const avgTurnLength     = userTurns.length
    ? Number((totalUserWords / userTurns.length).toFixed(2))
    : 0;
  const oneWordTurns      = userLengths.filter(n => n <= 1).length;
  const shortTurns        = userLengths.filter(n => n >= 2 && n <= 3).length;
  const substantialTurns  = userLengths.filter(n => n >= 5).length;
  const longTurns         = userLengths.filter(n => n >= 10).length;

  // ── Connector usage ───────────────────────────────────────────────────────
  const CONNECTORS = ['weil','deshalb','aber','trotzdem','wenn','dann','außerdem','obwohl','denn'];
  const connectorsFound = [];
  userTurns.forEach(t => {
    const lower = t.text.toLowerCase();
    CONNECTORS.forEach(c => {
      const re = new RegExp(`\\b${c}\\b`);
      if (re.test(lower) && !connectorsFound.includes(c)) connectorsFound.push(c);
    });
  });

  // ── Support dependence ────────────────────────────────────────────────────
  // Proxy: assistant turns that contain question marks or known scaffold phrases
  const scaffoldPattern = /genauer|meinen sie|warum passt|könnten sie|versuchen|noch einmal|noch mal/i;
  const scaffoldTurns   = assistantTurns.filter(t => scaffoldPattern.test(t.text)).length;
  const supportRatio    = assistantTurns.length
    ? Number((scaffoldTurns / assistantTurns.length).toFixed(2))
    : 0;
  const dependenceCap   = cp.support_dependence_cap || 0.5;
  const dependenceFlag  = supportRatio > dependenceCap;

  // ── Stage distribution ────────────────────────────────────────────────────
  const stageMap = {};
  userTurns.forEach(t => {
    const s = t.stage || 'unknown';
    stageMap[s] = (stageMap[s] || 0) + 1;
  });

  // ── Self-repair signals ───────────────────────────────────────────────────
  // Proxy: user turn contains unambiguous self-correction signals
  // Deliberately excludes 'also' (common German discourse filler meaning "so/well")
  // and standalone 'nein,' (common discourse marker) — both fire on normal speech.
  const selfRepairCount = userTurns.filter(t =>
    /\bich meine\b|\bwarte\b|\bäh nein\b|\bdas heißt\b|\bich wollte sagen\b/i.test(t.text)
  ).length;

  // ── German sentence count estimate ───────────────────────────────────────
  // Voice transcription produces minimal punctuation, so we use a two-pass approach:
  // 1. Count punctuation-delimited sentences when punctuation is present.
  // 2. Fall back to counting probable clause boundaries via word count chunking
  //    (every ~8 words is treated as roughly one sentence) when no punctuation found.
  const germanSentenceCount = userTurns.reduce((count, t) => {
    const punctCount = (t.text.match(/[.!?]/g) || []).length;
    if (punctCount > 0) return count + punctCount;
    // Fallback: estimate sentences as word groups of ~8 words
    const wordCount = t.text.trim().split(/\s+/).filter(Boolean).length;
    return count + Math.max(1, Math.round(wordCount / 8));
  }, 0);

  // ── Independent response count ────────────────────────────────────────────
  // A response is "independent" if it is 4+ words and not immediately preceded
  // by a scaffold assistant turn. We look up the actual preceding assistant turn
  // by position in canonicalTurns (time-ordered), not by array index alignment.
  let independentCount = 0;
  userTurns.forEach((t) => {
    const words = t.text.trim().split(/\s+/).filter(Boolean).length;
    if (words < 4) return;
    // Find the last assistant turn that appears before this user turn in the canonical log
    const userIdx = canonicalTurns.indexOf(t);
    let prevAssistantText = null;
    for (let ci = userIdx - 1; ci >= 0; ci--) {
      if (canonicalTurns[ci].speaker === 'assistant') {
        prevAssistantText = canonicalTurns[ci].text;
        break;
      }
    }
    const wasScaffolded = prevAssistantText ? scaffoldPattern.test(prevAssistantText) : false;
    if (!wasScaffolded) independentCount++;
  });

  // ── Task completion proxy ─────────────────────────────────────────────────
  const minTurns        = cp.min_user_turns || 6;
  const minExpanded     = cp.min_expanded_responses || 1;
  const taskMet         = userTurns.length >= minTurns && substantialTurns >= minExpanded;

  const evidence = {
    // Turn counts
    totalUserTurns:        userTurns.length,
    totalAssistantTurns:   assistantTurns.length,
    // Length
    avgTurnLength,
    oneWordTurns,
    shortTurns,
    substantialTurns,
    longTurns,
    // Language richness
    connectorsFound,
    connectorCount:        connectorsFound.length,
    germanSentenceCount,
    selfRepairCount,
    // Independence
    independentResponseCount: independentCount,
    supportRatio,
    scaffoldTurns,
    dependenceFlag,
    // Stage distribution
    stageDistribution:     stageMap,
    // Task
    taskCompletionProxy:   taskMet,
    // Raw for backward compat
    clarificationPromptCount: assistantTurns.filter(t => /\?/.test(t.text)).length,
    estimatedIndependentResponseCount: independentCount,
  };

  console.debug('[AURA][EVIDENCE]', evidence);
  return evidence;
}

// Keep computeSessionDerivedMetrics as a thin wrapper for backward compatibility
// (persistSessionProgress and other callers still reference sessionDerivedMetrics).
function computeSessionDerivedMetrics() {
  const ev = collectSessionEvidence();
  sessionDerivedMetrics = {
    totalUserTurns:                    ev.totalUserTurns,
    averageUserTurnLength:             ev.avgTurnLength,
    oneWordUserAnswerCount:            ev.oneWordTurns,
    clarificationPromptCount:          ev.clarificationPromptCount,
    estimatedIndependentResponseCount: ev.estimatedIndependentResponseCount,
    totalAssistantTurns:               ev.totalAssistantTurns,
  };
  return sessionDerivedMetrics;
}
// ── END EVIDENCE COLLECTION ENGINE ───────────────────────────────────────────


function buildSessionBlueprint() {
  if (isExamModeActive()) return buildExamBlueprint();
  const level = selectedLevel || 'A1';
  const mode = selectedSessionMode === 'immersion' ? 'immersion' : 'guided';
  const scenario = selectedScenario;
  if (!scenario) throw new Error('Cannot build session blueprint: selectedScenario is missing.');
  if (!scenario.id) throw new Error('Cannot build session blueprint: scenarioId is missing.');
  if (scenario.level !== level) {
    console.warn('[AURA] scenario/level mismatch detected while building blueprint', { selectedLevel: level, scenarioLevel: scenario.level, scenarioId: scenario.id });
    throw new Error(`Cannot build session blueprint: scenario level ${scenario.level} does not match selected level ${level}.`);
  }

  const policyKey = `${level.toLowerCase()}_${mode}`;
  const policy = BLUEPRINT_POLICIES[policyKey];
  if (!policy) throw new Error(`Cannot build session blueprint: unsupported combination ${level}/${mode}.`);

  const bp = {
    // Identity
    level,
    mode,
    scenarioId: scenario.id,
    scenarioLevel: scenario.level,
    title: scenario.title,
    role: scenario.role,
    desc: scenario.desc,
    emoji: scenario.emoji || null,
    promptProfile: policy.promptProfile,
    // Behavioral contract — read by buildSystemPrompt and the runtime
    warmup_config:       policy.warmup_config,
    interaction_policy:  policy.interaction_policy,
    intervention_policy: policy.intervention_policy,
    stage_flow:          policy.stage_flow,
    completion_policy:   policy.completion_policy,
  };

  console.debug('[AURA] blueprint_built', {
    level: bp.level,
    mode: bp.mode,
    scenarioId: bp.scenarioId,
    promptProfile: bp.promptProfile,
    warmup_enabled: bp.warmup_config.enabled,
    stage_count: bp.stage_flow.length,
    support_lang_usage: bp.interaction_policy.support_language_usage,
    correction_style: bp.interaction_policy.correction_style,
    support_dependence_cap: bp.completion_policy.support_dependence_cap,
  });
  return bp;
}

function validateBlueprint(bp) {
  if (!bp) throw new Error('Session blueprint missing.');
  if (!bp.scenarioId) throw new Error('Session blueprint invalid: scenarioId missing.');
  if (bp.scenarioLevel !== bp.level) throw new Error(`Session blueprint invalid: scenarioLevel mismatch (${bp.scenarioLevel} vs ${bp.level}).`);

  if (bp.programType === 'exam') {
    // Exam-specific validation — every required field must be present and correct type.
    if (!bp.examPart) throw new Error('Exam blueprint invalid: examPart missing.');
    if (!['teil1','teil2','teil3','full_mock'].includes(bp.examPart)) throw new Error(`Exam blueprint invalid: unknown examPart "${bp.examPart}".`);
    if (!bp.examRunType) throw new Error('Exam blueprint invalid: examRunType missing.');
    if (!bp.examinerStyle) throw new Error('Exam blueprint invalid: examinerStyle missing.');
    if (bp.examPart === 'teil1') {
      if (!bp.topicId) throw new Error('Exam blueprint invalid: topicId missing for teil1.');
      if (!Array.isArray(bp.cards) || bp.cards.length === 0) throw new Error('Exam blueprint invalid: cards array missing or empty for teil1 — topic data must have 4 word cards.');
    }
    if (bp.examPart === 'teil2') {
      if (!bp.topicTitle) throw new Error('Exam blueprint invalid: topicTitle missing for teil2.');
      if (!bp.topicId) throw new Error('Exam blueprint invalid: topicId missing for teil2.');
      if (!Array.isArray(bp.corners)) throw new Error('Exam blueprint invalid: corners must be an array for teil2.');
      if (bp.corners.length === 0) throw new Error('Exam blueprint invalid: corners array is empty for teil2 — topic data is missing corner dimensions.');
    }
    return true;
  }

  // Practice blueprint validation
  if (!bp.warmup_config) throw new Error('Session blueprint invalid: warmup_config missing.');
  if (!bp.interaction_policy) throw new Error('Session blueprint invalid: interaction_policy missing.');
  if (!bp.intervention_policy) throw new Error('Session blueprint invalid: intervention_policy missing.');
  if (!bp.stage_flow || !bp.stage_flow.length) throw new Error('Session blueprint invalid: stage_flow missing or empty.');
  if (!bp.completion_policy) throw new Error('Session blueprint invalid: completion_policy missing.');
  return true;
}

function renderSessionLabels() {
  const scenario = activeBlueprint || selectedScenario || {};
  const level = activeBlueprint?.level || selectedLevel || selectedScenario?.level || 'A1';
  const mode = activeBlueprint?.mode || (selectedSessionMode === 'immersion' ? 'immersion' : 'guided');
  const modeLabel = mode === 'exam' ? 'Exam Mode' : (mode === 'immersion' ? 'Immersion' : 'Guided');
  const title = activeBlueprint?.title || scenario.title || '';
  const role = activeBlueprint?.role || scenario.role || '';
  const desc = activeBlueprint?.desc || scenario.desc || '';
  const emoji = activeBlueprint?.emoji || scenario.emoji || '🎭';

  const seshTitle = document.getElementById('sesh-title');
  if (seshTitle) seshTitle.textContent = title;

  const seshSub = document.getElementById('sesh-subtitle');
  if (seshSub) {
    const examMeta = activeBlueprint?.programType === 'exam' ? ` · ${activeBlueprint?.examPart === 'full_mock' ? 'Full Mock' : (activeBlueprint?.examPart === 'teil2' ? 'Teil 2' : 'Teil 1')}` : '';
    seshSub.textContent = `${level} · ${role}${examMeta} · ${modeLabel} · Live Voice`;
  }

  const scoreLabel = document.getElementById('score-scenario-label');
  if (scoreLabel) scoreLabel.textContent = `${title} · ${level} · ${modeLabel} · Live Voice`;

  const roleAvatar = document.getElementById('role-avatar');
  if (roleAvatar) roleAvatar.textContent = emoji;
  const roleName = document.getElementById('role-name');
  if (roleName) roleName.textContent = role ? `The ${role}` : '';
  const roleDesc = document.getElementById('role-description');
  if (roleDesc) roleDesc.textContent = desc;

}

function resolveActiveBlueprint() {
  activeBlueprint = buildSessionBlueprint();
  validateBlueprint(activeBlueprint);
  refreshAuraDebug();
  return activeBlueprint;
}

function tryResolveActiveBlueprint() {
  try {
    return resolveActiveBlueprint();
  } catch (e) {
    activeBlueprint = null;
    refreshAuraDebug();
    return null;
  }
}


function getActiveSessionMode(levelOverride) {
  return selectedSessionMode === 'immersion' ? 'immersion' : 'guided';
}

function getA1SuccessStreak() {
  return parseInt(localStorage.getItem('aura_a1_success_streak') || '0', 10) || 0;
}

function updateSessionModeRecommendation() {
  const rec = document.getElementById('mode-recommendation');
  if (!rec) return;
  const level = activeBlueprint?.level || selectedLevel || selectedScenario?.level || 'A1';
  const streak = getA1SuccessStreak();

  if (level === 'A2') {
    rec.style.display = 'block';
    rec.textContent = selectedSessionMode === 'guided'
      ? 'A2 Guided: build longer connected answers with better connectors, include reasons/details, and complete each task from start to finish.'
      : 'A2 Immersion: expect faster all-German interaction, handle clarifications independently, and recover without support-language rescue.';
    return;
  }

  if (streak >= 3 && selectedSessionMode !== 'immersion') {
    rec.style.display = 'block';
    rec.textContent = 'Great progress. Try Immersion Mode for a faster, mostly-German session.';
  } else if (selectedSessionMode === 'immersion') {
    rec.style.display = 'block';
    rec.textContent = 'Immersion is active. Stay mostly in German and switch to Guided if you want extra support.';
  } else {
    rec.style.display = 'none';
    rec.textContent = '';
  }
}
window.toggleOtherLangInput = () => {
  const wrap = document.getElementById('other-lang-wrap');
  const pill = document.getElementById('other-lang-pill');
  const inp  = document.getElementById('other-lang-input');
  if (!wrap) return;
  const isOpen = wrap.style.display !== 'none';
  if (isOpen) {
    wrap.style.display = 'none';
    if (!selectedLangPref || ['Gujarati','Hindi','English'].indexOf(selectedLangPref) === -1) {
      window.setLangPref('Gujarati');
    }
  } else {
    document.querySelectorAll('.lang-pref-tab').forEach(t => t.classList.remove('active'));
    if (pill) pill.classList.add('active');
    wrap.style.display = 'block';
    if (inp) inp.focus();
    const confirm = document.getElementById('other-lang-confirm');
    if (confirm) confirm.textContent = '';
  }
};

window.applyOtherLang = (val) => {
  const trimmed = val.trim();
  const confirm = document.getElementById('other-lang-confirm');
  if (trimmed.length >= 2) {
    selectedLangPref = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    if (confirm) confirm.textContent = `✓ AURA will explain in ${selectedLangPref}`;
  } else {
    if (confirm) confirm.textContent = '';
  }
};

function restartSessionIfRunning(reason = 'config_changed') {
  const isLive = !!ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);
  if (!isLive) return false;
  try { ws.close(); } catch (e) {}
  ws = null;
  activeBlueprint = null;
  sessionActive = false;
  sessionPaused = false;
  clearSilenceTimer();
  updateListeningPill('idle');
  toast('Settings changed. Restart the session to apply them.');
  console.debug('[AURA] session_restart_required', { reason });
  refreshAuraDebug();
  return true;
}

// ── MISSING HELPERS (migrated from old monolithic HTML) ───────────────────────

/**
 * Returns true when the user has selected exam / mock-test program type.
 * Reads from window.selectedProgramType which store.js exposes on window.
 */
function isExamModeActive() {
  return (selectedProgramType === 'exam') || false;
}

/**
 * Builds a session blueprint for exam / mock-test mode.
 * Reads selectedExamPart, selectedExamRunType, selectedExamTopicId,
 * selectedExaminerStyle from window (all exposed by store.js).
 */
function buildExamBlueprint() {
  const examPart      = selectedExamPart      || 'teil1';
  const examRunType   = selectedExamRunType   || 'practice';
  const examTopicId   = selectedExamTopicId   || null;
  const examinerStyle = selectedExaminerStyle || 'standard';
  const level         = selectedLevel         || 'A2';
  const langPref      = selectedLangPref      || 'English';

  return {
    programType:    'exam',
    examPart,
    examRunType,
    examTopicId,
    examinerStyle,
    level,
    langPref,
    mode:           'guided',
    scenarioId:     `exam_${examPart}`,
    title:          `A2 Exam Mock — ${examPart.toUpperCase()}`,
    role:           'Examiner',
    emoji:          '📝',
    desc:           `Telc A2 exam practice — ${examPart}`,
    interaction_policy: {
      support_language_usage: 'corrections_only',
    },
    stage_sequence: [],
    stage_timings:  {},
  };
}

/**
 * Returns correction language config based on the user's selected support language.
 * Used in stage anchors and system prompt builders.
 */
function buildPromptLanguageConfig() {
  const lang = window.selectedLangPref || selectedLangPref || 'English';
  const greetWords = {
    Gujarati: 'નમસ્તે',
    Hindi:    'नमस्ते',
    English:  'Hello',
    German:   'Hallo',
    French:   'Bonjour',
    Spanish:  'Hola',
    Portuguese: 'Olá',
    Arabic:   'مرحبا',
    Mandarin: '你好',
    Japanese: 'こんにちは',
    Korean:   '안녕하세요',
  };
  return {
    correctionLang: lang,
    greetWord:      greetWords[lang] || 'Hello',
  };
}

/**
 * Updates the debug info panel (#aura-debug) if it exists in the DOM.
 * Silently no-ops when the panel is absent (production dashboard).
 */
function refreshAuraDebug() {
  const panel = document.getElementById('aura-debug');
  if (!panel) return;
  try {
    panel.textContent = JSON.stringify({
      level:    window.selectedLevel,
      mode:     window.selectedSessionMode,
      scenario: window.selectedScenario?.id,
      state:    window.sessionActive ? 'active' : 'idle',
      blueprint: activeBlueprint ? { level: activeBlueprint.level, mode: activeBlueprint.mode, programType: activeBlueprint.programType } : null,
    }, null, 2);
  } catch (e) {}
}

/**
 * Sets the active session mode (guided / immersion).
 * Updates selectedSessionMode and toggles the active class on mode-tab buttons.
 */
function setSessionMode(mode) {
  selectedSessionMode = mode || 'guided';
  window.selectedSessionMode = selectedSessionMode;
  document.querySelectorAll('.mode-tab, [data-mode]').forEach(el => {
    const elMode = el.dataset.mode || el.dataset.value;
    if (elMode) el.classList.toggle('active', elMode === selectedSessionMode);
  });
}

/**
 * Sets the active support/explanation language preference.
 * Updates selectedLangPref and toggles active class on lang-pref-tab buttons.
 */
window.setLangPref = function setLangPref(lang) {
  selectedLangPref = lang || 'English';
  window.selectedLangPref = selectedLangPref;
  document.querySelectorAll('.lang-pref-tab').forEach(el => {
    el.classList.toggle('active', (el.dataset.lang || el.dataset.value) === selectedLangPref);
  });
};

/**
 * Hides all exam-specific overlay elements in the DOM.
 * Safe no-op when those elements don't exist (standard dashboard).
 */
function hideAllExamOverlays() {
  const examOverlayIds = [
    'teil1-overlay', 'teil2-overlay', 'teil3-overlay',
    'exam-overlay', 'exam-brief', 'exam-score-overlay',
  ];
  examOverlayIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.exam-overlay, .teil-overlay').forEach(el => {
    el.style.display = 'none';
  });
}

/**
 * Renders Teil 1 (Karten) exam cards into the exam overlay.
 * No-op when the overlay element is absent.
 */
function renderTeil1Cards(bp) {
  const container = document.getElementById('teil1-overlay') || document.getElementById('exam-overlay');
  if (!container || !bp) return;
  const cards = bp.cards || [];
  container.style.display = 'flex';
  const body = container.querySelector('.teil-body, .exam-body');
  if (body) body.innerHTML = cards.map(c => `<div class="teil-card">${c}</div>`).join('');
}

/**
 * Renders Teil 2 (Bildbeschreibung) card into the exam overlay.
 * No-op when the overlay element is absent.
 */
function renderTeil2Card(bp) {
  const container = document.getElementById('teil2-overlay') || document.getElementById('exam-overlay');
  if (!container || !bp) return;
  container.style.display = 'flex';
  const body = container.querySelector('.teil-body, .exam-body');
  if (body) body.innerHTML = `<div class="teil-card">${bp.topicTitle || 'Teil 2'}</div>`;
}

/**
 * Renders Teil 3 (Terminkalender) calendar into the exam overlay.
 * No-op when the overlay element is absent.
 */
function renderTeil3Calendar(bp) {
  const container = document.getElementById('teil3-overlay') || document.getElementById('exam-overlay');
  if (!container || !bp) return;
  container.style.display = 'flex';
  const body = container.querySelector('.teil-body, .exam-body');
  if (body) {
    const cal = bp.teil3Calendar || {};
    body.innerHTML = `<div class="teil-card">${cal.label || bp.topicTitle || 'Teil 3'}</div>`;
  }
}

/**
 * Renders the recent practice list in the setup screen.
 * No-op stub — the dashboard (ui.js) owns this panel in the new architecture.
 */
function renderRecentPractice(sessions) {
  // Handled by ui.js renderIdleScreen in the new dashboard.
  // This stub prevents ReferenceErrors from goBackToSetup() calls.
}

/**
 * Shows the main speaking / session interface.
 * In the new dashboard architecture this is handled by ui.js;
 * this stub prevents ReferenceErrors from goBackToHomepage().
 */
function _showSpeakingInterface() {
  // ui.js owns navigation in the new dashboard.
  // Dispatch an event so ui.js can react if needed.
  window.dispatchEvent(new CustomEvent('aura:show-speaking-interface'));
}

/**
 * Navigates to the onboarding screen.
 */
function showOnboarding() {
  window.location.href = '/src/app/screens/onboarding.html';
}

// ── PAYWALL HELPERS ───────────────────────────

/**
 * Returns true (and shows the upgrade modal) when a free-tier user has hit
 * their monthly session limit. Returns false if the session is allowed.
 * Reads freeSessionsUsedThisMonth and freeSessionsMonthKey from window.userProfile,
 * which is seeded by session-adapter.js at login time.
 * FREE_SESSION_LIMIT is imported from constants.js.
 */
function checkPaywallGate() {
  const profile          = window.userProfile || {};
  const currentMonthKey  = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const storedKey        = profile.freeSessionsMonthKey ?? null;
  const used             = (storedKey === currentMonthKey)
    ? (profile.freeSessionsUsedThisMonth ?? 0)
    : 0;

  if (used >= (FREE_SESSION_LIMIT ?? 3)) {
    showUpgradeModal();
    return true; // blocked
  }
  return false; // allowed
}

/**
 * Shows the upgrade / paywall modal.
 * Looks for #upgrade-modal or #paywall-modal in the DOM.
 * Safe to call even if neither element exists yet.
 */
function showUpgradeModal() {
  const modal = document.getElementById('upgrade-modal')
             || document.getElementById('paywall-modal');
  if (modal) {
    modal.classList.add('open');
  } else {
    // Fallback toast when modal markup is not yet in the DOM
    toast('You\'ve used your free sessions for this month. Upgrade to continue.');
  }
}

/**
 * Updates the trial badge / session-count indicator in the UI.
 * Safe no-op when the element is absent (paid users, or badge not yet built).
 */
function updateTrialBadge() {
  const badge = document.getElementById('trial-badge')
             || document.getElementById('trialBadge');
  if (!badge) return;

  const profile         = window.userProfile || {};
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const storedKey       = profile.freeSessionsMonthKey ?? null;
  const used            = (storedKey === currentMonthKey)
    ? (profile.freeSessionsUsedThisMonth ?? 0)
    : 0;
  const remaining = Math.max(0, (FREE_SESSION_LIMIT ?? 3) - used);

  badge.textContent = `${remaining} free session${remaining !== 1 ? 's' : ''} left`;
  badge.style.display = isPaidStudent ? 'none' : '';
}

// ── SYSTEM PROMPT ─────────────────────────────

window.startSession = async () => {
  await _doStartSession();
};
window.confirmPrivacyAndStart = async () => {
  document.getElementById('privacy-modal').classList.remove('open');
  await _doStartSession();
};

async function _doStartSession() {
  // Pull latest values from store.js / session-adapter before doing anything.
  _syncFromStore();

  // State machine guard: only allow starting from IDLE.
  if (getSessionState() !== SESSION_STATES.IDLE) {
    console.warn('[AURA][SSM] _doStartSession blocked — session not in IDLE', { current: getSessionState() });
    return;
  }
  transitionSessionState(SESSION_STATES.INITIALIZING, { trigger: '_doStartSession' });

  try {
    if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)({ sampleRate:24000 });
    if (audioCtx.state==='suspended') await audioCtx.resume();
    if (!micCtx) micCtx = new (window.AudioContext||window.webkitAudioContext)();
    if (micCtx.state==='suspended') await micCtx.resume();
    // Push to store.js live binding AND window so worklets.js sees the real context
    setAudioCtx(audioCtx); window.audioCtx = audioCtx;
    setMicCtx(micCtx);     window.micCtx   = micCtx;
  } catch(e){}

  if (!isPaidStudent) {
    // Phase 6: authoritative free-session gate uses freeSessionsUsedThisMonth
    if (checkPaywallGate()) { transitionSessionState(SESSION_STATES.FAILED, { reason: 'trial_limit' }); resetSessionState(); return; }
    updateTrialBadge();
  }

  if (!isExamModeActive()) {
    let resolvedScenario = resolveScenarioForLevel(selectedLevel, selectedScenario?.id || document.getElementById('scenario-select')?.value);
    if (!resolvedScenario) {
      toast(`Cannot start session: no ${selectedLevel} scenario is available.`);
      transitionSessionState(SESSION_STATES.FAILED, { reason: 'no_scenario', level: selectedLevel });
      resetSessionState();
      return;
    }
    const sessionScenarioSel = document.getElementById('scenario-select');
    if (sessionScenarioSel && sessionScenarioSel.value !== resolvedScenario.id) {
      console.warn('[AURA] session start auto-repaired scenario mismatch', {
        level: selectedLevel,
        fromScenarioId: sessionScenarioSel.value,
        toScenarioId: resolvedScenario.id,
      });
      sessionScenarioSel.value = resolvedScenario.id;
    }
    selectedScenario = resolvedScenario;
    if (selectedScenario.level !== selectedLevel) {
      const repaired = resolveScenarioForLevel(selectedLevel, selectedScenario.id);
      if (!repaired) {
        toast(`Cannot start session: scenario level mismatch and no ${selectedLevel} fallback found.`);
        transitionSessionState(SESSION_STATES.FAILED, { reason: 'scenario_level_mismatch', level: selectedLevel });
        resetSessionState();
        return;
      }
      console.warn('[AURA] session start repaired scenario level mismatch', {
        selectedLevel,
        previousScenarioLevel: selectedScenario.level,
        previousScenarioId: selectedScenario.id,
        repairedScenarioId: repaired.id,
      });
      selectedScenario = repaired;
      if (sessionScenarioSel) sessionScenarioSel.value = repaired.id;
    }
  }
  try {
    activeBlueprint = buildSessionBlueprint();
    validateBlueprint(activeBlueprint);
    console.debug('[AURA] session_start_blueprint', activeBlueprint);
    refreshAuraDebug();
  } catch (bpErr) {
    activeBlueprint = null;
    refreshAuraDebug();
    toast(`Cannot start session: ${bpErr.message || 'invalid session setup.'}`);
    transitionSessionState(SESSION_STATES.FAILED, { reason: 'blueprint_invalid', error: bpErr.message });
    resetSessionState();
    return;
  }
  if (!selectedSessionMode) selectedSessionMode = 'guided';
  setSessionMode(selectedSessionMode);

  conversationHistory=[]; wordsUsed=new Set(); errorPatterns={}; currentUserText=''; auraContextBlock='';
  liveEventLog=[]; canonicalTurns=[]; currentUserEntryEl=null;
  sessionDerivedMetrics={
    totalUserTurns:0,
    averageUserTurnLength:0,
    oneWordUserAnswerCount:0,
    clarificationPromptCount:0,
    estimatedIndependentResponseCount:0,
    totalAssistantTurns:0,
  };
  sessionSeconds=20*60; addTimeUsed=false; turnCount=0;
  sessionStartedAt = null;
  _syncToStore();

  // Screen switching — safe for both old monolithic HTML and new dashboard.
  if (_el('speak-setup'))   _el('speak-setup').style.display   = 'none';
  if (_el('speak-session')) _el('speak-session').style.display = 'flex';
  if (_el('speak-score'))   _el('speak-score').style.display   = 'none';
  window.dispatchEvent(new CustomEvent('aura:session-started', { detail: { blueprint: activeBlueprint } }));

  // Exam mode body class + correct overlay per Teil
  const isExam  = activeBlueprint?.programType === 'exam';
  const examPart = activeBlueprint?.examPart || '';
  if (isExam) {
    document.body.classList.add('exam-active');
  } else {
    document.body.classList.remove('exam-active');
    hideAllExamOverlays();
  }
  if (isExam) {
    if (examPart === 'teil2') {
      renderTeil2Card(activeBlueprint);
    } else if (examPart === 'teil1') {
      renderTeil1Cards(activeBlueprint);
    } else if (examPart === 'teil3') {
      renderTeil3Calendar(activeBlueprint);
    }
  }

  const seshEmoji = document.getElementById('sesh-emoji'); if(seshEmoji) seshEmoji.textContent = activeBlueprint?.emoji || selectedScenario?.emoji || '🎭';
  renderSessionLabels();
  const addTimeBtn = document.getElementById('add-time-btn'); if(addTimeBtn) addTimeBtn.disabled = false;
  const convArea = document.getElementById('messagesWrap'); if(convArea) { Array.from(convArea.children).forEach(c => { if(c.id !== 'typingIndicator') c.remove(); }); }

  const boardIdle = document.getElementById('board-idle');
  if (boardIdle) { boardIdle.style.display = 'block'; }
  updateWordCount();
  updateNavTimer();

  updateSessionModeRecommendation();

  const inputArea = document.getElementById('input-area');
  if (selectedInputMode==='voice') { if(inputArea) inputArea.style.display='none'; }
  else { if(inputArea) inputArea.style.display='flex'; }

  sessionTimerInterval = setInterval(()=>{ sessionSeconds--; updateTimer(); if(sessionSeconds<=0) endSession(); },1000);
  updateListeningPill('thinking');

  try {
    // Get mic permission
    if (!micStream) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true} });
      } catch(micErr) {
        throw new Error('Microphone access denied. Please allow mic access and retry.');
      }
    }
    setMicStream(micStream); window.micStream = micStream;
    playbackNode = await ensurePlaybackWorklet(audioCtx);
    setPlaybackNode(playbackNode); window.playbackNode = playbackNode;


    // Fetch student memory context before opening session
    try {
      const _memIdToken = currentUser ? await getIdToken(currentUser) : null;
      if (_memIdToken) {
        const _memMode = activeBlueprint?.programType === 'exam' ? 'exam'
          : activeBlueprint?.mode === 'immersion' ? 'partner'
          : 'tutor';
        const _memResp = await fetch(`${WORKER_URL}/session-start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: _memIdToken, mode: _memMode })
        });
        if (_memResp.ok) {
          const _memData = await _memResp.json();
          auraContextBlock = _memData.contextBlock || '';
          console.log('[AURA] Memory context loaded:', !!auraContextBlock);
        }
      }
    } catch (_memErr) {
      console.warn('[AURA] session-start failed (non-fatal):', _memErr.message);
      auraContextBlock = '';
    }

    // Fetch API token from Cloudflare Worker
    let token;
    try {
      const idToken = currentUser ? await getIdToken(currentUser) : null;
if (!idToken) throw new Error('You must be signed in to start a session.');
const resp = await fetch(`${WORKER_URL}/token`, {
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({ idToken })
});
      if (!resp.ok) {
        const errBody = await resp.json().catch(()=>({}));
        // Phase 6: server-side paywall — limit enforced at /token level
        if (resp.status === 403 && errBody.upgrade) {
          showUpgradeModal();
          transitionSessionState(SESSION_STATES.FAILED, { reason: 'trial_limit' }); resetSessionState();
          return;
        }
        throw new Error(`Worker error ${resp.status}: ${errBody.error || resp.statusText}`);
      }
      const data = await resp.json();
      token = data.token;
      if (!token) throw new Error('Worker returned no token. Check GEMINI_API_KEY secret in Cloudflare.');
    } catch(fetchErr) {
      if (fetchErr.message.startsWith('Worker error') || fetchErr.message.includes('token')) throw fetchErr;
      throw new Error('Cannot reach AURA server. Check Worker CORS settings — add your Pages domain to ALLOWED_ORIGINS.');
    }

    // Open Gemini WebSocket
    updateListeningPill('thinking');
ws = new WebSocket(`${GEMINI_WS_EPHEMERAL}?access_token=${encodeURIComponent(token)}`); setWs(ws); window.ws = ws;
     ws.binaryType = 'arraybuffer';
    // Timeout if WS doesn't open in 10s
    const wsTimeout = setTimeout(()=>{
      if (!sessionActive) {
        toast('Connection timed out. Check your API key is valid.');
        cleanupLive(); goBackToSetup();
      }
    }, 10000);

    ws.onopen = async () => {
      clearTimeout(wsTimeout);
      let systemPromptText;
      try {
        systemPromptText = buildSystemPrompt(activeBlueprint, selectedLangPref, auraContextBlock);
      } catch (promptErr) {
        toast(`Session configuration error: ${promptErr.message}`);
        console.error('[AURA] buildSystemPrompt failed in ws.onopen:', promptErr);
        cleanupLive();
        goBackToSetup();
        transitionSessionState(SESSION_STATES.FAILED, { reason: 'prompt_build_failed', error: promptErr.message });
        resetSessionState();
        return;
      }
      ws.send(JSON.stringify({
        setup:{
          model:MODEL,
          generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Zephyr'}}}},
          inputAudioTranscription:{},
          outputAudioTranscription:{},
          systemInstruction:{parts:[{text:systemPromptText}]}
        }
      }));
      workletNode = await createWorklet(micCtx, micStream, {
        onAudioChunk: (buffer) => {
          if (micMuted) return;
          // Forward to Gemini Live
          if (ws && ws.readyState === WebSocket.OPEN) {
            const bytes  = new Uint8Array(buffer);
            let binary   = '';
            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
            const b64 = btoa(binary);
            ws.send(JSON.stringify({
              realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: b64 }] }
            }));
          }
          // Forward to Deepgram for transcription
          if (dgWs && dgWs.readyState === WebSocket.OPEN) {
            dgWs.send(buffer);
          }
        }
      });
      setWorkletNode(workletNode); window.workletNode = workletNode;
      sessionStartedAt = new Date();
      sessionActive = true; setSessionActive(true); window.sessionActive = true;
      window._geminiStreamEl = null; // reset any stale Gemini fallback bubble from prior session
      _syncToStore();
      transitionSessionState(SESSION_STATES.READY, { trigger: 'ws_onopen' });
      transitionSessionState(SESSION_STATES.TASK_ACTIVE, { trigger: 'ws_onopen_auto_advance' });
      updateListeningPill('listening');
      // Gemini's inputAudioTranscription is the transcription source — no Deepgram needed
      logAnalyticsEvent('session_started', {
        level: activeBlueprint.level,
        scenarioId: activeBlueprint.scenarioId,
        mode: activeBlueprint.mode,
        inputMode: selectedInputMode || 'voice',
      }).catch(()=>{});

      if (window._keepAlive) clearInterval(window._keepAlive);
      window._keepAlive = setInterval(()=>{
        if (ws&&ws.readyState===WebSocket.OPEN&&sessionActive){
          try{ws.send(JSON.stringify({realtimeInput:{mediaChunks:[]}}));}catch(e){}
        } else clearInterval(window._keepAlive);
      },8000);
    };
    ws.onmessage = (event) => {
      try{
        const txt = event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : event.data;
        handleServerMessage(JSON.parse(txt));
      }catch(e){}
    };
    ws.onerror = (e) => { toast('WebSocket error — session could not connect.'); };
    ws.onclose = (e) => {
      clearTimeout(wsTimeout);
      if (sessionActive || e.code !== 1000) handleSessionClose(e.code, e.reason || 'socket_closed');
    };
  } catch(err) {
    updateListeningPill('idle');
    toast('⚠️ ' + (err.message||'Failed to start. Please retry.'));
    transitionSessionState(SESSION_STATES.FAILED, { reason: 'connection_error', error: err.message });
    resetSessionState();
    goBackToSetup();
  }
}

// ── WORKLETS ──────────────────────────────────

function handleServerMessage(msg) {
  if (msg.setupComplete!==undefined) {
    updateListeningPill('thinking');
    const bp = activeBlueprint;
    if (!bp) {
      toast('Session configuration missing. Please restart the session.');
      return;
    }
    if(ws&&ws.readyState===WebSocket.OPEN){
      if (bp.programType === 'exam') {
        const isPractice = bp.examRunType !== 'scored';
        const teilLabel = bp.examPart === 'teil2' ? 'Teil 2' : bp.examPart === 'teil3' ? 'Teil 3' : 'Teil 1';
        const lang = buildPromptLanguageConfig();

        if (isPractice) {
          // Exam mode: send the explanation directly as first message in support language
          const cards = bp.cards ? bp.cards.join(', ') : '';
          const corners = bp.corners ? bp.corners.join(', ') : '';
          const topic = bp.topicTitle || '';
          const cal = bp.teil3Calendar;

          let explanation = '';
          if (bp.examPart === 'teil1') {
            explanation = `In ${lang.correctionLang}, say 1-2 sentences only — nothing more: "I am AURA. We practice Teil 1 — you have 4 cards on screen: ${cards}. For each card ask me a question in German, I answer, then I ask you back. Ask your first question." Then STOP speaking in ${lang.correctionLang} immediately and wait silently for the student's first German question.`;
          } else if (bp.examPart === 'teil2') {
            explanation = `In ${lang.correctionLang}, say 1-2 sentences only — nothing more: "I am AURA. We practice Teil 2 — your topic is '${topic}', the 4 corner points are: ${corners}. Speak for 2 to 3 minutes covering all corners. Start when ready." Then STOP speaking in ${lang.correctionLang} immediately and wait in complete silence.`;
          } else if (bp.examPart === 'teil3') {
            const task = cal ? cal.task : 'etwas planen';
            const day = cal ? cal.day : '';
            explanation = `In ${lang.correctionLang}, say 1-2 sentences only — nothing more: "I am AURA. We practice Teil 3 — we need a free time on ${day} to: ${task}. Your calendar is on screen, mine is different. Ask me when I have time." Then switch to German immediately and wait for the student to propose a time.`;
          } else if (bp.examPart === 'full_mock') {
            explanation = `In ${lang.correctionLang}, say 1-2 sentences only: "I am AURA. We are doing a full A2 Sprechen mock — Teil 1, Teil 2, and Teil 3 in sequence. Start with Teil 1: you have 4 cards on screen. Ask me your first question." Then STOP speaking in ${lang.correctionLang} immediately and wait silently.`;
          }

          ws.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text:explanation}]}],turnComplete:true}}));
        } else {
          // Mock test: German only, cold start
          ws.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text:`Prüfung beginnt jetzt. Sie führen ${teilLabel} durch. Sprechen Sie ausschließlich Deutsch. Beginnen Sie sofort mit Ihrer Eröffnungsformel gemäß Systemauftrag.`}]}],turnComplete:true}}));
        }
      } else {
        // Practice sessions: boot the stage engine now that Gemini is ready.
        bootStageEngine();
      }
    }
  }
  if(msg.serverContent){
    const sc=msg.serverContent;

    if(sc.modelTurn?.parts){
      sc.modelTurn.parts.forEach(part=>{
        if(part.inlineData?.mimeType?.startsWith('audio/')){
          // Flush any buffered student speech before AURA starts speaking
          if (typeof window._flushDgBuffer === 'function') window._flushDgBuffer();
          updateListeningPill('speaking');
          clearSilenceTimer();
          enqueueAudio(playbackNode, part.inlineData.data);
        }
      });
    }
    // inputTranscription: Gemini transcribes exactly what the user said, including mistakes.
    // Gemini sends interim events (finished: false) while the user speaks,
    // and a final event (finished: true) when the utterance ends.
    if (sc.inputTranscription) {
      const geminiText = (sc.inputTranscription.text || '').trim();
      // Gemini uses "finished", older builds used "isFinal" — accept both
      const isFinal = !!(sc.inputTranscription.finished || sc.inputTranscription.isFinal);

      if (!geminiText) return;

      // Filter out non-Latin script (Arabic, Bengali etc.) — happens when Gemini
      // confuses the audio language. Show a mic placeholder instead of garbled text.
      const looksLatin = /^[\u0000-\u024F\s.,!?'"()\-–—0-9]+$/.test(geminiText);
      const displayText = looksLatin ? geminiText : '🎤 [Speaking...]';

      if (!isFinal) {
        // Interim: show live word-by-word as the user speaks
        if (!window._geminiStreamEl) window._geminiStreamEl = _createStudentEntry();
        _updateStudentEntry(window._geminiStreamEl, displayText);
      } else {
        // Final: lock in the bubble and drive the stage engine
        if (window._geminiStreamEl) {
          _updateStudentEntry(window._geminiStreamEl, displayText);
          _finaliseStudentEntry(window._geminiStreamEl);
          window._geminiStreamEl = null;
        } else {
          _renderStudentBubble(displayText);
        }
        const historyText = looksLatin ? geminiText : '[voice input]';
        conversationHistory.push({ role: 'user', content: historyText });
        historyText.toLowerCase().split(/\s+/).forEach(w => {
          const c = w.replace(/[^a-zäöüß]/gi, '');
          if (c.length > 2) wordsUsed.add(c);
        });
        updateWordCount();
        pushEvent('user_transcript_final', { text: historyText, inputMode: 'voice' });
        appendCanonicalTurn('user', historyText, { stage: getCurrentStage() });
        tickStageEngine();
      }
    }

    if(sc.outputTranscription?.text){
      const chunk=sc.outputTranscription.text;
      currentAiText+=chunk;
      // Strip ##STUDENT## tag from live display while streaming
      const displayText = currentAiText.replace(/##STUDENT##[\s\S]*?##END##/g,'').replace(/##CORRECTION##[\s\S]*?##END##/g,'').trim();
      if(displayText){
        if(!currentAiEntryEl) currentAiEntryEl=createMsgEntry();
        updateMsgEntry(currentAiEntryEl, displayText);
      }
    }
    if(sc.turnComplete){
      // Force-finalise any pending Gemini fallback bubble so it doesn't bleed into next turn
      if (window._geminiStreamEl) {
        _finaliseStudentEntry(window._geminiStreamEl);
        window._geminiStreamEl = null;
      }
      if(currentAiText.trim()){
        const fullText = currentAiText.trim();

        // Strip silent metadata tags from AURA's display text
        const auraText = fullText
          .replace(/##STUDENT##[\s\S]*?##END##/g,'')
          .replace(/##CORRECTION##[\s\S]*?##END##/g,'')
          .trim();
        const textToStore = auraText || fullText;

        // Parse ##CORRECTION## tag for correction card
        const corrMatch = fullText.match(/##CORRECTION##([\s\S]*?)##END##/);
        if (corrMatch) {
          const corrRaw = corrMatch[1].trim();
          if (corrRaw && corrRaw !== 'none') {
            try {
              const corr = JSON.parse(corrRaw);
              if (corr.right) showStructuredCorrection(corr.wrong || '', corr.right, corr.note || '');
            } catch(e) {
              detectAndShowCorrection(auraText);
            }
          }
        }
        // Student speech is captured via inputTranscription handler — no ##STUDENT## needed

        // AURA bubble on the LEFT
        pushEvent('assistant_transcript_final', {
          text: textToStore,
          scenarioId: activeBlueprint?.scenarioId || selectedScenario?.id || null,
        });
        appendCanonicalTurn('assistant', textToStore, { stage: getCurrentStage() });
        if(currentAiEntryEl){
          updateMsgEntry(currentAiEntryEl, textToStore);
          finaliseMsgEntry(currentAiEntryEl);
        }
        currentAiEntryEl=null;
        conversationHistory.push({role:'assistant', content:textToStore});
        // Correction handled by ##CORRECTION## tag parser above
        currentAiText=''; turnCount++;
      }
      updateListeningPill('listening');
      if(!micMuted) startSilenceTimer();
    }
    if(sc.interrupted){ updateListeningPill(micMuted?'idle':'listening'); }
  }
  if(msg.error) toast('API Error: '+(msg.error.message||JSON.stringify(msg.error)));
}

// ── UI STATE ──────────────────────────────────
function updateListeningPill(state) { updateAuraState(state); }

function updateAuraState(state) {
  const pill = document.getElementById('aura-state-pill');
  const txt  = document.getElementById('aura-state-text');
  const micBtnEl = document.getElementById('mic-btn');
  if (!pill || !txt) return;
  pill.className = 'aura-state-pill';
  if (state === 'speaking') {
    pill.classList.add('speaking');
    txt.innerHTML = '<span class="state-wave"><span></span><span></span><span></span><span></span><span></span></span> AURA speaking';
  } else if (state === 'listening') {
    pill.classList.add('listening');
    txt.innerHTML = '<span class="state-wave"><span></span><span></span><span></span><span></span><span></span></span> Listening…';
    if(micBtnEl){micBtnEl.classList.add('active');micBtnEl.classList.remove('muted');micBtnEl.textContent='🎙';}
  } else if (state === 'thinking') {
    pill.classList.add('thinking');
    txt.textContent = 'AURA thinking…';
  } else {
    txt.textContent = micMuted ? 'Mic muted' : 'Ready';
  }
  if (micMuted && state !== 'speaking' && state !== 'thinking') {
    pill.className = 'aura-state-pill';
    txt.textContent = 'Mic muted';
  }
}

function setDeepgramStatusVisible(visible) {
  const el = document.getElementById('deepgram-status');
  if (el) el.style.display = visible ? 'block' : 'none';
}

// ── BLACKBOARD ────────────────────────────────
function showStructuredCorrection(wrong, right, note) {
  // Show on blackboard
  showOnBlackboard(wrong, right, note);

}

function showOnBlackboard(wrong, right, note) {
  const area = document.getElementById('blackboard-area');
  const idleEl = document.getElementById('board-idle');
  if (!area) return;
  if (chalkEraseTimer) { clearTimeout(chalkEraseTimer); chalkEraseTimer = null; }
  const old = area.querySelector('.board-correction');
  if (old) old.remove();
  if (idleEl) idleEl.style.display = 'none';
  const card = document.createElement('div');
  card.className = 'board-correction';
  card.style.cssText = 'padding:12px 14px;background:rgba(255,80,80,0.08);border-radius:10px;border-left:3px solid #e05;font-size:13px;line-height:1.5;margin-bottom:8px;';
  card.innerHTML = (wrong ? `<div style="text-decoration:line-through;color:#e05;margin-bottom:4px;">${escHtml(wrong)}</div>` : '') +
    `<div style="font-weight:700;color:#1a1a1a;">✓ ${escHtml(right)}</div>` +
    (note ? `<div style="color:#666;font-size:12px;margin-top:4px;">${escHtml(note)}</div>` : '');
  area.appendChild(card);
  chalkEraseTimer = setTimeout(() => {
    card.style.opacity = '0';
    card.style.transition = 'opacity 0.7s';
    setTimeout(() => { card.remove(); if (idleEl) idleEl.style.display = 'block'; }, 700);
  }, 14000);
}

function updateWordCount() {
  const el = document.getElementById('word-count-num');
  const elDesk = document.getElementById('word-count-num-desk');
  if (el) el.textContent = wordsUsed.size;
  if (elDesk) elDesk.textContent = wordsUsed.size;
}

window.requestHint = () => {
  if (!activeBlueprint || !ws || ws.readyState !== WebSocket.OPEN) { toast('Session not active.'); return; }
  updateAuraState('thinking');
  ws.send(JSON.stringify({
    clientContent: {
      turns: [{ role: 'user', parts: [{ text: `Give me a quick vocabulary hint for this scenario in ${selectedLangPref}. Just one useful German word or phrase I might need next, with its meaning. Keep it very brief.` }] }],
      turnComplete: true
    }
  }));
};

// ── MESSAGE RENDERING ─────────────────────────────────────────────────────────
// Uses the dashboard's actual DOM: id="messagesWrap", typingIndicator,
// CSS classes: .msg.ai/.msg.me, .msg-label, .bubble

function _getWrap() {
  return document.getElementById('messagesWrap');
}
function _scrollBottom() {
  const w = _getWrap();
  if (w) w.scrollTop = w.scrollHeight;
}
function _insertBeforeTyping(el) {
  const wrap    = _getWrap(); if (!wrap) return;
  const typing  = document.getElementById('typingIndicator');
  typing ? wrap.insertBefore(el, typing) : wrap.appendChild(el);
  _scrollBottom();
}

// Creates a streaming AURA bubble and returns the element.
function createMsgEntry() {
  const div = document.createElement('div');
  div.className = 'msg ai';
  div.innerHTML = '<div class="msg-label">AURA</div><div class="bubble streaming"></div>';
  _insertBeforeTyping(div);
  return div;
}
function updateMsgEntry(el, text) {
  const b = el?.querySelector('.bubble');
  if (b) b.textContent = text;
  _scrollBottom();
}
function finaliseMsgEntry(el) {
  el?.querySelector('.bubble')?.classList.remove('streaming');
}

// Creates a streaming student bubble and returns the element.
function _createStudentEntry() {
  const div = document.createElement('div');
  div.className = 'msg me streaming';
  div.innerHTML = '<div class="msg-label">YOU</div><div class="bubble"></div>';
  _insertBeforeTyping(div);
  return div;
}
function _updateStudentEntry(el, text) {
  const b = el?.querySelector('.bubble');
  if (b) b.textContent = text;
  _scrollBottom();
}
function _finaliseStudentEntry(el) {
  el?.classList.remove('streaming');
}

// Renders a finalised student bubble (used by Deepgram flush).
function _renderStudentBubble(text) {
  if (!text) return;
  const div = document.createElement('div');
  div.className = 'msg me';
  div.innerHTML = `<div class="msg-label">YOU</div><div class="bubble">${escHtml(text)}</div>`;
  _insertBeforeTyping(div);
}
async function initDeepgramSTT() {
  try {
    setDeepgramStatusVisible(false);
    dgClosingByApp = false;

    // ── Step 1: Supabase auth token ───────────────────────────────────────────
    const idToken = currentUser ? await getIdToken(currentUser) : null;
    if (!idToken) {
      console.warn('[Deepgram] no idToken — skipping STT');
      setDeepgramStatusVisible(true);
      return;
    }

    // ── Step 2: Exchange Supabase token for a short-lived Deepgram grant token ─
    // The worker handles auth and calls Deepgram's /v1/auth/grant endpoint.
    // We never touch the real Deepgram API key on the client side.
    let dgGrantToken;
    try {
      const tokenRes = await fetch(`${DEEPGRAM_WORKER_URL}/deepgram-token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ idToken }),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        throw new Error(`HTTP ${tokenRes.status}: ${err}`);
      }
      const data = await tokenRes.json();
      dgGrantToken = data.token;
      if (!dgGrantToken) throw new Error('No token in worker response');
    } catch (e) {
      console.warn('[Deepgram] ❌ failed to get grant token:', e.message);
      setDeepgramStatusVisible(true);
      return;
    }

    // ── Step 3: Connect DIRECTLY to Deepgram (no Cloudflare proxy) ───────────
    //
    // smart_format: false  → output exactly what was acoustically heard
    // punctuate:    false  → no punctuation guessing / autocorrection
    // This is critical for a language tutor: if a student says the wrong word,
    // we must display the wrong word so they can see and learn from the mistake.
    const dgParams = new URLSearchParams({
      model:            'nova-3',
      language:         'de',
      smart_format:     'false',   // ← exact phonetic output — no autocorrect
      punctuate:        'false',   // ← no punctuation guessing
      profanity_filter: 'false',   // ← never censor mispronounced words
      encoding:         'linear16',
      sample_rate:      '16000',
      channels:         '1',
      interim_results:  'true',    // ← live word-by-word display
      endpointing:      '400',     // ms of silence to detect end of utterance
      utterance_end_ms: '1000',
    });

    // Authenticate using WebSocket subprotocol — the only browser-compatible
    // method (browsers cannot set Authorization headers on WebSocket connections)
    dgWs = new WebSocket(
      `wss://api.deepgram.com/v1/listen?${dgParams.toString()}`,
      ['token', dgGrantToken]
    );
    dgWs.binaryType = 'arraybuffer';

    dgWs.onopen = () => {
      console.log('[Deepgram] ✅ connected directly to Deepgram nova-3');
      setDeepgramStatusVisible(false);
    };

    dgWs.onerror = (e) => {
      console.warn('[Deepgram] ❌ connection error', e);
      setDeepgramStatusVisible(true);
    };

    dgWs.onclose = (ev) => {
      console.log(`[Deepgram] closed — code ${ev.code} "${ev.reason}"`);
      const wasUnexpected = sessionActive && !dgClosingByApp;
      dgWs = null;
      dgClosingByApp = false;
      if (wasUnexpected) {
        setDeepgramStatusVisible(true);
        // Auto-reconnect after 2 s if session is still running
        setTimeout(() => {
          if (sessionActive && !dgWs) {
            console.log('[Deepgram] attempting reconnect...');
            initDeepgramSTT();
          }
        }, 2000);
      }
    };

    // ── Buffers & live streaming bubble ──────────────────────────────────────
    let _dgBuffer = '';   // confirmed words since last flush
    let _streamEl = null; // the live "YOU" bubble element

    dgWs.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);

        if (msg.type === 'Results') {
          const text        = (msg.channel?.alternatives?.[0]?.transcript || '').trim();
          const isFinal     = msg.is_final;
          const speechFinal = msg.speech_final;

          if (!text || !sessionActive || micMuted) return;

          if (!isFinal) {
            // Interim result: show word-by-word as user speaks
            if (!_streamEl) _streamEl = _createStudentEntry();
            _updateStudentEntry(_streamEl, (_dgBuffer ? _dgBuffer + ' ' : '') + text);
          } else {
            // Final word confirmed by Deepgram: lock into buffer
            _dgBuffer = _dgBuffer ? _dgBuffer + ' ' + text : text;
            if (_streamEl) _updateStudentEntry(_streamEl, _dgBuffer);
          }

          if (speechFinal && _dgBuffer.trim()) _flushDgBuffer();
        }

        if (msg.type === 'UtteranceEnd') {
          // Speaker paused long enough — flush whatever we have
          _flushDgBuffer();
        }

      } catch (_) { /* ignore malformed frames */ }
    };

    // Called by the inputTranscription handler when Deepgram is ONLINE:
    // Gemini's transcript is used only to detect non-German speech, not for display.
    window._onGeminiSpeechDetected = function (geminiText) {
      if (_dgBuffer) { _flushDgBuffer(); return; }
      if (geminiText && geminiText.length > 2 && sessionActive && !micMuted) {
        const marker = '[non-German speech detected]';
        _renderStudentBubble('⚠️ ' + marker);
        conversationHistory.push({ role: 'user', content: marker });
        appendCanonicalTurn('user', marker, { stage: getCurrentStage(), nonGerman: true });
        tickStageEngine();
      }
    };

    function _flushDgBuffer() {
      const text = _dgBuffer.trim();
      _dgBuffer = '';
      if (_streamEl) {
        if (text) _updateStudentEntry(_streamEl, text);
        _finaliseStudentEntry(_streamEl);
        _streamEl = null;
      } else if (text) {
        _renderStudentBubble(text);
      }
      if (!text || !sessionActive || micMuted) return;
      conversationHistory.push({ role: 'user', content: text });
      text.toLowerCase().split(/\s+/).forEach(w => {
        const c = w.replace(/[^a-zäöüß]/gi, '');
        if (c.length > 2) wordsUsed.add(c);
      });
      updateWordCount();
      pushEvent('user_transcript_final', { text, inputMode: 'voice' });
      appendCanonicalTurn('user', text, { stage: getCurrentStage() });
      tickStageEngine();
    }
    window._flushDgBuffer = _flushDgBuffer;

  } catch (err) {
    console.error('[Deepgram] initDeepgramSTT fatal:', err);
    setDeepgramStatusVisible(true);
  }
}
// ── CORRECTION DETECTION ─────────────────────
function detectAndShowCorrection(text) {
  if (!text || text.length < 10) return;
  let wrong = '', right = '', note = '';

  const p0 = text.match(/[Tt]ry\s*:\s*([^.!?\n]{3,60})/);
  if (p0) right = p0[1].trim();

  if (!right) {
    const p0b = text.match(/(?:probier(?:\s+es)?|say|sag(?:\s+es)?)\s*:\s*([^.!?\n]{3,60})/i);
    if (p0b) right = p0b[1].trim();
  }

  if (!right) {
    const p1 = text.match(/nicht\s+["""»]?([^,»"""]{1,30})["""«]?,?\s+sondern\s+["""»]?([^.!»"""]{1,30})["""«]?/i);
    if (p1) { wrong = p1[1].trim(); right = p1[2].trim(); }
  }

  if (!wrong) {
    const p2 = text.match(/(?:man sagt|sag(?:en Sie)?|heißt(?:\s+es)?)\s+["""»]?([^,»"""]{1,30})["""«]?,?\s+nicht\s+["""»]?([^.!»"""]{1,30})["""«]?/i);
    if (p2) { right = p2[1].trim(); wrong = p2[2].trim(); }
  }

  if (!right) {
    const p3 = text.match(/(?:richtig(?:\s+ist|\s+wäre)?|korrekt(?:\s+ist|\s+wäre)?|correct(?:\s+is)?)\s*[:\-–]?\s*["""»]?([^.!»"""]{2,40})["""«]?/i);
    if (p3) right = p3[1].trim();
  }

  if (!right) {
    const corrKeywords = /(?:nicht|falsch|Fehler|korrig|verbessern|statt|instead|should be|should say|verwende|benutze|use|sagen)/i;
    if (corrKeywords.test(text)) {
      const quoted = [...text.matchAll(/["""»]([^"""»]{1,35})["""«]/g)];
      if (quoted.length >= 2) { wrong = quoted[0][1].trim(); right = quoted[1][1].trim(); }
      else if (quoted.length === 1) { right = quoted[0][1].trim(); }
    }
  }

  const hasJetztDu = /jetzt\s+du|sag\s+es\s+nochmal|try\s+again|nochmal\s+versuch|pan german|auf deutsch|in german/i.test(text);

  if (!right) {
    const p6 = text.match(/([^→\->]{1,25})\s*[→\->]+\s*([^.!,]{1,25})/);
    if (p6) { wrong = p6[1].trim(); right = p6[2].trim(); }
  }

  const sentences = text.split(/(?<=[.!?])\s+/);
  const noteKeywords = /(?:artikel|article|verb|dativ|akkusativ|nominativ|gender|plural|singular|ending|form|position|order|maskulin|feminin|neutral|falsch|fehler|korrekt|regel|rule|weil|because|sentence|satz|vollständig|complete|incomplete)/i;
  const noteSentence = sentences.find(s => noteKeywords.test(s) && s.trim().length > 8 && s.trim().length < 200);
  note = noteSentence ? noteSentence.trim() : '';

  const hasContent = (right && right.length > 1) || (wrong && wrong.length > 1) || (note && note.length > 5) || hasJetztDu;
  if (!hasContent) return;

  wrong = wrong.replace(/[.!?,;]+$/, '').trim();
  right = right.replace(/[.!?,;]+$/, '').trim();

  showOnBlackboard(wrong, right, note);

}

window.dismissCorrection=()=>{clearTimeout(correctionTimeout);};

// ── MIC ───────────────────────────────────────
window.toggleMic=()=>{
  micMuted=!micMuted;
  const btn=document.getElementById('mic-btn');
  if(btn){btn.classList.toggle('muted',micMuted);btn.classList.toggle('active',!micMuted);btn.textContent=micMuted?'🔇':'🎙';}
  if(micMuted) clearSilenceTimer();
  else startSilenceTimer();
};

// ── SILENCE DETECTION ─────────────────────────
function startSilenceTimer(){
  clearSilenceTimer(); if(!sessionActive||sessionPaused) return;
  let remaining=Math.floor(SILENCE_MS/1000);
  const countdownEl=document.getElementById('silence-countdown');
  const countdownTxt=document.getElementById('silence-countdown-text');
  silenceCountdownInterval=setInterval(()=>{
    remaining--;
    if(remaining<=10&&remaining>0){if(countdownEl)countdownEl.style.display='block';if(countdownTxt)countdownTxt.textContent=remaining+'s';}
    if(remaining<=0){clearInterval(silenceCountdownInterval);if(countdownEl)countdownEl.style.display='none';}
  },1000);
  silenceTimer=setTimeout(()=>{
    clearInterval(silenceCountdownInterval);
    const el=document.getElementById('silence-countdown');if(el)el.style.display='none';
    pauseForSilence();
  },SILENCE_MS);
}
function resetSilenceTimer(){
  if(!sessionActive||sessionPaused) return;
  lastUserSpeechTime=Date.now(); clearSilenceTimer();
  startSilenceTimer();
}
function clearSilenceTimer(){
  if(silenceTimer){clearTimeout(silenceTimer);silenceTimer=null;}
  if(silenceCountdownInterval){clearInterval(silenceCountdownInterval);silenceCountdownInterval=null;}
  const el=document.getElementById('silence-countdown');if(el)el.style.display='none';
}
function pauseForSilence(){
  if(!sessionActive||sessionPaused) return;
  sessionPaused=true; clearSilenceTimer(); clearInterval(sessionTimerInterval);
  document.getElementById('silence-modal').classList.add('open');
  updateListeningPill('idle');
}
window.resumeSession=()=>{
  document.getElementById('silence-modal').classList.remove('open');
  sessionPaused=false;
  sessionTimerInterval=setInterval(()=>{sessionSeconds--;updateTimer();if(sessionSeconds<=0)endSession();},1000);
  if(ws&&ws.readyState===WebSocket.OPEN){
    updateListeningPill('thinking');
    ws.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text:'I am back. Please continue where we left off.'}]}],turnComplete:true}}));
  } else { updateListeningPill('listening'); startSilenceTimer(); }
  toast('Session resumed!');
};

// ── TIMER ─────────────────────────────────────
function updateTimer(){
  const m=Math.floor(sessionSeconds/60).toString().padStart(2,'0');
  const s=(sessionSeconds%60).toString().padStart(2,'0');
  const el=document.getElementById('session-timer');
  const str=`${m}:${s}`;
  if(el){el.textContent=str;el.classList.toggle('warn',sessionSeconds<120);}
}
function updateNavTimer(){
  const el=document.getElementById('session-timer');
  const m=Math.floor(sessionSeconds/60).toString().padStart(2,'0');
  const s=(sessionSeconds%60).toString().padStart(2,'0');
  if(el) el.textContent=`${m}:${s}`;
}

window.addTime=()=>{
  if(addTimeUsed){toast('You can only add time once.');return;}
  sessionSeconds+=10*60; addTimeUsed=true;
  const _atb=document.getElementById('add-time-btn'); if(_atb)_atb.disabled=true;
  toast('+10 minutes added');
};

// ── SEND TEXT ─────────────────────────────────
window.sendTextMessage=()=>{
  const inp=document.getElementById('chatInput') || document.getElementById('text-input') || document.getElementById('msg-input');
  if (!inp) return;
  const text=inp.value.trim();
  if(!text) return;
  if(!activeBlueprint||!ws||ws.readyState!==WebSocket.OPEN){ toast('Session not active. Please restart.'); return; }
  inp.value='';
  const area=document.getElementById('messagesWrap');
  if(area){
    const div=document.createElement('div'); div.className='msg me';
    div.innerHTML=`<div class="msg-label">YOU</div><div class="bubble">${escHtml(text)}</div>`;
    area.appendChild(div); area.scrollTop=area.scrollHeight;
  }
  text.toLowerCase().split(/\s+/).forEach(w=>{const c=w.replace(/[^a-zäöüß]/gi,'');if(c.length>2)wordsUsed.add(c);});
  updateWordCount();
  pushEvent('user_transcript_final', {
    text,
    inputMode: selectedInputMode || 'both',
    scenarioId: activeBlueprint?.scenarioId || selectedScenario?.id || null,
  });
  appendCanonicalTurn('user', text);
  conversationHistory.push({role:'user',content:text});
  tickStageEngine();
  updateAuraState('thinking');
  resetSilenceTimer();
  ws.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text}]}],turnComplete:true}}));
};

// ── CHANGE SCENARIO ───────────────────────────
window.changeScenario=async()=>{
  const all=[...document.getElementById('scenario-select').options];
  const same=all.filter(o=>o.dataset.level===selectedLevel&&o.value!==selectedScenario.id);
  if(!same.length){toast('No more scenarios for this level!');return;}
  const pick=same[Math.floor(Math.random()*same.length)];
  const sel=document.getElementById('scenario-select');
  if(sel) sel.value=pick.value;
  selectedScenario={id:pick.value,title:pick.text.replace(/^[^\s]+ /,''),level:pick.dataset.level,role:pick.dataset.role,emoji:pick.dataset.emoji,desc:pick.dataset.desc};
  activeBlueprint = null;
  const newBlueprint = resolveActiveBlueprint();
  conversationHistory=[];errorPatterns={};turnCount=0;currentUserText=''; auraContextBlock='';
  setSessionMode(selectedSessionMode || 'guided');
  const _se=document.getElementById('sesh-emoji'); if(_se)_se.textContent=selectedScenario.emoji;
  renderSessionLabels();
  const _ca=document.getElementById('messagesWrap'); if(_ca) { Array.from(_ca.children).forEach(c => { if(c.id !== 'typingIndicator') c.remove(); }); }
  updateSessionModeRecommendation();
  toast(`New scenario: ${selectedScenario.title}`);
  logAnalyticsEvent('scenario_selected', { scenarioId: newBlueprint?.scenarioId || selectedScenario.id, level: newBlueprint?.level || selectedLevel, mode: newBlueprint?.mode || getActiveSessionMode(selectedLevel) }).catch(()=>{});
  if(ws&&ws.readyState===WebSocket.OPEN){
    updateListeningPill('thinking');
    ws.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text:`New scenario! You are now: ${selectedScenario.role}. Scenario: ${selectedScenario.title} — ${selectedScenario.desc}. Level: ${selectedLevel}. Session mode: ${getActiveSessionMode(selectedLevel)}. Greet and restart.`}]}],turnComplete:true}}));
  }
};

window.goBackToSetup=()=>{
  clearInterval(sessionTimerInterval); cleanupLive();
  if(_el('speak-session')) _el('speak-session').style.display='none';
  if(_el('speak-score'))   _el('speak-score').style.display='none';
  if(_el('speak-setup'))   _el('speak-setup').style.display='block';
  updateTrialBadge();
  renderRecentPractice(userSessionHistory);
};

window.goBackToHomepage=()=>{
  clearInterval(sessionTimerInterval); cleanupLive();
  if(_el('speak-session'))        _el('speak-session').style.display='none';
  if(_el('speak-score'))          _el('speak-score').style.display='none';
  if(_el('speaking-interface'))   _el('speaking-interface').style.display='none';
  document.body.classList.remove('exam-active');
  hideAllExamOverlays();
  const navCta=document.querySelector('.gnav-cta');
  if(navCta) navCta.style.display='';
  updateTrialBadge();
  // Always return to dashboard when in app mode
  if (currentUser && userProfile?.onboardingComplete) {
    _showSpeakingInterface();
  } else if (currentUser) {
    showOnboarding();
  } else {
    // No user -- go back to landing page
    window.location.hash = '';
  }
};
function handleSessionClose(code, reason) {
  updateListeningPill('idle');
  if (code === 1000) toast('Session ended.');
  else toast('Connection lost. Please retry the session.');
  console.warn('[AURA] session_closed', {
    code,
    reason,
    blueprint: activeBlueprint ? {
      level: activeBlueprint.level,
      mode: activeBlueprint.mode,
      scenarioId: activeBlueprint.scenarioId,
      scenarioLevel: activeBlueprint.scenarioLevel,
      promptProfile: activeBlueprint.promptProfile,
    } : null,
  });
  cleanupLive({ clearBlueprint: code === 1000 });
}

function cleanupLive({ clearBlueprint = true, resetState = true } = {}) {
  if (resetState) resetSessionState();
  initStageEngine();
  sessionActive=false; sessionPaused=false; clearSilenceTimer();
  if(silenceCountdownInterval){clearInterval(silenceCountdownInterval);silenceCountdownInterval=null;}
  if(window._keepAlive){clearInterval(window._keepAlive);window._keepAlive=null;}
  if(dgWs){dgClosingByApp=true;try{dgWs.close();}catch(e){}dgWs=null;}
  if(workletNode){try{workletNode.disconnect();}catch(e){}workletNode=null;}
  if(micStream){micStream.getTracks().forEach(t=>t.stop());micStream=null;}
  if(playbackNode){try{playbackNode.disconnect();}catch(e){}playbackNode=null;}
  if(audioCtx){try{audioCtx.close();}catch(e){}audioCtx=null;}
  if(micCtx){try{micCtx.close();}catch(e){}micCtx=null;}
  currentAiText=''; currentAiEntryEl=null; micMuted=false;
  currentUserText=''; currentUserEntryEl=null;
  if (clearBlueprint) activeBlueprint = null;
  dismissCorrection(); updateListeningPill('idle');
  setDeepgramStatusVisible(false);
  const btn=document.getElementById('mic-btn');if(btn){btn.classList.remove('muted','active');btn.textContent='🎙';}
  _syncToStore();
  refreshAuraDebug();
}


// ── Export public API ─────────────────────────────────────────────────────────
export {
  getSessionState,
  transitionSessionState,
  resetSessionState,
  getCurrentStage,
  initStageEngine,
  buildSessionBlueprint,
  validateBlueprint,
  getActiveSessionMode,
  collectSessionEvidence,
  handleServerMessage,
  handleSessionClose,
  cleanupLive,
  updateAuraState,
  updateWordCount,
  detectAndShowCorrection,
  startSilenceTimer,
  resetSilenceTimer,
  clearSilenceTimer,
  updateTimer,
  updateNavTimer,
};

// ── Window bindings for HTML onclick handlers ─────────────────────────────────
window.startSession          = async () => { await _doStartSession(); };
window.confirmPrivacyAndStart = async () => {
  document.getElementById('privacy-modal')?.classList.remove('open');
  await _doStartSession();
};
window.toggleMic      = () => { micMuted = !micMuted; const btn = document.getElementById('mic-btn'); if (btn) btn.classList.toggle('muted', micMuted); };
window.resumeSession  = () => { sessionPaused = false; clearSilenceTimer(); document.getElementById('silence-modal')?.classList.remove('open'); };
window.addTime        = () => { if (!addTimeUsed) { sessionSeconds += 10*60; addTimeUsed = true; toast('+10 min added'); } };
window.requestHint    = () => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ clientContent: { turns: [{ role:'user', parts:[{ text:'[HINT REQUEST] Please give me a hint for what to say next in German, in my support language.' }] }], turnComplete: true } })); };
window.dismissCorrection = () => { clearTimeout(correctionTimeout); };
window.goBackToSetup    = () => { cleanupLive(); if(_el('speak-session')) _el('speak-session').style.display='none'; if(_el('speak-setup')) _el('speak-setup').style.display=''; };
window.goBackToHomepage = () => { cleanupLive(); window.location.hash = ''; };
window.changeScenario   = async () => { await restartSessionIfRunning('scenario_change'); };
window.endSession = async () => {
  if (!sessionActive) return;
  if (!confirm('End this session?')) return;
  handleSessionClose(1000, 'user_ended');
  window.dispatchEvent(new CustomEvent('aura:session-ended'));
};
window.SCENARIOS = SCENARIOS;
window.collectSessionEvidence = collectSessionEvidence;
