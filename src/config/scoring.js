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
};
