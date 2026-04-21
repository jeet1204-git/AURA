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

// IMPORTANT: use the new Supabase publishable key (starts with sb_publishable_),
// not the legacy JWT anon key (starts with eyJ) when legacy keys are disabled.
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrZHdqaHBlYWFob251aXhxZ3dxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDc5NzEsImV4cCI6MjA5MDgyMzk3MX0.FQU7NE4GpyBDJiAy3gOPpzBSLOaxIyscckZOehTgYeU';
 
