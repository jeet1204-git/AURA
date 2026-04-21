// ── Worker endpoints ──────────────────────────────────────────────────────────

export const WORKER_URL = 'https://aura-worker.jeetupadhyay1204.workers.dev';

export const DEEPGRAM_WORKER_URL = 'https://aura-deepgram-worker.jeetupadhyay1204.workers.dev';

// ── Gemini ────────────────────────────────────────────────────────────────────

export const GEMINI_WS_KEY = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export const GEMINI_WS_EPHEMERAL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

export const MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

// ── Paywall ───────────────────────────────────────────────────────────────────

export const FREE_SESSION_LIMIT = 2;

// ── Session defaults ──────────────────────────────────────────────────────────

export const SILENCE_MS = 30000;

export const DEFAULT_SESSION_SECONDS = 20 * 60;

// ── Supabase ──────────────────────────────────────────────────────────────────

export const SUPABASE_URL = 'https://wkdwjhpeaahonuixqgwq.supabase.co';

// IMPORTANT:
// - Use Supabase publishable key (starts with sb_publishable_)
// - Do NOT use legacy JWT anon key (starts with eyJ) when legacy keys are disabled
// Priority: runtime global override -> Vite env -> placeholder.
const runtimePublishable = globalThis.__AURA_SUPABASE_PUBLISHABLE_KEY;
const vitePublishable = (typeof import.meta !== 'undefined' && import.meta.env)
  ? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  : undefined;

export const SUPABASE_ANON_KEY = runtimePublishable || vitePublishable || 'sb_publishable_REPLACE_ME';
