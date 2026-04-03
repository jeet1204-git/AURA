import { WORKER_URL, FREE_SESSION_LIMIT } from '../config/constants.js';
import { auth, getIdToken } from './auth.js';
import { db, loadUserSessionHistory, loadDailyState, saveDailyState } from './firestore.js';
import { toast } from './evaluation.js';

// PHASE 4 — ONBOARDING
// ══════════════════════════════════════════════════════════
let obStep = 0;
let obData = { name: '', nativeLanguage: '', currentLevel: '', goal: '' };

function showOnboarding() {
  document.getElementById('onboarding-screen').classList.add('active');
}
function hideOnboarding() {
  document.getElementById('onboarding-screen').classList.remove('active');
}

function obUpdateDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`ob-dot-${i}`);
    dot.classList.remove('active', 'done');
    if (i < obStep) dot.classList.add('done');
    else if (i === obStep) dot.classList.add('active');
  }
}

function obShowStep(n) {
  for (let i = 0; i < 4; i++) {
    document.getElementById(`ob-step-${i}`).style.display = i === n ? '' : 'none';
  }
  obStep = n;
  obUpdateDots();
  // Focus first input on step 0
  if (n === 0) setTimeout(() => document.getElementById('ob-name-input').focus(), 100);
}

function obBack() {
  if (obStep > 0) obShowStep(obStep - 1);
}

function obNext() {
  if (obStep === 0) {
    const val = document.getElementById('ob-name-input').value.trim();
    if (!val) return;
    obData.name = val;
    obShowStep(1);
  } else if (obStep === 1) {
    if (!obData.nativeLanguage) return;
    obShowStep(2);
  } else if (obStep === 2) {
    if (!obData.currentLevel) return;
    obShowStep(3);
  }
}

function obValidateName() {
  const val = document.getElementById('ob-name-input').value.trim();
  document.getElementById('ob-next-0').disabled = val.length < 1;
}

// If user typed before module loaded, re-validate once module is ready
requestAnimationFrame(() => {
  const inp = document.getElementById('ob-name-input');
  if (inp && inp.value.trim().length > 0) obValidateName();
});

function obSelectLang(val) {
  document.querySelectorAll('#ob-lang-options .ob-option').forEach(el => el.classList.remove('selected'));
  document.querySelector(`#ob-lang-options .ob-option[data-val="${val}"]`)?.classList.add('selected');
  const otherInput = document.getElementById('ob-other-lang-input');
  if (val === 'other') {
    otherInput.style.display = 'block';
    otherInput.focus();
    obData.nativeLanguage = '';
    document.getElementById('ob-next-1').disabled = true;
  } else {
    otherInput.style.display = 'none';
    obData.nativeLanguage = val;
    document.getElementById('ob-next-1').disabled = false;
  }
}

function obValidateLangOther() {
  const val = document.getElementById('ob-other-lang-input').value.trim().toLowerCase();
  obData.nativeLanguage = val;
  document.getElementById('ob-next-1').disabled = val.length < 2;
}

function obSelectLevel(val) {
  document.querySelectorAll('#ob-level-options .ob-option').forEach(el => el.classList.remove('selected'));
  document.querySelector(`#ob-level-options .ob-option[data-val="${val}"]`)?.classList.add('selected');
  obData.currentLevel = val;
  document.getElementById('ob-next-2').disabled = false;
}

function obSelectGoal(val) {
  document.querySelectorAll('#ob-goal-options .ob-option').forEach(el => el.classList.remove('selected'));
  document.querySelector(`#ob-goal-options .ob-option[data-val="${CSS.escape(val)}"]`)?.classList.add('selected');
  // data-val with spaces needs querySelector by iteration
  document.querySelectorAll('#ob-goal-options .ob-option').forEach(el => {
    if (el.dataset.val === val) el.classList.add('selected');
  });
  obData.goal = val;
  document.getElementById('ob-next-3').disabled = false;
}

