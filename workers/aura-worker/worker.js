/**
 * AURA Cloudflare Worker — Brain Edition (FIXED v2)
 *
 * Changes from previous version:
 *   1. Added /session-start as an alias for /token (fixes frontend 404)
 *   2. /memory and /progress require a valid Supabase auth token
 *   3. /token response no longer includes systemInstruction (IP protection)
 *   4. /token closes any already-active session before starting a new one
 *
 * Routes:
 *   POST /token         — start session (canonical)
 *   POST /session-start — alias for /token (frontend compatibility)
 *   POST /eval          — after each utterance: run errorAgent, write to DB
 *   POST /consolidate   — session end: run consolidationAgent, update all tables
 *   GET  /memory        — read student memory (auth required)
 *   GET  /progress      — read student_progress for a language (auth required)
 *
 * Required env vars:
 *   GEMINI_API_KEY
 *   SUPABASE_SERVICE_KEY
 *   ALLOWED_ORIGINS  (comma-separated)
 */

import { memoryAgent, curriculumAgent, instructionAgent, errorAgent, consolidationAgent } from './agents.js';
import { verifySupabaseToken } from './supabase-auth.js';

const SUPABASE_URL = 'https://wkdwjhpeaahonuixqgwq.supabase.co';
const LIVE_MODEL = 'models/gemini-3.1-flash-live-preview';
const DEFAULT_FREE_SESSION_LIMIT = 2;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_BY_IP = 120;
const RATE_LIMIT_MAX_BY_USER = 90;

const rateLimits = new Map();

// ─── CORS ────────────────────────────────────────────────────────────────────
function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);
  return allowed.includes(origin.trim().replace(/\/+$/, ''));
}
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
    'Vary': 'Origin',
  };
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}
function err(msg, status = 400, extra = {}) { return json({ error: msg }, status, extra); }

