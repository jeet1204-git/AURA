// ── Session state machine ─────────────────────────────────────────────────────
export const SESSION_STATES = Object.freeze({
  IDLE:         'IDLE',
  INITIALIZING: 'INITIALIZING',
  READY:        'READY',
  WARMUP:       'WARMUP',
  TASK_ACTIVE:  'TASK_ACTIVE',
  SCORING:      'SCORING',
  FEEDBACK:     'FEEDBACK',
  COMPLETED:    'COMPLETED',
  FAILED:       'FAILED',
  ABANDONED:    'ABANDONED',
});

export const SESSION_TRANSITIONS = Object.freeze({
  [SESSION_STATES.IDLE]:         [SESSION_STATES.INITIALIZING],
  [SESSION_STATES.INITIALIZING]: [SESSION_STATES.READY, SESSION_STATES.FAILED],
  [SESSION_STATES.READY]:        [SESSION_STATES.WARMUP, SESSION_STATES.TASK_ACTIVE, SESSION_STATES.ABANDONED],
  [SESSION_STATES.WARMUP]:       [SESSION_STATES.TASK_ACTIVE, SESSION_STATES.ABANDONED, SESSION_STATES.FAILED],
  [SESSION_STATES.TASK_ACTIVE]:  [SESSION_STATES.SCORING, SESSION_STATES.ABANDONED, SESSION_STATES.FAILED],
  [SESSION_STATES.SCORING]:      [SESSION_STATES.FEEDBACK, SESSION_STATES.FAILED],
  [SESSION_STATES.FEEDBACK]:     [SESSION_STATES.COMPLETED, SESSION_STATES.FAILED],
  [SESSION_STATES.COMPLETED]:    [SESSION_STATES.IDLE],
  [SESSION_STATES.FAILED]:       [SESSION_STATES.IDLE],
  [SESSION_STATES.ABANDONED]:    [SESSION_STATES.IDLE],
});

// ── Stage engine ──────────────────────────────────────────────────────────────
export const STAGE = Object.freeze({
  WARMUP:    'warmup',
  TASK:      'task',
  EXPANSION: 'expansion',
  WRAPUP:    'wrapup',
});