async function obFinish() {
  if (!obData.name || !obData.nativeLanguage || !obData.currentLevel || !obData.goal) return;
  const btn = document.getElementById('ob-next-3');
  const savingEl = document.getElementById('ob-saving');
  btn.disabled = true;
  savingEl.style.display = 'flex';

  try {
    const idToken = currentUser ? await getIdToken(currentUser) : null;
    if (!idToken) throw new Error('Not signed in');
    const resp = await fetch(`${WORKER_URL}/onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        name: obData.name,
        nativeLanguage: obData.nativeLanguage,
        currentLevel: obData.currentLevel,
        goal: obData.goal,
        uiLanguage: obData.nativeLanguage
      })
    });
    if (!resp.ok) throw new Error('Onboarding API failed');

    // Update local profile
    userProfile = {
      ...(userProfile || {}),
      displayName: obData.name,
      nativeLanguage: obData.nativeLanguage,
      currentLevel: obData.currentLevel,
      onboardingComplete: true,
      subscription: 'free',
      freeSessionsUsedThisMonth: 0,
    };
    // Update lang pref in AURA setup to match
    const langMap = { english: 'English', gujarati: 'Gujarati', hindi: 'Hindi' };
    const mappedLang = langMap[obData.nativeLanguage] || obData.nativeLanguage;
    setLangPref(mappedLang);
    // Set level
    setLevel(obData.currentLevel === 'A2' || obData.currentLevel === 'B1' ? 'A2' : 'A1');

    hideOnboarding();
    _showSpeakingInterface();
  } catch (err) {
    console.error('[AURA] Onboarding failed:', err);
    savingEl.style.display = 'none';
    btn.disabled = false;
    btn.textContent = 'Try again →';
  }
}

// ══════════════════════════════════════════════════════════
// PHASE 5 — DASHBOARD
function computeStreak(sessions) {
  if (!sessions || !sessions.length) return 0;
  const today = new Date(); today.setHours(0,0,0,0);
  const days = new Set(sessions.map(s => {
    const d = new Date(s.endedAt?.toMillis ? s.endedAt.toMillis() : s.endedAt || 0);
    d.setHours(0,0,0,0);
    return d.getTime();
  }));
  let streak = 0, cursor = today.getTime();
  while (days.has(cursor)) { streak++; cursor -= 86400000; }
  // If today not present, check yesterday
  if (streak === 0) {
    cursor = today.getTime() - 86400000;
    while (days.has(cursor)) { streak++; cursor -= 86400000; }
  }
  return streak;
}

function dashStartSession() {
  // Called from the white setup screen's Start button — just start the session
  if (checkPaywallGate()) return;
  _doStartSession();
}

// ══════════════════════════════════════════════════════════
// PHASE 6 — PAYWALL ENFORCEMENT
// ══════════════════════════════════════════════════════════
function showUpgradeModal() {
  const used  = getFreeSessionsUsedThisMonth();
  const left  = Math.max(0, FREE_SESSION_LIMIT - used);
  const body  = document.getElementById('upgrade-modal-body');
  if (body) {
    body.innerHTML = left <= 0
      ? `You've used all <strong>${FREE_SESSION_LIMIT} free sessions</strong> this month. Upgrade to Pro for unlimited AURA conversations, full memory, and exam prep.`
      : `You have <strong>${left} free session${left !== 1 ? 's' : ''}</strong> left this month.`;
  }
  document.getElementById('upgrade-modal').classList.add('open');
}

// Returns true (and shows gate) if user has hit the limit
function checkPaywallGate() {
  if (isPaidStudent || userProfile?.subscription === 'pro') return false;
  const used = getFreeSessionsUsedThisMonth();
  if (used >= FREE_SESSION_LIMIT) {
    showUpgradeModal();
    return true;
  }
  return false;
}

function getFreeSessionsUsedThisMonth() {
  return parseInt(userProfile?.freeSessionsUsedThisMonth || '0', 10);
}

// ══════════════════════════════════════════════════════════
// ROUTING — decides what to show after auth loads
// ══════════════════════════════════════════════════════════
function routeAfterAuth() {
  if (!currentUser) return;
  // Check both the actual hash and the intent attribute set by the route guard
  const hash = window.location.hash;
  const inAppMode = hash === '#aura' || (hash.indexOf('#aura') === 0 && hash.length === 5);
  const intendedApp = document.documentElement.getAttribute('data-route-intent') === 'app';

  if (!inAppMode && !intendedApp) return; // On landing page — don't redirect

  // Now it's safe to switch to app mode (auth is confirmed, no more black flash)
  document.documentElement.setAttribute('data-route', 'app');
  document.documentElement.removeAttribute('data-route-intent');
  document.body.style.background = 'var(--app-bg)';
  if (hash !== '#aura') window.location.hash = '#aura';

  const isOnboarded = userProfile?.onboardingComplete === true;
  if (!isOnboarded) {
    obShowStep(0);
    showOnboarding();
  } else {
    showApp();
    _showSpeakingInterface();
  }
}
let currentAiText='', currentAiEntryEl=null;
let currentUserText='', currentUserEntryEl=null; // input transcription buffer
let turnCount=0, correctionTimeout=null;
let silenceTimer=null, silenceCountdownInterval=null;
function syncSetupModeUI() {
  const isA2 = selectedLevel === 'A2';
  const examActive = (typeof isExamModeActive === "function" ? isExamModeActive() : false);
  const programTypeSection = document.getElementById('program-type-section');
  const examControlsSection = document.getElementById('exam-controls-section');
  const scenarioSection = document.getElementById('scenario-select')?.closest('.setup-section');
  const modeSection = document.getElementById('session-mode-group')?.closest('.setup-section');
  if (programTypeSection) programTypeSection.style.display = isA2 ? 'block' : 'none';
  if (examControlsSection) examControlsSection.style.display = examActive ? 'block' : 'none';
  if (scenarioSection) scenarioSection.style.display = examActive ? 'none' : 'block';
  if (modeSection) modeSection.style.display = examActive ? 'none' : 'block';
  if (typeof syncSegRowState === 'function') {
    syncSegRowState('.program-type-tab', selectedProgramType);
    syncSegRowState('.exam-part-tab', selectedExamPart);
    syncSegRowState('.exam-run-type-tab', selectedExamRunType);
    syncSegRowState('.examiner-style-tab', selectedExaminerStyle);
  }
  if (typeof syncExamTopicSelector === 'function') syncExamTopicSelector();
  if (!isA2) selectedProgramType = 'general';
  if (!examActive && typeof window.onScenarioChange === 'function') window.onScenarioChange();
}

window.setProgramType = (value) => {
  selectedProgramType = value === 'exam' && selectedLevel === 'A2' ? 'exam' : 'general';
  syncSetupModeUI();
};

window.setExamPart = (value) => {
  selectedExamPart = ['teil1','teil2','teil3','full_mock'].includes(value) ? value : 'teil1';
  const selectedTopic = (typeof getExamTopicById === "function" ? getExamTopicById(selectedExamTopicId) : null);
  if (selectedExamPart === 'full_mock' || !selectedTopic || selectedTopic.part !== selectedExamPart) selectedExamTopicId = null;
  syncSetupModeUI();
};

window.setExamRunType = (value) => {
  selectedExamRunType = value === 'scored' ? 'scored' : 'practice';
  syncSetupModeUI();
};

window.setExaminerStyle = (value) => {
  selectedExaminerStyle = ['supportive','standard','strict'].includes(value) ? value : 'standard';
  syncSetupModeUI();
};

window.setExamTopic = (value) => {
  if (!value || value === '__random__') {
    selectedExamTopicId = null;
    return;
  }
  const topic = (typeof getExamTopicById === "function" ? getExamTopicById(value) : null);
  selectedExamTopicId = topic && topic.part === selectedExamPart ? topic.topicId : null;
};

window.setLevel = (l) => {
  selectedLevel = l === 'A2' ? 'A2' : 'A1';
  document.querySelectorAll('.level-tab').forEach(t => t.classList.toggle('active', t.textContent.includes(selectedLevel)));
  if (selectedLevel !== 'A2') {
    selectedProgramType = 'general';
    selectedExamPart = 'teil1';
    selectedExamRunType = 'practice';
    selectedExaminerStyle = 'standard';
    selectedExamTopicId = null;
    if (typeof window.resetExamRuntimeState === 'function') window.resetExamRuntimeState();
  }
  selectedSessionMode = 'guided';
  document.querySelectorAll('.session-mode-tab').forEach(t =>
    t.classList.toggle('active', t.getAttribute('onclick')?.includes("'guided'")));
  if (typeof syncScenarioToLevel === 'function') syncScenarioToLevel(selectedLevel);
  if (typeof syncSetupModeUI === 'function') syncSetupModeUI();
  if ((typeof isExamModeActive === "function" ? isExamModeActive() : false) && typeof window.onScenarioChange === 'function') window.onScenarioChange();
  if (typeof renderSessionLabels === 'function') renderSessionLabels();
  if (typeof updateSessionModeRecommendation === 'function') updateSessionModeRecommendation();
  if (typeof restartSessionIfRunning === 'function') restartSessionIfRunning('level_changed');
  if (typeof refreshAuraDebug === 'function') refreshAuraDebug();
};

window.setInputMode = (m) => {
  selectedInputMode = m;
  document.querySelectorAll('.mode-tab').forEach(t =>
    t.classList.toggle('active', t.getAttribute('onclick')?.includes(`'${m}'`)));
};

window.setSessionMode = (mode) => {
  selectedSessionMode = mode === 'immersion' ? 'immersion' : 'guided';
  document.querySelectorAll('.session-mode-tab').forEach(t =>
    t.classList.toggle('active', t.getAttribute('onclick')?.includes(`'${selectedSessionMode}'`)));
  if (typeof renderSessionLabels === 'function') renderSessionLabels();
  if (typeof updateSessionModeRecommendation === 'function') updateSessionModeRecommendation();
  if (typeof restartSessionIfRunning === 'function') restartSessionIfRunning('mode_changed');
  if (typeof logAnalyticsEvent === 'function') logAnalyticsEvent('mode_changed', { mode: selectedSessionMode, level: selectedLevel }).catch(()=>{});
  if (typeof refreshAuraDebug === 'function') refreshAuraDebug();
};

window.setLangPref = (lang) => {
  selectedLangPref = lang;
  document.querySelectorAll('.lang-pref-tab').forEach(t =>
    t.classList.toggle('active', t.getAttribute('onclick')?.includes(`'${lang}'`)));
  const wrap = document.getElementById('other-lang-wrap');
  const pill = document.getElementById('other-lang-pill');
  if (wrap) wrap.style.display = 'none';
  if (pill) pill.classList.remove('active');
};

window.onScenarioChange = () => {
  const sel = document.getElementById('scenario-select');
  if (!sel || !sel.options?.length) return;
  let selectedOpt = sel.options[sel.selectedIndex];
  if (!selectedOpt) return;
  if (selectedOpt.dataset.level !== selectedLevel && !(typeof isExamModeActive === "function" ? isExamModeActive() : false)) {
    const repaired = resolveScenarioForLevel(selectedLevel, selectedOpt.value);
    if (repaired) {
      console.warn('[AURA] scenario/level mismatch auto-repaired', { selectedLevel, scenarioLevel: selectedOpt.dataset.level, requestedScenarioId: selectedOpt.value, repairedScenarioId: repaired.id });
      sel.value = repaired.id;
      selectedOpt = sel.options[sel.selectedIndex] || selectedOpt;
    } else {
      console.warn('[AURA] scenario/level mismatch forced level sync', { fromLevel: selectedLevel, toLevel: selectedOpt.dataset.level, scenarioId: selectedOpt.value });
      selectedLevel = selectedOpt.dataset.level || selectedLevel;
      document.querySelectorAll('.level-tab').forEach(t => t.classList.toggle('active', t.textContent.includes(selectedLevel)));
    }
  }
  selectedScenario = readScenarioFromSelect();
  const desc = document.getElementById('scenario-desc');
  if (desc) desc.textContent = selectedOpt?.dataset?.desc || '';
  activeBlueprint = null;
  if (typeof renderSessionLabels === 'function') renderSessionLabels();
  if (typeof updateSessionModeRecommendation === 'function') updateSessionModeRecommendation();
  if (typeof restartSessionIfRunning === 'function') restartSessionIfRunning('scenario_changed');
  if (typeof logAnalyticsEvent === 'function') logAnalyticsEvent('scenario_selected', { scenarioId: selectedOpt?.value || sel.value, level: selectedOpt?.dataset?.level || selectedLevel }).catch(()=>{});
  if (typeof syncSetupSummary === 'function') syncSetupSummary();
  if (typeof refreshAuraDebug === 'function') refreshAuraDebug();
};


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupDailyFocusCardInteraction, { once:true });
} else {
  setupDailyFocusCardInteraction();
}
if (typeof syncSetupModeUI === "function") syncSetupModeUI();

