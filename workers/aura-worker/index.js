/**
 * aura-worker — Cloudflare Worker (brain / memory service)
 *
 * Routes
 *   POST /token          Verify Supabase JWT → mint Gemini ephemeral token → create session
 *   POST /eval           Store one utterance evaluation (fire-and-forget, DB write in waitUntil)
 *   POST /consolidate    Respond immediately; run AI memory consolidation in waitUntil
 *
 * Environment variables (set in Cloudflare dashboard / wrangler secret)
 *   SUPABASE_URL         e.g. https://xxx.supabase.co
 *   SUPABASE_SERVICE_KEY Service-role secret key (never exposed to browser)
 *   SUPABASE_ANON_KEY    Public anon key (used only to verify user JWTs)
 *   GEMINI_API_KEY       Google AI Studio API key with Live API access
 *   CLAUDE_API_KEY       Anthropic API key for memory consolidation
 *   ALLOWED_ORIGIN       Comma-separated allowed CORS origins (or * for dev)
 */

// ── CORS ──────────────────────────────────────────────────────────────────────

function corsHeaders(req, env) {
  const origin = req?.headers?.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
  const allow = allowed.includes('*') || allowed.includes(origin) ? origin || '*' : '';
  return {
    'Access-Control-Allow-Origin': allow || 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200, req, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req, env), 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400, req, env) {
  return json({ error: msg }, status, req, env);
}

// ── Supabase REST helpers ─────────────────────────────────────────────────────

async function sbFetch(env, method, path, body, extra = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: extra.prefer ?? (method === 'POST' ? 'return=representation' : ''),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${path} → ${res.status} ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Validate a user JWT against Supabase Auth; returns the user object or null.
async function verifyJWT(env, idToken) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// ── /token ────────────────────────────────────────────────────────────────────

async function handleToken(env, req) {
  const body = await req.json().catch(() => ({}));
  const { idToken, language = 'German' } = body;

  if (!idToken) return err('idToken required', 400, req, env);

  const user = await verifyJWT(env, idToken);
  if (!user?.id) return err('Invalid or expired token', 401, req, env);

  const userId = user.id;

  // User profile (level, preferred mode, etc.)
  const profiles = await sbFetch(env, 'GET', `/user_profiles?id=eq.${userId}&select=*&limit=1`).catch(() => null);
  const profile  = profiles?.[0] ?? null;

  // Determine curriculum node
  let currentNode     = null;
  let curriculumReason = 'no node found';

  if (profile?.level) {
    const nodes = await sbFetch(
      env, 'GET',
      `/curriculum_nodes?language=eq.${encodeURIComponent(language)}&level=eq.${encodeURIComponent(profile.level)}&order=order_index.asc&limit=1&select=id,title,level`,
    ).catch(() => null);
    if (nodes?.[0]) {
      currentNode      = { id: nodes[0].id, title: nodes[0].title };
      curriculumReason = `${profile.level} node for ${language}`;
    }
  }

  // User's memory snapshot for this language (injected into system prompt context)
  const mems = await sbFetch(
    env, 'GET',
    `/user_memory?user_id=eq.${userId}&language=eq.${encodeURIComponent(language)}&select=summary,next_focus,error_patterns&limit=1`,
  ).catch(() => null);
  const memorySnapshot = mems?.[0] ?? null;

  // Create session record
  const sessionId = crypto.randomUUID();
  await sbFetch(env, 'POST', '/sessions', {
    id:         sessionId,
    user_id:    userId,
    language,
    node_id:    currentNode?.id ?? null,
    started_at: new Date().toISOString(),
    status:     'active',
  }).catch(e => console.error('[/token] session insert failed:', e.message));

  // Gemini ephemeral token
  // POST /v1beta/ephemeralTokens returns { name: "ephemeralTokens/<token>", expireTime }
  // The WebSocket uses ?access_token=<token> (the part after the slash).
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/ephemeralTokens?key=${env.GEMINI_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
          },
        },
        ttl: '300s',
      }),
    },
  );

  if (!geminiRes.ok) {
    const txt = await geminiRes.text().catch(() => '');
    console.error('[/token] Gemini ephemeral token error:', geminiRes.status, txt);
    return err('Failed to obtain Gemini session token', 502, req, env);
  }

  const geminiData = await geminiRes.json().catch(() => ({}));
  // name is "ephemeralTokens/AbCdEf…" — extract just the token part
  const rawName = geminiData.name ?? geminiData.token ?? '';
  const token   = rawName.includes('/') ? rawName.split('/').pop() : rawName;

  if (!token) return err('Gemini returned no token', 502, req, env);

  return json({
    token,
    sessionId,
    userId,
    currentNode,
    curriculumReason,
    memorySnapshot,
  }, 200, req, env);
}

// ── /eval ─────────────────────────────────────────────────────────────────────

async function handleEval(env, ctx, req) {
  const body = await req.json().catch(() => ({}));
  const { userId, sessionId, transcript, confidence, utteranceIndex, nodeId, language, evalResult } = body;

  if (!userId || !sessionId || !transcript) {
    return err('userId, sessionId, transcript required', 400, req, env);
  }

  // Respond immediately; the DB write happens in the background.
  ctx.waitUntil(
    sbFetch(env, 'POST', '/session_utterances', {
      id:               crypto.randomUUID(),
      session_id:       sessionId,
      user_id:          userId,
      utterance_index:  utteranceIndex ?? 0,
      transcript,
      confidence:       confidence ?? null,
      node_id:          nodeId ?? null,
      language:         language ?? 'German',
      corrections:      evalResult?.corrections ?? [],
      accuracy:         evalResult?.accuracy ?? 1.0,
      xp_delta:         evalResult?.xpDelta ?? 0,
      created_at:       new Date().toISOString(),
    }).catch(e => console.error('[/eval] insert failed:', e.message)),
  );

  return json({ ok: true }, 200, req, env);
}