function withLimit(bucket, max, now = Date.now()) {
  const key = `${bucket}`;
  const hit = rateLimits.get(key);
  if (!hit || (now - hit.windowStart) >= RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (hit.count >= max) return false;
  hit.count += 1;
  return true;
}

function enforceRateLimit(request, userId = null) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown';
  const now = Date.now();
  if (!withLimit(`ip:${ip}`, RATE_LIMIT_MAX_BY_IP, now)) return false;
  if (userId && !withLimit(`uid:${userId}`, RATE_LIMIT_MAX_BY_USER, now)) return false;
  return true;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url    = new URL(request.url);
    const path   = url.pathname;

    try {
      if (request.method === 'OPTIONS') {
        if (!isAllowedOrigin(origin, env)) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      if (!isAllowedOrigin(origin, env)) return err('Forbidden origin', 403);

      const cors = corsHeaders(origin);

      if (path === '/' && request.method === 'GET')
        return json({ ok: true, service: 'AURA Brain Worker v2', routes: ['/token','/session-start','/eval','/consolidate','/memory','/progress'] }, 200, cors);

      // ── CANONICAL + ALIAS ROUTES ──────────────────────────────────────────
      // /session-start is an alias for /token — both do the same thing.
      // The frontend historically used /session-start; /token is the canonical name.
      if ((path === '/token' || path === '/session-start') && request.method === 'POST')
        return handleToken(request, env, cors);

      if (path === '/eval'        && request.method === 'POST') return handleEval(request, env, cors);
      if (path === '/consolidate' && request.method === 'POST') return handleConsolidate(request, env, cors);
      if (path === '/memory'      && request.method === 'GET')  return handleMemory(request, env, cors);
      if (path === '/progress'    && request.method === 'GET')  return handleProgress(request, env, cors);

      return err('Not found', 404, cors);
    } catch (e) {
      console.error('[AURA Worker] Error:', e?.message || e);
      return err('Internal error: ' + (e?.message || 'unknown'), 500);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /token  (also handles /session-start)
// 1. Verify Supabase auth token
// 2. Close any already-active session
// 3. Run memoryAgent — get full student picture
// 4. Run curriculumAgent — pick today's node
// 5. Run instructionAgent — build short Gemini instruction
// 6. Create Gemini Live token with that instruction
// 7. Create aura_sessions row
// ─────────────────────────────────────────────────────────────────────────────
async function handleToken(request, env, cors) {
  const body    = await request.json().catch(() => null);
  const idToken = body?.idToken;
  if (!idToken) return err('idToken required', 401, cors);

  let authUser;
  try {
    authUser = await verifySupabaseToken(idToken, env);
  } catch (e) {
    return err('Invalid or expired sign-in token', 401, cors);
  }

  const userId = authUser?.uid;
  if (!userId) return err('Unable to resolve user', 401, cors);
  if (!enforceRateLimit(request, userId)) return err('Too many requests', 429, cors);

  // Authoritative free-tier gate (server-side)
  const freeLimit = Number(env.FREE_SESSION_LIMIT || DEFAULT_FREE_SESSION_LIMIT) || DEFAULT_FREE_SESSION_LIMIT;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const userRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=id,is_paid,is_paid_student,free_sessions_used_this_month,free_sessions_month_key&limit=1`,
    { headers: supabaseHeaders(env) }
  );
  const userRows = userRes.ok ? await userRes.json() : [];
  const userRow = userRows?.[0] || null;
  if (!userRow) return err('User profile not found', 403, cors);

  const isPaid = !!(userRow.is_paid || userRow.is_paid_student);
  let reservedFreeSession = false;
  let reservedCount = null;
  if (!isPaid) {
    const used = userRow.free_sessions_month_key === currentMonth
      ? (userRow.free_sessions_used_this_month || 0)
      : 0;
    if (used >= freeLimit) {
      return json({ error: 'Free session limit reached', upgrade: true, used, limit: freeLimit }, 403, cors);
    }

    const nextUsed = used + 1;
    const bumpRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { ...supabaseHeaders(env), 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        free_sessions_month_key: currentMonth,
        free_sessions_used_this_month: nextUsed,
      }),
    });
    if (!bumpRes.ok) return err('Unable to reserve free session', 503, cors);
    reservedFreeSession = true;
    reservedCount = nextUsed;
  }

  // Close any existing open session before starting a new one
  const activeSessionRes = await fetch(
    `${SUPABASE_URL}/rest/v1/aura_sessions?user_id=eq.${userId}&ended_at=is.null&select=id,started_at&limit=1`,
    { headers: supabaseHeaders(env) }
  );
  if (activeSessionRes.ok) {
    const activeSessions = await activeSessionRes.json();
    if (activeSessions?.length > 0) {
      const activeSession = activeSessions[0];
      await fetch(
        `${SUPABASE_URL}/rest/v1/aura_sessions?id=eq.${activeSession.id}`,
        {
          method:  'PATCH',
          headers: { ...supabaseHeaders(env), 'Prefer': 'return=minimal' },
          body:    JSON.stringify({ ended_at: new Date().toISOString(), ended_naturally: false }),
        }
      );
    }
  }

  // Run memory agent and curriculum agent
  const studentMemory    = await memoryAgent(env, userId, body?.language || 'German');
  const curriculumResult = await curriculumAgent(env, userId, studentMemory.targetLanguage, studentMemory);

  // Build the short instruction
  const systemInstruction = instructionAgent(studentMemory, curriculumResult);

  // Create session id now; DB row is inserted only after Gemini token succeeds.
  const sessionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  // Get Gemini Live ephemeral token
  const expireTime           = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uses: 1,
          expireTime,
          newSessionExpireTime,
          bidiGenerateContentSetup: {
            model: LIVE_MODEL,
            generationConfig: { responseModalities: ['AUDIO'] },
            inputAudioTranscription:  {},
            outputAudioTranscription: {},
            systemInstruction: { parts: [{ text: systemInstruction }] },
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const text = await geminiRes.text();
      console.error('[/token] Gemini error:', geminiRes.status, text);
      throw new Error(`Gemini token error: ${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json();
    const token      = geminiData?.name || null;
    if (!token) throw new Error('No token from Gemini');

    await createSessionRow(env, userId, sessionId, startedAt, studentMemory, curriculumResult);

    // Race-condition mitigation: close all other still-open sessions for this user.
    await fetch(
      `${SUPABASE_URL}/rest/v1/aura_sessions?user_id=eq.${userId}&ended_at=is.null&id=neq.${sessionId}`,
      {
        method: 'PATCH',
        headers: { ...supabaseHeaders(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ ended_at: new Date().toISOString(), ended_naturally: false }),
      }
    );

    return json({
      token,
      sessionId,
      userId,
      model:            LIVE_MODEL,
      currentNode:      curriculumResult.node,
      curriculumReason: curriculumResult.reason,
      // systemInstruction intentionally excluded — Gemini already received it
    }, 200, cors);
  } catch (e) {
    if (reservedFreeSession && reservedCount !== null) {
      await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { ...supabaseHeaders(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          free_sessions_month_key: currentMonth,
          free_sessions_used_this_month: Math.max(0, reservedCount - 1),
        }),
      }).catch(() => {});
    }
    const msg = e?.message || 'token setup failed';
    const status = msg.startsWith('Gemini token error') || msg.includes('No token from Gemini') ? 502 : 500;
    return err(msg, status, cors);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /eval
// ─────────────────────────────────────────────────────────────────────────────
async function handleEval(request, env, cors) {
  const authHeader = request.headers.get('Authorization') || '';
  const idToken    = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return err('Authorization header required', 401, cors);

  let authUser;
  try {
    authUser = await verifySupabaseToken(idToken, env);
  } catch {
    return err('Invalid or expired token', 401, cors);
  }
  const userId = authUser?.uid;
  if (!userId) return err('Unauthorized', 401, cors);
  if (!enforceRateLimit(request, userId)) return err('Too many requests', 429, cors);

  const body = await request.json().catch(() => null);
  const { sessionId, transcript, confidence, utteranceIndex, nodeId, language, evalResult } = body || {};

  if (!sessionId || !transcript) return err('sessionId and transcript required', 400, cors);

  const result = await errorAgent(env, userId, sessionId, utteranceIndex || 0, {
    transcript,
    confidence:  confidence || null,
    language:    language   || 'German',
    nodeId:      nodeId     || null,
    evalResult:  evalResult || {},
  });

  return json(result, 200, cors);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /consolidate
// ─────────────────────────────────────────────────────────────────────────────
async function handleConsolidate(request, env, cors) {
  const authHeader = request.headers.get('Authorization') || '';
  const idToken    = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return err('Authorization header required', 401, cors);

  let authUser;
  try {
    authUser = await verifySupabaseToken(idToken, env);
  } catch {
    return err('Invalid or expired token', 401, cors);
  }
  const userId = authUser?.uid;
  if (!userId) return err('Unauthorized', 401, cors);
  if (!enforceRateLimit(request, userId)) return err('Too many requests', 429, cors);

  const body = await request.json().catch(() => null);
  const { sessionId, language, profileId } = body || {};

  if (!sessionId) return err('sessionId required', 400, cors);

  const result = await consolidationAgent(
    env, userId, sessionId,
    language  || 'German',
    profileId || null,
    env.GEMINI_API_KEY,
  );

  return json(result, 200, cors);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /memory?language=...
// Auth required. User can only read their own memory.
// ─────────────────────────────────────────────────────────────────────────────
async function handleMemory(request, env, cors) {
  const authHeader = request.headers.get('Authorization') || '';
  const idToken    = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return err('Authorization header required', 401, cors);

  let authUser;
  try {
    authUser = await verifySupabaseToken(idToken, env);
  } catch {
    return err('Invalid or expired token', 401, cors);
  }
  const userId = authUser?.uid;
  if (!userId) return err('Unauthorized', 401, cors);

  const language = new URL(request.url).searchParams.get('language') || 'German';
  const memory   = await memoryAgent(env, userId, language);
  return json(memory, 200, cors);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /progress?language=...
// Auth required. User can only read their own progress.
// ─────────────────────────────────────────────────────────────────────────────
async function handleProgress(request, env, cors) {
  const authHeader = request.headers.get('Authorization') || '';
  const idToken    = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return err('Authorization header required', 401, cors);

  let authUser;
  try {
    authUser = await verifySupabaseToken(idToken, env);
  } catch {
    return err('Invalid or expired token', 401, cors);
  }
  const userId = authUser?.uid;
  if (!userId) return err('Unauthorized', 401, cors);

  const language = new URL(request.url).searchParams.get('language') || 'German';
  const h        = supabaseHeaders(env);

  const [progressRes, nodesRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/student_progress?user_id=eq.${userId}&language=eq.${encodeURIComponent(language)}&select=node_id,status,mastery_score,times_practiced,last_practiced,next_review_at`,
      { headers: h }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/curriculum_nodes?language=eq.${encodeURIComponent(language)}&order=sort_order.asc&select=id,cefr_level,category,title`,
      { headers: h }
    ),
  ]);

  const progress = progressRes.ok ? await progressRes.json() : [];
  const nodes    = nodesRes.ok    ? await nodesRes.json()    : [];

  const progressMap = {};
  for (const p of progress) progressMap[p.node_id] = p;

  const result = nodes.map(n => ({
    ...n,
    status:          progressMap[n.id]?.status          || 'not_started',
    mastery_score:   progressMap[n.id]?.mastery_score   || 0,
    times_practiced: progressMap[n.id]?.times_practiced || 0,
    last_practiced:  progressMap[n.id]?.last_practiced  || null,
    next_review_at:  progressMap[n.id]?.next_review_at  || null,
  }));

  return json(result, 200, cors);
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL
// ─────────────────────────────────────────────────────────────────────────────
function supabaseHeaders(env) {
  return {
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'apikey':        env.SUPABASE_SERVICE_KEY,
    'Content-Type':  'application/json',
  };
}

async function createSessionRow(env, userId, sessionId, startedAt, studentMemory, curriculumResult) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/aura_sessions`, {
    method:  'POST',
    headers: { ...supabaseHeaders(env), 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      id:              sessionId,
      user_id:         userId,
      target_language: studentMemory.targetLanguage || 'German',
      level:           studentMemory.level          || 'A2',
      mode:            studentMemory.preferredMode  || 'guided',
      scenario_title:  curriculumResult.node?.title || null,
      started_at:      startedAt,
      xp_earned:       0,
      words_spoken:    0,
      accuracy:        0,
      ended_naturally: false,
    }),
  });
  if (!res.ok) {
    const details = await res.text();
    throw new Error(`[createSessionRow] failed: ${details}`);
  }
}
