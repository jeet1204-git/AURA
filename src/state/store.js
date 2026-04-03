// ── AURA Global State Store ───────────────────────────────────────────────────
// Single source of truth for all runtime state.
// All modules read and write these variables.
// In a future refactor these become proper reactive state with getters/setters.

// ── Auth + profile ────────────────────────────────────────────────────────────
export let currentUser      = null;
export let userProfile      = null;
export let isPaidStudent    = false;
export let profileReady     = false;

// ── Session setup selections ──────────────────────────────────────────────────
export let selectedLevel          = 'A1';
export let selectedInputMode      = 'both';
export let selectedScenario       = null;
export let selectedProgramType    = 'general';
export let selectedExamPart       = 'teil1';
export let selectedExamRunType    = 'practice';
export let selectedExaminerStyle  = 'standard';
export let selectedExamTopicId    = null;
export let selectedLangPref       = 'English';
export let selectedSessionMode    = 'guided';

// ── Session runtime ───────────────────────────────────────────────────────────
export let activeBlueprint        = null;
export let conversationHistory    = [];
export let wordsUsed              = new Set();
export let errorPatterns          = {};
export let auraContextBlock       = '';
export let userMemorySnapshot     = null;
export let sessionActive          = false;
export let micMuted               = false;
export let addTimeUsed            = false;
export let sessionSeconds         = 20 * 60;
export let sessionTimerInterval   = null;
export let sessionStartedAt       = null;
export let turnCount              = 0;
export let correctionTimeout      = null;
export let sessionPaused          = false;
export let lastUserSpeechTime     = null;
export let liveEventLog           = [];
export let canonicalTurns         = [];

// ── WebSocket + audio ─────────────────────────────────────────────────────────
export let ws            = null;
export let dgWs          = null;
export let audioCtx      = null;
export let micCtx        = null;
export let micStream     = null;
export let workletNode   = null;
export let playbackNode  = null;
export let dgClosingByApp = false;

// ── Dashboard ─────────────────────────────────────────────────────────────────
export let userSessionHistory  = [];
export let userProgressSummary = null;
export let dailyPracticeFocus  = null;
export let nextRecommendation  = null;

// ── Onboarding ────────────────────────────────────────────────────────────────
export let obStep = 0;
export let obData = { name: '', nativeLanguage: '', currentLevel: '', goal: '' };

// ── Setters (used by modules to update state) ─────────────────────────────────
export function setCurrentUser(v)     { currentUser = v; }
export function setUserProfile(v)     { userProfile = v; }
export function setIsPaidStudent(v)   { isPaidStudent = v; }
export function setProfileReady(v)    { profileReady = v; }
export function setSelectedLevel(v)   { selectedLevel = v; }
export function setSelectedScenario(v){ selectedScenario = v; }
export function setActiveBlueprint(v) { activeBlueprint = v; }
export function setSessionActive(v)   { sessionActive = v; }
export function setMicMuted(v)        { micMuted = v; }
export function setWs(v)              { ws = v; }
export function setDgWs(v)            { dgWs = v; }
export function setAudioCtx(v)        { audioCtx = v; }
export function setMicCtx(v)          { micCtx = v; }
export function setMicStream(v)       { micStream = v; }
export function setWorkletNode(v)     { workletNode = v; }
export function setPlaybackNode(v)    { playbackNode = v; }
export function setAuraContextBlock(v){ auraContextBlock = v; }
export function setSessionSeconds(v)  { sessionSeconds = v; }
export function setSessionStartedAt(v){ sessionStartedAt = v; }
export function setTurnCount(v)       { turnCount = v; }
export function setSessionPaused(v)   { sessionPaused = v; }
export function setUserSessionHistory(v)  { userSessionHistory = v; }
export function setUserProgressSummary(v) { userProgressSummary = v; }
export function setObStep(v)          { obStep = v; }
export function setObData(v)          { obData = { ...obData, ...v }; }
export function setSelectedLangPref(v){ selectedLangPref = v; }
export function setSelectedProgramType(v) { selectedProgramType = v; }
export function setSelectedExamPart(v)    { selectedExamPart = v; }
export function setSelectedExamRunType(v) { selectedExamRunType = v; }
export function setSelectedExaminerStyle(v){ selectedExaminerStyle = v; }
export function setSelectedExamTopicId(v) { selectedExamTopicId = v; }
export function setSelectedSessionMode(v) { selectedSessionMode = v; }
export function setDgClosingByApp(v)  { dgClosingByApp = v; }
export function setAddTimeUsed(v)     { addTimeUsed = v; }
export function setSessionTimerInterval(v){ sessionTimerInterval = v; }
export function setCorrectionTimeout(v)   { correctionTimeout = v; }
export function setLiveEventLog(v)    { liveEventLog = v; }
export function setCanonicalTurns(v)  { canonicalTurns = v; }
export function pushCanonicalTurn(t)  { canonicalTurns.push(t); }
export function pushLiveEvent(e)      { liveEventLog.push(e); }
export function resetSession() {
  conversationHistory = [];
  wordsUsed           = new Set();
  errorPatterns       = {};
  auraContextBlock    = '';
  sessionActive       = false;
  micMuted            = false;
  addTimeUsed         = false;
  sessionSeconds      = 20 * 60;
  sessionTimerInterval = null;
  sessionStartedAt    = null;
  turnCount           = 0;
  correctionTimeout   = null;
  sessionPaused       = false;
  lastUserSpeechTime  = null;
  liveEventLog        = [];
  canonicalTurns      = [];
  ws                  = null;
  dgWs                = null;
  workletNode         = null;
  playbackNode        = null;
  dgClosingByApp      = false;
}