function getNextRecommendation({ selectedScenario, selectedLevel, selectedMode, userProgressSummary, userSessionHistory, latestSessionResult }) {
  const level = selectedLevel || selectedScenario?.level || 'A1';
  const mode = selectedMode || 'guided';
  const summary = userProgressSummary || computeProgressSummary(userSessionHistory || []);
  const result = latestSessionResult || null;
  const currentScenarioId = selectedScenario?.id || null;
  const completedCount = (summary?.completedScenarioIds || []).length;
  const evaluated = !!result && !result.evaluationFailed;
  const weakAreas = summary?.recentWeakAreas || [];

  if (!evaluated || result.completed === false || result.evaluationFailed === true) {
    if (level === 'A2') {
      return {
        title: 'Repeat with stronger independence',
        message: 'Retry this scenario in Guided mode and sustain topic-focused speaking for multiple turns with reasons and details.',
        actionType: 'repeat_scenario',
        suggestedScenarioId: currentScenarioId,
        suggestedMode: 'guided',
      };
    }
    return {
      title: 'Repeat this scenario once more',
      message: 'Let’s keep it steady. Retry the same scenario in Guided mode and focus on one clear full sentence each turn.',
      actionType: 'repeat_scenario',
      suggestedScenarioId: currentScenarioId,
      suggestedMode: 'guided',
    };
  }

  const task = result.taskCompletionScore ?? result.taskCompletion ?? null;
  const fluency = result.fluencyScore ?? result.fluency ?? null;
  const grammar = result.grammarScore ?? result.grammar ?? null;
  const vocab = result.vocabularyScore ?? result.vocabulary ?? null;
  const overall = result.overallScore ?? result.overall ?? null;

  if (level === 'A2') {
    if ((task ?? 0) < 60) {
      return {
        title: 'Stabilize task completion first',
        message: 'Repeat this scenario in Guided mode and complete each prompt with connected answers that stay on-topic for multiple turns.',
        actionType: 'repeat_scenario',
        suggestedScenarioId: currentScenarioId,
        suggestedMode: 'guided',
      };
    }

    if ((fluency ?? 100) < 60) {
      return {
        title: 'Build longer connected answers',
        message: 'Stay in Guided mode and aim for 2–4 connected sentences with connectors like weil, dann, aber, oder, deshalb.',
        actionType: 'guided_focus',
        suggestedScenarioId: currentScenarioId,
        suggestedMode: 'guided',
      };
    }

    if ((grammar ?? 100) < 65 || (vocab ?? 100) < 65 || weakAreas.includes('grammar') || weakAreas.includes('vocabulary')) {
      return {
        title: 'Add reasons and preferences clearly',
        message: 'Do one more Guided round and practice reason/detail replies: preference + why + time/detail in each response.',
        actionType: 'guided_focus',
        suggestedScenarioId: currentScenarioId,
        suggestedMode: 'guided',
      };
    }

    if (mode === 'immersion' && ((task ?? 100) < 70 || (overall ?? 100) < 70)) {
      return {
        title: 'Rebuild independence in Guided mode',
        message: 'Switch back to Guided for one focused repeat and strengthen clarification handling before returning to immersion.',
        actionType: 'switch_mode',
        suggestedScenarioId: currentScenarioId,
        suggestedMode: 'guided',
      };
    }

    if (mode === 'guided' && (task ?? 0) >= 75 && (overall ?? 0) >= 72) {
      return {
        title: 'Try A2 Immersion with pressure',
        message: 'Task completion is stable. Move to Immersion and handle clarifications in German without relying on support language.',
        actionType: 'switch_mode',
        suggestedScenarioId: getNextScenarioSuggestion(level, currentScenarioId, summary?.completedScenarioIds || []),
        suggestedMode: 'immersion',
      };
    }

    return {
      title: 'Expand topic control',
      message: 'Move to a new A2 scenario and maintain topic for multiple turns with reasons, preferences, and concrete details.',
      actionType: 'new_scenario',
      suggestedScenarioId: getNextScenarioSuggestion(level, currentScenarioId, summary?.completedScenarioIds || []),
      suggestedMode: mode,
    };
  }

  if ((task ?? 0) < 60) {
    return {
      title: 'Strengthen task completion',
      message: 'Repeat this scenario in Guided mode and complete every prompt from start to finish.',
      actionType: 'repeat_scenario',
      suggestedScenarioId: currentScenarioId,
      suggestedMode: 'guided',
    };
  }

  if ((fluency ?? 100) < 60 && (task ?? 0) >= 60) {
    return {
      title: 'Build smoother delivery',
      message: 'Stay with this scenario in Guided mode and aim for short, confident German sentences.',
      actionType: 'repeat_scenario',
      suggestedScenarioId: currentScenarioId,
      suggestedMode: 'guided',
    };
  }

  if (weakAreas.includes('grammar') || weakAreas.includes('vocabulary')) {
    return {
      title: 'Consolidate fundamentals',
      message: 'Do one more Guided round to tighten grammar and vocabulary before increasing pressure.',
      actionType: 'guided_focus',
      suggestedScenarioId: currentScenarioId,
      suggestedMode: 'guided',
    };
  }

  if (level === 'A1' && summary?.immersionReady && completedCount >= 3) {
    return {
      title: 'Try Immersion mode now',
      message: 'You are ready for more realistic practice. Keep the same level and move into Immersion mode.',
      actionType: 'switch_mode',
      suggestedScenarioId: getNextScenarioSuggestion(level, currentScenarioId, summary?.completedScenarioIds || []),
      suggestedMode: 'immersion',
    };
  }

  return {
    title: 'Move to a new scenario',
    message: 'Great work here. Continue at the same level with a fresh scenario to broaden your speaking range.',
    actionType: 'new_scenario',
    suggestedScenarioId: getNextScenarioSuggestion(level, currentScenarioId, summary?.completedScenarioIds || []),
    suggestedMode: mode,
  };
}