// ── Blueprint policies ────────────────────────────────────────────────────────
export const BLUEPRINT_POLICIES = {

  a1_guided: {
    promptProfile: 'a1_guided_v1',
    warmup_config: {
      enabled: true,
      question_count: 2,
      style: 'personal_and_simple',
      note: 'Start with 1-2 simple personal questions to reduce anxiety and establish rhythm.',
    },
    interaction_policy: {
      max_tutor_sentences_per_turn: 2,
      support_language_allowed: true,
      support_language_usage: 'frequent',
      model_sentences_allowed: true,
      correction_style: 'immediate_gentle',
      correction_timing: 'after_attempt',
      expansion_prompts_allowed: true,
      one_task_at_a_time: true,
    },
    intervention_policy: {
      p1_silence_threshold_ms: 8000,
      p2_one_word_answer_action: 'model_full_sentence',
      p3_grammar_error_action: 'recast_then_continue',
      p4_off_topic_action: 'redirect_in_support_lang',
      p5_repeated_failure_action: 'simplify_task',
      correction_cooldown_turns: 1,
      max_corrections_per_stage: 4,
      support_dependence_tracking: true,
    },
    stage_flow: [
      { stage: 'warmup',    purpose: 'activate speech, reduce anxiety',          exit_condition: '2 personal questions answered' },
      { stage: 'task',      purpose: 'guided roleplay in scenario',               exit_condition: 'core task objective met' },
      { stage: 'expansion', purpose: 'push for richer language',                  exit_condition: '1 expanded answer produced' },
      { stage: 'wrapup',    purpose: 'close session, acknowledge effort',         exit_condition: 'closing exchange complete' },
    ],
    completion_policy: {
      min_user_turns: 6,
      min_expanded_responses: 1,
      task_completion_required: true,
      support_dependence_cap: 0.7,
      recovery_task_on_fail: true,
    },
  },

  a1_immersion: {
    promptProfile: 'a1_immersion_v1',
    warmup_config: {
      enabled: true,
      question_count: 1,
      style: 'simple_german_first',
      note: 'One short German-first warmup question. Less scaffolding than guided.',
    },
    interaction_policy: {
      max_tutor_sentences_per_turn: 2,
      support_language_allowed: true,
      support_language_usage: 'rescue_only',
      model_sentences_allowed: true,
      correction_style: 'brief_recast',
      correction_timing: 'after_attempt',
      expansion_prompts_allowed: true,
      one_task_at_a_time: true,
    },
    intervention_policy: {
      p1_silence_threshold_ms: 10000,
      p2_one_word_answer_action: 'clarification_prompt_in_german',
      p3_grammar_error_action: 'natural_recast_no_explanation',
      p4_off_topic_action: 'redirect_in_german',
      p5_repeated_failure_action: 'one_support_lang_rescue_then_german',
      correction_cooldown_turns: 2,
      max_corrections_per_stage: 3,
      support_dependence_tracking: true,
    },
    stage_flow: [
      { stage: 'warmup',    purpose: 'establish German-first rhythm',             exit_condition: '1 warmup exchange complete' },
      { stage: 'task',      purpose: 'immersive roleplay, mostly German',         exit_condition: 'core task objective met' },
      { stage: 'expansion', purpose: 'push for longer independent answers',       exit_condition: '1 expanded answer produced' },
      { stage: 'wrapup',    purpose: 'close in German',                           exit_condition: 'closing exchange complete' },
    ],
    completion_policy: {
      min_user_turns: 6,
      min_expanded_responses: 1,
      task_completion_required: true,
      support_dependence_cap: 0.5,
      recovery_task_on_fail: true,
    },
  },

  a2_guided: {
    promptProfile: 'a2_guided_v1',
    warmup_config: {
      enabled: true,
      question_count: 2,
      style: 'connected_answer_warmup',
      note: 'Warmup should expect 2-3 sentence responses, not single words. Establish A2 rhythm.',
    },
    interaction_policy: {
      max_tutor_sentences_per_turn: 3,
      support_language_allowed: true,
      support_language_usage: 'selective',
      model_sentences_allowed: false,
      correction_style: 'self_repair_first',
      correction_timing: 'after_attempt_allow_self_repair',
      expansion_prompts_allowed: true,
      layered_followups_required: true,
      one_task_at_a_time: false,
    },
    intervention_policy: {
      p1_silence_threshold_ms: 10000,
      p2_one_word_answer_action: 'layered_followup_prompt',
      p3_grammar_error_action: 'self_repair_prompt_first',
      p4_off_topic_action: 'redirect_in_german_with_task_anchor',
      p5_repeated_failure_action: 'targeted_cue_no_full_model',
      correction_cooldown_turns: 2,
      max_corrections_per_stage: 3,
      support_dependence_tracking: true,
    },
    stage_flow: [
      { stage: 'warmup',    purpose: 'activate connected speech at A2 level',    exit_condition: '2 multi-sentence responses given' },
      { stage: 'task',      purpose: 'guided A2 roleplay with layered followups', exit_condition: 'core task + 1 reason/detail given' },
      { stage: 'expansion', purpose: 'push for richer connectors and opinions',   exit_condition: '1 connector used independently' },
      { stage: 'wrapup',    purpose: 'acknowledge and frame next step',           exit_condition: 'closing exchange complete' },
    ],
    completion_policy: {
      min_user_turns: 8,
      min_expanded_responses: 2,
      task_completion_required: true,
      support_dependence_cap: 0.5,
      recovery_task_on_fail: true,
    },
  },

  a2_immersion: {
    promptProfile: 'a2_immersion_v1',
    warmup_config: {
      enabled: false,
      note: 'A2 immersion starts directly in scenario. No warmup scaffolding.',
    },
    interaction_policy: {
      max_tutor_sentences_per_turn: 2,
      support_language_allowed: true,
      support_language_usage: 'stall_rescue_only',
      model_sentences_allowed: false,
      correction_style: 'natural_recast_only',
      correction_timing: 'delayed_or_checkpoint',
      expansion_prompts_allowed: true,
      layered_followups_required: true,
      one_task_at_a_time: false,
    },
    intervention_policy: {
      p1_silence_threshold_ms: 12000,
      p2_one_word_answer_action: 'clarification_pressure_in_german',
      p3_grammar_error_action: 'natural_recast_continue_flow',
      p4_off_topic_action: 'redirect_in_german_only',
      p5_repeated_failure_action: 'minimal_support_lang_cue',
      correction_cooldown_turns: 3,
      max_corrections_per_stage: 2,
      support_dependence_tracking: true,
    },
    stage_flow: [
      { stage: 'task',      purpose: 'full immersion roleplay, german-first',     exit_condition: 'core task + 1 independent expansion' },
      { stage: 'expansion', purpose: 'natural deepening without scaffolding',      exit_condition: 'learner produces connected answer' },
      { stage: 'wrapup',    purpose: 'natural German close',                       exit_condition: 'closing exchange complete' },
    ],
    completion_policy: {
      min_user_turns: 8,
      min_expanded_responses: 2,
      task_completion_required: true,
      support_dependence_cap: 0.35,
      recovery_task_on_fail: false,
    },
  },

  b1_guided: {
    promptProfile: 'b1_guided_v1',
    warmup_config: {
      enabled: true,
      question_count: 1,
      style: 'opinion_opener',
      note: 'Open with a broad opinion question. Expect multi-sentence responses immediately.',
    },
    interaction_policy: {
      max_tutor_sentences_per_turn: 2,
      support_language_allowed: true,
      support_language_usage: 'error_explanation_only',
      model_sentences_allowed: false,
      correction_style: 'delayed_recast',
      correction_timing: 'checkpoint',
      expansion_prompts_allowed: true,
      layered_followups_required: true,
      one_task_at_a_time: false,
    },
    intervention_policy: {
      p1_silence_threshold_ms: 12000,
      p2_one_word_answer_action: 'push_for_elaboration',
      p3_grammar_error_action: 'note_and_continue',
      p4_off_topic_action: 'redirect_in_german_only',
      p5_repeated_failure_action: 'minimal_cue_in_german',
      correction_cooldown_turns: 3,
      max_corrections_per_stage: 2,
      support_dependence_tracking: true,
    },
    stage_flow: [
      { stage: 'warmup',    purpose: 'establish B1 fluency baseline',             exit_condition: '1 multi-sentence opinion given' },
      { stage: 'task',      purpose: 'B1 roleplay with opinion and reasoning',    exit_condition: 'position stated + 2 reasons given' },
      { stage: 'expansion', purpose: 'push for nuanced vocabulary and register',  exit_condition: '1 complex sentence produced' },
      { stage: 'wrapup',    purpose: 'natural German close',                      exit_condition: 'closing exchange complete' },
    ],
    completion_policy: {
      min_user_turns: 8,
      min_expanded_responses: 3,
      task_completion_required: true,
      support_dependence_cap: 0.25,
      recovery_task_on_fail: false,
    },
  },

  b1_immersion: {
    promptProfile: 'b1_immersion_v1',
    warmup_config: {
      enabled: false,
      note: 'B1 immersion — no warmup. Direct scenario entry.',
    },
    interaction_policy: {
      max_tutor_sentences_per_turn: 2,
      support_language_allowed: false,
      support_language_usage: 'never',
      model_sentences_allowed: false,
      correction_style: 'natural_recast_only',
      correction_timing: 'end_of_turn',
      expansion_prompts_allowed: true,
      layered_followups_required: true,
      one_task_at_a_time: false,
    },
    intervention_policy: {
      p1_silence_threshold_ms: 15000,
      p2_one_word_answer_action: 'clarification_in_german',
      p3_grammar_error_action: 'silent_recast',
      p4_off_topic_action: 'redirect_in_german_only',
      p5_repeated_failure_action: 'one_german_cue_only',
      correction_cooldown_turns: 4,
      max_corrections_per_stage: 1,
      support_dependence_tracking: false,
    },
    stage_flow: [
      { stage: 'task',      purpose: 'full B1 immersion discussion',              exit_condition: 'topic fully explored' },
      { stage: 'expansion', purpose: 'push register and complexity',              exit_condition: 'complex sentence produced' },
      { stage: 'wrapup',    purpose: 'natural German close',                      exit_condition: 'closing exchange complete' },
    ],
    completion_policy: {
      min_user_turns: 8,
      min_expanded_responses: 3,
      task_completion_required: true,
      support_dependence_cap: 0.1,
      recovery_task_on_fail: false,
    },
  },

  b2_guided: {
    promptProfile: 'b2_guided_v1',
    warmup_config: {
      enabled: false,
      note: 'B2 — no warmup. Treat the student as near-fluent from the first turn.',
    },
    interaction_policy: {
      max_tutor_sentences_per_turn: 2,
      support_language_allowed: false,
      support_language_usage: 'never',
      model_sentences_allowed: false,
      correction_style: 'register_note_only',
      correction_timing: 'end_of_session',
      expansion_prompts_allowed: true,
      layered_followups_required: true,
      one_task_at_a_time: false,
    },
    intervention_policy: {
      p1_silence_threshold_ms: 15000,
      p2_one_word_answer_action: 'push_for_elaboration',
      p3_grammar_error_action: 'note_only_continue',
      p4_off_topic_action: 'redirect_in_german_only',
      p5_repeated_failure_action: 'single_german_cue',
      correction_cooldown_turns: 5,
      max_corrections_per_stage: 1,
      support_dependence_tracking: false,
    },
    stage_flow: [
      { stage: 'task',      purpose: 'B2 debate or discussion',                   exit_condition: 'position argued with evidence' },
      { stage: 'expansion', purpose: 'push for nuance and register',              exit_condition: 'register-appropriate vocabulary used' },
      { stage: 'wrapup',    purpose: 'natural close',                             exit_condition: 'closing exchange complete' },
    ],
    completion_policy: {
      min_user_turns: 8,
      min_expanded_responses: 4,
      task_completion_required: true,
      support_dependence_cap: 0.05,
      recovery_task_on_fail: false,
    },
  },

  b2_immersion: {
    promptProfile: 'b2_immersion_v1',
    warmup_config: { enabled: false, note: 'B2 immersion — no warmup.' },
    interaction_policy: {
      max_tutor_sentences_per_turn: 2,
      support_language_allowed: false,
      support_language_usage: 'never',
      model_sentences_allowed: false,
      correction_style: 'register_note_only',
      correction_timing: 'end_of_session',
      expansion_prompts_allowed: true,
      layered_followups_required: true,
      one_task_at_a_time: false,
    },
    intervention_policy: {
      p1_silence_threshold_ms: 15000,
      p2_one_word_answer_action: 'push_for_elaboration',
      p3_grammar_error_action: 'silent_recast',
      p4_off_topic_action: 'redirect_in_german_only',
      p5_repeated_failure_action: 'single_german_cue',
      correction_cooldown_turns: 5,
      max_corrections_per_stage: 1,
      support_dependence_tracking: false,
    },
    stage_flow: [
      { stage: 'task',      purpose: 'full B2 immersion debate',                  exit_condition: 'topic fully debated' },
      { stage: 'expansion', purpose: 'push for native-like register',             exit_condition: 'idiomatic expression used' },
      { stage: 'wrapup',    purpose: 'natural close',                             exit_condition: 'closing exchange complete' },
    ],
    completion_policy: {
      min_user_turns: 8,
      min_expanded_responses: 4,
      task_completion_required: true,
      support_dependence_cap: 0.05,
      recovery_task_on_fail: false,
    },
  },
};