// ── /consolidate ──────────────────────────────────────────────────────────────

async function handleConsolidate(env, ctx, req) {
  const body = await req.json().catch(() => ({}));
  const { userId, sessionId, language = 'German', profileId } = body;

  if (!userId || !sessionId) {
    return err('userId and sessionId required', 400, req, env);
  }

  // Kick off the heavy work asynchronously — avoids Cloudflare's CPU-time limit
  // on the response path and eliminates stream-timeout issues with AI API calls.
  ctx.waitUntil(runConsolidation(env, { userId, sessionId, language, profileId }));

  // Respond immediately so the client is not blocked.
  return json({ ok: true, summary: null, nextFocus: null, totalXp: 0, newStreak: 0, levelUp: false }, 200, req, env);
}

async function runConsolidation(env, { userId, sessionId, language, profileId }) {
  try {
    // 1. All utterances for this session
    const utterances = await sbFetch(
      env, 'GET',
      `/session_utterances?session_id=eq.${sessionId}&order=utterance_index.asc&select=*`,
    ).catch(() => null);

    if (!utterances?.length) {
      console.log('[consolidate] no utterances for session', sessionId);
      await markSessionDone(env, sessionId);
      return;
    }

    // 2. Existing memory for this language
    const mems = await sbFetch(
      env, 'GET',
      `/user_memory?user_id=eq.${userId}&language=eq.${encodeURIComponent(language)}&select=summary,next_focus,error_patterns&limit=1`,
    ).catch(() => null);
    const prev = mems?.[0] ?? null;

    // 3. Build a compact transcript for Claude
    const lines = utterances.map(u => {
      const corr = u.corrections?.[0];
      const note = corr?.wrong ? ` [✗ "${corr.wrong}" → "${corr.right}"]` : '';
      return `Student: "${u.transcript}"${note}`;
    });
    const transcriptText = lines.join('\n');
    const errorCount     = utterances.filter(u => u.corrections?.length > 0).length;
    const totalXpDelta   = utterances.reduce((s, u) => s + (u.xp_delta ?? 0), 0);

    // 4. Claude call — non-streaming, capped at 512 tokens so it's fast
    const prompt = `You are a language-learning memory consolidator for ${language}.

Previous memory:
${prev?.summary ?? 'No previous sessions.'}

Session (${utterances.length} turns, ${errorCount} with errors):
${transcriptText}

Reply with ONLY a valid JSON object, no markdown fences:
{
  "summary": "<2-3 sentence description of student level and recurring patterns>",
  "nextFocus": "<single most important practice priority>",
  "errorPatterns": ["<pattern1>", "<pattern2>"]
}`;

    let summary       = prev?.summary      ?? 'Session completed.';
    let nextFocus     = prev?.next_focus   ?? null;
    let errorPatterns = prev?.error_patterns ?? [];

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (claudeRes.ok) {
      const data    = await claudeRes.json().catch(() => ({}));
      const rawText = data.content?.[0]?.text ?? '';
      try {
        const parsed  = JSON.parse(rawText);
        summary       = parsed.summary       || summary;
        nextFocus     = parsed.nextFocus     || nextFocus;
        errorPatterns = parsed.errorPatterns ?? errorPatterns;
      } catch {
        if (rawText.length > 10) summary = rawText.slice(0, 500);
      }
    } else {
      const txt = await claudeRes.text().catch(() => '');
      console.error('[consolidate] Claude error:', claudeRes.status, txt);
    }

    // 5. Upsert user_memory — merge-duplicates on (user_id, language) unique key
    await sbFetch(
      env, 'POST', '/user_memory',
      {
        user_id:        userId,
        language,
        summary,
        error_patterns: errorPatterns,
        next_focus:     nextFocus,
        updated_at:     new Date().toISOString(),
      },
      { prefer: 'resolution=merge-duplicates,return=minimal' },
    ).catch(e => console.error('[consolidate] memory upsert failed:', e.message));

    // 6. Update XP on user profile
    if (totalXpDelta > 0) {
      const profiles = await sbFetch(
        env, 'GET', `/user_profiles?id=eq.${userId}&select=xp&limit=1`,
      ).catch(() => null);
      const currentXp = profiles?.[0]?.xp ?? 0;
      await sbFetch(
        env, 'PATCH', `/user_profiles?id=eq.${userId}`,
        { xp: currentXp + totalXpDelta, last_session_at: new Date().toISOString() },
        { prefer: 'return=minimal' },
      ).catch(e => console.error('[consolidate] XP update failed:', e.message));
    }

    // 7. Mark session completed
    await markSessionDone(env, sessionId);

    console.log('[consolidate] done', { sessionId, totalXpDelta, errorCount, nextFocus });

  } catch (e) {
    console.error('[consolidate] unhandled error:', e.message);
  }
}

async function markSessionDone(env, sessionId) {
  await sbFetch(
    env, 'PATCH', `/sessions?id=eq.${sessionId}`,
    { ended_at: new Date().toISOString(), status: 'completed' },
    { prefer: 'return=minimal' },
  ).catch(e => console.error('[consolidate] session status update failed:', e.message));
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    }

    if (req.method !== 'POST') {
      return err('Method not allowed', 405, req, env);
    }

    try {
      switch (url.pathname) {
        case '/token':       return await handleToken(env, req);
        case '/eval':        return await handleEval(env, ctx, req);
        case '/consolidate': return await handleConsolidate(env, ctx, req);
        default:             return err('Not found', 404, req, env);
      }
    } catch (e) {
      console.error('[worker] unhandled error:', e?.message, e?.stack);
      return err('Internal server error', 500, req, env);
    }
  },
};