function renderNextRecommendation(rec) {
  const card = document.getElementById('next-action-card');
  const titleEl = document.getElementById('next-action-title');
  const msgEl = document.getElementById('next-action-message');
  if (!card || !titleEl || !msgEl) return;
  if (!rec) {
    card.style.display = 'none';
    titleEl.textContent = '';
    msgEl.textContent = '';
    return;
  }
  card.style.display = 'block';
  titleEl.textContent = rec.title || 'Recommended Next Action';
  msgEl.textContent = rec.message || '';
  logAnalyticsEvent('recommendation_shown', {
    actionType: rec.actionType || null,
    suggestedScenarioId: rec.suggestedScenarioId || null,
    suggestedMode: rec.suggestedMode || null,
    level: selectedScenario?.level || selectedLevel,
  }).catch(()=>{});
}

function showAccessDenied() {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('access-denied').style.display = 'flex';
}

function showApp() {
  // Called when user is authenticated - set up their profile in AURA
  if (userProfile?.level) setLevel(userProfile.level.toUpperCase() === 'A2' ? 'A2' : 'A1');
  updateTrialBadge();
  onScenarioChange();
  refreshReadinessMeter(selectedLevel || userProgressSummary?.latestLevel);
  refreshDailyPracticeFocus().catch(()=>{});
  renderRecentPractice(userSessionHistory);
}

