// ── Worker endpoints ──────────────────────────────────────────────────────────
export const WORKER_URL          = 'https://aura-token-worker.jeetupadhyay1204.workers.dev';
export const DEEPGRAM_WORKER_URL = 'https://aura-deepgram-worker.jeetupadhyay1204.workers.dev';

// ── Gemini ────────────────────────────────────────────────────────────────────
export const GEMINI_WS_KEY       = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const GEMINI_WS_EPHEMERAL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';
export const MODEL               = 'models/gemini-3.1-flash-live-preview';

// ── Paywall ───────────────────────────────────────────────────────────────────
export const FREE_SESSION_LIMIT  = 2;

// ── Session defaults ──────────────────────────────────────────────────────────
export const SILENCE_MS              = 30000;
export const DEFAULT_SESSION_SECONDS = 20 * 60;

// ── Firebase ──────────────────────────────────────────────────────────────────
export const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDx2fBrlxNP_zs0xra8ccXyCHQtnHud30E',
  authDomain:        'german-made-easy.firebaseapp.com',
  projectId:         'german-made-easy',
  storageBucket:     'german-made-easy.firebasestorage.app',
  messagingSenderId: '259276936055',
  appId:             '1:259276936055:web:5c9b4916734d0271100772'
};