// ── Scenarios ─────────────────────────────────────────────────────────────────
export const SCENARIOS = [

  // A1
  {
    id: 'a1_introduce_yourself',
    level: 'A1',
    targetLanguage: 'German',
    emoji: '👋',
    title: 'Introduce yourself',
    role: 'new acquaintance',
    desc: 'Name, age, where you live, what you do.',
  },
  {
    id: 'a1_at_the_cafe',
    level: 'A1',
    targetLanguage: 'German',
    emoji: '☕',
    title: 'At the cafe',
    role: 'barista',
    desc: 'Order a drink and a snack. Pay and say thank you.',
  },
  {
    id: 'a1_numbers_and_time',
    level: 'A1',
    targetLanguage: 'German',
    emoji: '🕐',
    title: 'Numbers and time',
    role: 'helpful stranger',
    desc: 'Ask for the time, say dates, talk about your week.',
  },
  {
    id: 'a1_family_and_home',
    level: 'A1',
    targetLanguage: 'German',
    emoji: '🏠',
    title: 'Family and home',
    role: 'friendly neighbour',
    desc: 'Describe your family and where you live.',
  },

  // A2
  {
    id: 'a2_daily_conversation',
    level: 'A2',
    targetLanguage: 'German',
    emoji: '💬',
    title: 'Daily conversation',
    role: 'conversation partner',
    desc: 'Everyday topics — yourself, your day, your plans.',
  },
  {
    id: 'a2_at_the_supermarket',
    level: 'A2',
    targetLanguage: 'German',
    emoji: '🛒',
    title: 'At the supermarket',
    role: 'shop assistant',
    desc: 'Find products, ask about prices, handle a small problem.',
  },
  {
    id: 'a2_making_plans',
    level: 'A2',
    targetLanguage: 'German',
    emoji: '📅',
    title: 'Making plans',
    role: 'friend',
    desc: 'Suggest a time to meet, agree on an activity, confirm details.',
  },
  {
    id: 'a2_doctor_appointment',
    level: 'A2',
    targetLanguage: 'German',
    emoji: '🩺',
    title: 'Doctor appointment',
    role: 'receptionist',
    desc: 'Book an appointment, describe symptoms simply.',
  },
  {
    id: 'a2_at_the_restaurant',
    level: 'A2',
    targetLanguage: 'German',
    emoji: '🍽️',
    title: 'At the restaurant',
    role: 'waiter',
    desc: 'Order food, ask about the menu, pay the bill.',
  },
  {
    id: 'a2_job_interview',
    level: 'A2',
    targetLanguage: 'German',
    emoji: '💼',
    title: 'Simple job interview',
    role: 'interviewer',
    desc: 'Talk about your experience, hobbies, and why you want the job.',
  },

  // B1
  {
    id: 'b1_opinion_discussion',
    level: 'B1',
    targetLanguage: 'German',
    emoji: '🗣️',
    title: 'Opinion discussion',
    role: 'debate partner',
    desc: 'Share and defend your views on an everyday topic.',
  },
  {
    id: 'b1_travel_and_plans',
    level: 'B1',
    targetLanguage: 'German',
    emoji: '✈️',
    title: 'Travel and plans',
    role: 'travel agent',
    desc: 'Plan a trip, compare options, handle a booking problem.',
  },
  {
    id: 'b1_at_work',
    level: 'B1',
    targetLanguage: 'German',
    emoji: '🖥️',
    title: 'At work',
    role: 'colleague',
    desc: 'Discuss a project, give an update, handle a misunderstanding.',
  },
  {
    id: 'b1_problem_solving',
    level: 'B1',
    targetLanguage: 'German',
    emoji: '🔧',
    title: 'Problem solving',
    role: 'customer service agent',
    desc: 'Describe a problem clearly and negotiate a solution.',
  },

  // B2
  {
    id: 'b2_debate',
    level: 'B2',
    targetLanguage: 'German',
    emoji: '⚖️',
    title: 'Debate',
    role: 'debate opponent',
    desc: 'Argue a position with evidence, respond to counterarguments.',
  },
  {
    id: 'b2_news_and_society',
    level: 'B2',
    targetLanguage: 'German',
    emoji: '📰',
    title: 'News and society',
    role: 'informed friend',
    desc: 'Discuss a current topic — technology, environment, culture.',
  },
];

// ── resolveScenarioForLevel ───────────────────────────────────────────────────
// Called by session.js before every session start to resolve the correct
// scenario object for the given level and optional preferred scenario ID.
export function resolveScenarioForLevel(level, scenarioId = null, targetLanguage = 'German') {
  const forLevel = SCENARIOS.filter(
    s => s.level === level && s.targetLanguage === targetLanguage
  );

  if (!forLevel.length) return null;

  if (scenarioId) {
    const exact = forLevel.find(s => s.id === scenarioId);
    if (exact) return exact;
  }

  return forLevel[0];
}