// ── HOMEPAGE INIT — runs for ALL visitors regardless of auth ──
document.addEventListener('DOMContentLoaded', () => {
  initScrollReveal();
  initHeroLetters();
  initConceptSection();
  initDemoTerminal();
  initNumberCounters();
});

// ── BROWSER BACK BUTTON — session back-nav (page routing handled by router popstate above) ──
// The router's popstate skips when speaking-interface is visible, so this fires instead.
window.addEventListener('popstate', (e) => {
  const speakingInterface = document.getElementById('speaking-interface');
  if (speakingInterface && speakingInterface.style.display !== 'none') {
    // User pressed back while inside AURA session -- return to dashboard
    clearInterval(sessionTimerInterval);
    cleanupLive();
    speakingInterface.style.display = 'none';
    document.getElementById('speak-session').style.display = 'none';
    document.getElementById('speak-score').style.display = 'none';
    document.body.classList.remove('exam-active');
    const navCta = document.querySelector('.gnav-cta');
    if (navCta) navCta.style.display = '';
    // Stay in app mode, show dashboard
    if (currentUser && userProfile?.onboardingComplete) {
      _showSpeakingInterface({ skipHistory: true });
    }
  }
});

function showTrialLimitPopup() { document.getElementById('trial-limit-modal').classList.add('open'); }
function updateTrialBadge() {
  if (isPaidStudent || !currentUser) return;
  // Legacy badge DOM hooks removed; keep function as intentional no-op callsite.
}