// ── Expose critical state to window for legacy inline handlers ────────────────
// Modules that still read bare globals (not yet fully migrated) will find them here.
Object.defineProperties(window, {
  currentUser:      { get: () => currentUser,      set: v => { currentUser = v; } },
  userProfile:      { get: () => userProfile,      set: v => { userProfile = v; } },
  isPaidStudent:    { get: () => isPaidStudent,     set: v => { isPaidStudent = v; } },
  profileReady:     { get: () => profileReady,      set: v => { profileReady = v; } },
  selectedLevel:    { get: () => selectedLevel,     set: v => { selectedLevel = v; } },
  selectedScenario: { get: () => selectedScenario,  set: v => { selectedScenario = v; } },
  selectedLangPref: { get: () => selectedLangPref,  set: v => { selectedLangPref = v; } },
  selectedProgramType:   { get: () => selectedProgramType,   set: v => { selectedProgramType = v; } },
  selectedExamPart:      { get: () => selectedExamPart,      set: v => { selectedExamPart = v; } },
  selectedExamRunType:   { get: () => selectedExamRunType,   set: v => { selectedExamRunType = v; } },
  selectedExaminerStyle: { get: () => selectedExaminerStyle, set: v => { selectedExaminerStyle = v; } },
  selectedExamTopicId:   { get: () => selectedExamTopicId,   set: v => { selectedExamTopicId = v; } },
  selectedSessionMode:   { get: () => selectedSessionMode,   set: v => { selectedSessionMode = v; } },
  activeBlueprint:  { get: () => activeBlueprint,   set: v => { activeBlueprint = v; } },
  sessionActive:    { get: () => sessionActive,     set: v => { sessionActive = v; } },
  micMuted:         { get: () => micMuted,          set: v => { micMuted = v; } },
  ws:               { get: () => ws,                set: v => { ws = v; } },
  dgWs:             { get: () => dgWs,              set: v => { dgWs = v; } },
  audioCtx:         { get: () => audioCtx,          set: v => { audioCtx = v; } },
  micCtx:           { get: () => micCtx,            set: v => { micCtx = v; } },
  workletNode:      { get: () => workletNode,        set: v => { workletNode = v; } },
  playbackNode:     { get: () => playbackNode,       set: v => { playbackNode = v; } },
  auraContextBlock: { get: () => auraContextBlock,  set: v => { auraContextBlock = v; } },
  sessionSeconds:   { get: () => sessionSeconds,    set: v => { sessionSeconds = v; } },
  conversationHistory: { get: () => conversationHistory, set: v => { conversationHistory = v; } },
  wordsUsed:        { get: () => wordsUsed,         set: v => { wordsUsed = v; } },
  turnCount:        { get: () => turnCount,         set: v => { turnCount = v; } },
  sessionPaused:    { get: () => sessionPaused,     set: v => { sessionPaused = v; } },
  liveEventLog:     { get: () => liveEventLog,      set: v => { liveEventLog = v; } },
  canonicalTurns:   { get: () => canonicalTurns,    set: v => { canonicalTurns = v; } },
  userSessionHistory:  { get: () => userSessionHistory,  set: v => { userSessionHistory = v; } },
  userProgressSummary: { get: () => userProgressSummary, set: v => { userProgressSummary = v; } },
  obStep:           { get: () => obStep,            set: v => { obStep = v; } },
  obData:           { get: () => obData,            set: v => { obData = v; } },
});