// ── NAVIGATION ────────────────────────────────
window.enterSpeakingInterface = () => {
  // Navigate to app mode first
  if (window.location.hash !== '#aura') {
    window.location.hash = '#aura';
  }
  document.documentElement.setAttribute('data-route', 'app');
  document.body.style.background = 'var(--app-bg)';

  // Phase 6: paywall gate before entering session
  if (checkPaywallGate()) return;

  // If not logged in, show auth screen
  if (!currentUser && !profileReady) {
    const authScreen = document.getElementById('auth-screen');
    const checking = document.getElementById('auth-checking');
    const formWrap = document.getElementById('auth-form-wrap');
    if (authScreen) authScreen.classList.add('active');
    if (checking) checking.classList.remove('active');
    if (formWrap) formWrap.style.display = '';
    return;
  }

  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.style.display = 'flex';

  // If profile is already fully loaded, go straight in
  if (profileReady) {
    if (!currentUser) {
      if (overlay) overlay.style.display = 'none';
      // Show auth screen instead of access-denied
      const authScreen = document.getElementById('auth-screen');
      const checking = document.getElementById('auth-checking');
      const formWrap = document.getElementById('auth-form-wrap');
      if (authScreen) authScreen.classList.add('active');
      if (checking) checking.classList.remove('active');
      if (formWrap) formWrap.style.display = '';
      return;
    }
    _showSpeakingInterface();
    return;
  }

  // Wait for full profile load (auth + Firestore), max 8s
  let resolved = false;
  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      if (overlay) overlay.style.display = 'none';
      if (!currentUser) {
        const authScreen = document.getElementById('auth-screen');
        const checking = document.getElementById('auth-checking');
        const formWrap = document.getElementById('auth-form-wrap');
        if (authScreen) authScreen.classList.add('active');
        if (checking) checking.classList.remove('active');
        if (formWrap) formWrap.style.display = '';
      } else {
        _showSpeakingInterface();
      }
    }
  }, 8000);

  const poll = setInterval(() => {
    if (profileReady || resolved) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        if (!currentUser) {
          if (overlay) overlay.style.display = 'none';
          const authScreen = document.getElementById('auth-screen');
          const checking = document.getElementById('auth-checking');
          const formWrap = document.getElementById('auth-form-wrap');
          if (authScreen) authScreen.classList.add('active');
          if (checking) checking.classList.remove('active');
          if (formWrap) formWrap.style.display = '';
        } else {
          _showSpeakingInterface();
        }
      }
      clearInterval(poll);
    }
  }, 100);
};

function _showSpeakingInterface(opts = {}) {
  const skipHistory = opts?.skipHistory === true;
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.style.display = 'none';
  // Hide dashboard if open
    // Hide whichever page is currently active
  document.querySelectorAll('.aura-page.active').forEach(p => p.classList.remove('active'));
  document.getElementById('speaking-interface').style.display = 'block';
  document.title = 'AURA — German Practice';
  const navCta = document.querySelector('.gnav-cta');
  if (navCta) navCta.style.display = 'none';
  if (!skipHistory && history.state?.aura !== 'speaking') {
    history.pushState({ aura: 'speaking' }, '', window.location.pathname + '#aura');
  }
  updateTrialBadge();
  onScenarioChange();
  refreshReadinessMeter(selectedLevel || userProgressSummary?.latestLevel);
  refreshDailyPracticeFocus().catch(()=>{});
  renderRecentPractice(userSessionHistory);
  syncSetupModeUI();
  updateSessionModeRecommendation();
};


// ── setupDailyFocusCardInteraction ────────────────────────────────────────────
function setupDailyFocusCardInteraction() {
  const card = document.getElementById('daily-focus-card');
  if (!card || card.dataset.bound === '1') return;
  const activate = () => window.applyTodayFocus && window.applyTodayFocus();
  card.addEventListener('click', activate);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
  });
  card.dataset.bound = '1';
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupDailyFocusCardInteraction, { once: true });
} else {
  setupDailyFocusCardInteraction();
}

// ── Window bindings ───────────────────────────────────────────────────────────
window.obBack              = obBack;
window.obNext              = obNext;
window.obValidateName      = obValidateName;
window.obSelectLang        = obSelectLang;
window.obValidateLangOther = obValidateLangOther;
window.obSelectLevel       = obSelectLevel;
window.obSelectGoal        = obSelectGoal;
window.obFinish            = obFinish;
window.showOnboarding      = showOnboarding;
window.hideOnboarding      = hideOnboarding;
window.dashStartSession    = dashStartSession;
window.showUpgradeModal    = showUpgradeModal;
window.checkPaywallGate    = checkPaywallGate;
window.routeAfterAuth      = routeAfterAuth;
window.updateTrialBadge    = updateTrialBadge;
window.practiceAgain       = () => { document.getElementById('speak-score').style.display='none'; document.getElementById('speak-setup').style.display=''; };
window.goToDashboard       = () => { document.getElementById('speak-score').style.display='none'; routeAfterAuth(); };

// ── Exports ───────────────────────────────────────────────────────────────────
export { showOnboarding, hideOnboarding, routeAfterAuth, checkPaywallGate, showUpgradeModal, dashStartSession, updateTrialBadge };

// ── Signal ready — drains queued enterSpeakingInterface calls ─────────────────
window.__uiReady && window.__uiReady();
