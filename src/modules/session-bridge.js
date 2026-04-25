/**
 * session-bridge.js — AURA Live Session Engine
 * Uses buildSystemPrompt() from prompts.js for the text-fallback (Claude API) path only.
 * For voice sessions, the system instruction comes exclusively from the backend's
 * instructionAgent (embedded in the Gemini ephemeral token at /token time).
 * DO NOT send systemInstruction in the WebSocket setup message — it would override
 * the Supabase-informed instruction and lose CEFR mixing rules, session memory,
 * error history, and curriculum context.
 *
 * CHANGES FROM PREVIOUS VERSION:
 *  1. /token — now sends `language` field so the brain worker queries correct memory/curriculum
 *  2. /eval  — now called per-utterance with structured payload (not full transcript dump)
 *             sends: userId, sessionId, transcript, confidence, utteranceIndex, nodeId, language, evalResult
 *  3. /consolidate — now sends `language` + `profileId` (worker reads utterances from DB itself)
 */

import { WORKER_URL, DEEPGRAM_WORKER_URL, GEMINI_WS_EPHEMERAL } from '../config/constants.js';
import { createWorklet, ensurePlaybackWorklet, enqueueAudio } from '../audio/worklets.js';
import { buildSystemPrompt, buildPromptLanguageConfig } from './prompts.js';
import { BLUEPRINT_POLICIES } from '../config/scoring.js';
import { checkSessionAccess } from './firestore.js';

// ── STATE ─────────────────────────────────────────────────────────────────────
let ws            = null;
let dgWs          = null;
let micStream     = null;
let micCtx        = null;
let audioCtx      = null;
let playbackNode  = null;
let workletNode   = null;
export let sessionActive = false;
let micMuted      = false;

// Stored idToken — needed so initDeepgramSTT can authenticate with the worker
let _idToken      = null;

// Transcription state
let _dgBuffer        = '';
let _streamBubble    = null;
let _currentAiText   = '';
let _aiEntryEl       = null;

// Stats
let _words    = 0;
let _correct  = 0;
let _errors   = 0;
let _corrections = [];

// Timer
let _timerSecs = 0, _timerInterval = null;

// Session tracking
let _sessionId       = null;
let _userId          = null;
let _profileId       = null;          // NEW: needed for /consolidate
let _language        = 'German';      // NEW: target language for all worker calls
let _currentNodeId   = null;          // NEW: curriculum node from /token response
let _utteranceIndex  = 0;             // NEW: track utterance count for /eval
let _transcript      = [];            // accumulates { role, text } turns
const _evalQueue     = [];
let _evalFlusher     = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeWorkerFetch(path, { method = 'GET', idToken = null, json = null, retries = 1, timeoutMs = 12000, extraHeaders = {} } = {}) {
  const bodyJson = json
    ? (idToken && json.idToken === undefined ? { ...json, idToken } : json)
    : null;
  const headers = {
    // CORS-simple content type so browser can send without OPTIONS preflight.
    'Content-Type': 'text/plain;charset=UTF-8',
    ...extraHeaders,
  };
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetchWithTimeout(`${WORKER_URL}${path}`, {
        method,
        headers,
        body: bodyJson ? JSON.stringify(bodyJson) : undefined,
      }, timeoutMs);
      if (resp.ok) return resp;
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) return resp;
      lastErr = new Error(`Worker ${path} failed with status ${resp.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries) await sleep(300 * (attempt + 1));
  }
  throw lastErr || new Error(`Worker ${path} request failed`);
}

// ── BLUEPRINT BUILDER ─────────────────────────────────────────────────────────
function stripMetaTags(text) {
  return text
    .replace(/##CORRECTION##.*?##END##/gs, '')
    .replace(/##STUDENT##.*?##END##/gs, '')
    .trim();
}

/**
 * Parse ##CORRECTION## tag from Gemini's output.
 * Returns { wrong, right, note } or null if no correction.
 */
function parseCorrectionTag(text) {
  const match = text.match(/##CORRECTION##([\s\S]*?)##END##/);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw || raw === 'none') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildBlueprintFromProfile(profile) {
  const level  = profile?.level          || 'A2';
  const mode   = profile?.preferredMode  || 'guided';

  const policyKey = `${level.toLowerCase()}_${mode}`;
  const policy    = BLUEPRINT_POLICIES[policyKey] || BLUEPRINT_POLICIES['a2_guided'];

  const scenario = {
    id:    'daily_conversation',
    title: 'Daily Conversation',
    role:  'conversation partner',
    desc:  'Everyday topics — yourself, your day, your plans.',
    level,
    emoji: '💬',
  };

  return {
    programType:   'general',          // ← THIS WAS MISSING
    level,
    mode,
    scenarioId:    scenario.id,
    scenarioLevel: scenario.level,
    title:         scenario.title,
    role:          scenario.role,
    desc:          scenario.desc,
    emoji:         scenario.emoji,
    promptProfile: policy.promptProfile,
    warmup_config:       policy.warmup_config,
    interaction_policy:  policy.interaction_policy,
    intervention_policy: policy.intervention_policy,
    stage_flow:          policy.stage_flow,
    completion_policy:   policy.completion_policy,
  };
}

// ── DOM HELPERS ───────────────────────────────────────────────────────────────
function getWrap() { return document.getElementById('messagesWrap'); }
function scrollBottom() { const w = getWrap(); if (w) w.scrollTop = w.scrollHeight; }

function addMsg(role, text) {
  const wrap = getWrap(); if (!wrap) return null;
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'ai' ? 'ai' : 'me');
  div.innerHTML = `<div class="msg-label">${role === 'ai' ? 'AURA' : 'YOU'}</div><div class="bubble"></div>`;
  div.querySelector('.bubble').textContent = text;
  const typing = document.getElementById('typingIndicator');
  typing ? wrap.insertBefore(div, typing) : wrap.appendChild(div);
  scrollBottom();
  return div;
}

function getOrCreateStreamBubble() {
  if (_streamBubble) return _streamBubble;
  const wrap = getWrap(); if (!wrap) return null;
  const div = document.createElement('div');
  div.className = 'msg me streaming';
  div.innerHTML = '<div class="msg-label">YOU</div><div class="bubble"></div>';
  const typing = document.getElementById('typingIndicator');
  typing ? wrap.insertBefore(div, typing) : wrap.appendChild(div);
  _streamBubble = div;
  scrollBottom();
  return div;
}

function updateStreamBubble(text) {
  const el = getOrCreateStreamBubble(); if (!el) return;
  const b = el.querySelector('.bubble'); if (b) b.textContent = text;
  scrollBottom();
}

function finaliseStreamBubble() {
  if (!_streamBubble) return;
  _streamBubble.classList.remove('streaming');
  if (_dgBuffer.trim()) {
    _transcript.push({ role: 'student', text: _dgBuffer.trim() });
  }
  _streamBubble = null;
  _dgBuffer = '';
}

function getOrCreateAiBubble() {
  if (_aiEntryEl) return _aiEntryEl;
  const wrap = getWrap(); if (!wrap) return null;
  const div = document.createElement('div');
  div.className = 'msg ai';
  div.innerHTML = '<div class="msg-label">AURA</div><div class="bubble"></div>';
  const typing = document.getElementById('typingIndicator');
  typing ? wrap.insertBefore(div, typing) : wrap.appendChild(div);
  _aiEntryEl = div;
  scrollBottom();
  return div;
}

function addCorrectionCard(wrong, right, note) {
  const wrap = getWrap(); if (!wrap) return;
  const div = document.createElement('div');
  div.className = 'correction-card';
  div.innerHTML = `
    <div class="cc-label">✕ Correction</div>
    ${wrong ? `<div class="cc-wrong">${esc(wrong)}</div>` : ''}
    ${right ? `<div class="cc-right">✓ ${esc(right)}</div>` : ''}
    ${note  ? `<div class="cc-note">${esc(note)}</div>` : ''}
  `;
  const typing = document.getElementById('typingIndicator');
  typing ? wrap.insertBefore(div, typing) : wrap.appendChild(div);
  scrollBottom();
  _corrections.unshift({ wrong, right, note });
  _errors++;
  renderCorrectionsPanel();
  updateStats();
}

function addExplanationCard(text) {
  if (!text || text.length < 8) return;
  const wrap = getWrap(); if (!wrap) return;
  const div = document.createElement('div');
  div.className = 'explanation-card';
  div.innerHTML = `<div class="ec-label">💡 Note</div><div class="ec-text">${esc(text)}</div>`;
  const typing = document.getElementById('typingIndicator');
  typing ? wrap.insertBefore(div, typing) : wrap.appendChild(div);
  scrollBottom();
}

function renderCorrectionsPanel() {
  const c = document.getElementById('correctionsContent'); if (!c) return;
  if (!_corrections.length) return;
  c.innerHTML = _corrections.slice(0, 5).map(x => `
    <div class="correction-item">
      <div class="ci-icon">→</div>
      <div>
        ${x.wrong ? `<div class="ci-wrong">${esc(x.wrong)}</div>` : ''}
        ${x.right ? `<div class="ci-right">${esc(x.right)}</div>` : ''}
        ${x.note  ? `<div class="ci-note">${esc(x.note)}</div>`  : ''}
      </div>
    </div>`).join('');
}

function updateStats() {
  const w = document.getElementById('wordsSpoken');
  const c = document.getElementById('correctCount');
  const e = document.getElementById('errCount');
  if (w) w.textContent = _words;
  if (c) c.textContent = _correct;
  if (e) e.textContent = _errors;
}

function setOrbSpeaking(on) {
  document.getElementById('auraOrb')?.classList.toggle('speaking', on);
  const lbl = document.getElementById('wfLabel');
  if (lbl) lbl.textContent = on ? 'AURA Speaking' : 'Listening…';
}

// ── TIMER ─────────────────────────────────────────────────────────────────────
function startTimer() {
  _timerSecs = 0;
  const el = document.getElementById('sessionTimer');
  if (el) el.style.display = '';
  _timerInterval = setInterval(() => {
    _timerSecs++;
    const h = String(Math.floor(_timerSecs/3600)).padStart(2,'0');
    const m = String(Math.floor((_timerSecs%3600)/60)).padStart(2,'0');
    const s = String(_timerSecs%60).padStart(2,'0');
    if (el) el.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

function stopTimer() { clearInterval(_timerInterval); _timerInterval = null; }

// ── DEEPGRAM STT ──────────────────────────────────────────────────────────────
async function initDeepgramSTT(targetLanguage) {
  const langMap = {
    German: 'de', French: 'fr', Japanese: 'ja', Spanish: 'es',
    Italian: 'it', Mandarin: 'zh', Korean: 'ko', Portuguese: 'pt',
    Arabic: 'ar', Hindi: 'hi',
  };
  const langCode = langMap[targetLanguage] || 'en';

  try {
    // idToken is required by the Deepgram worker for Supabase auth verification
    if (!_idToken) { console.warn('[Deepgram] no idToken — skipping STT init'); return; }

    const r = await fetch(`${DEEPGRAM_WORKER_URL}/deepgram-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ idToken: _idToken })   // ← FIXED: was sending empty {}
    });
    if (!r.ok) { console.warn('[Deepgram] token fetch failed', r.status, await r.text()); return; }
    const { token } = await r.json();
    if (!token) { console.warn('[Deepgram] no token returned'); return; }

    const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&language=${langCode}&smart_format=true&punctuate=true&encoding=linear16&sample_rate=16000&endpointing=400&utterance_end_ms=1000&interim_results=true&access_token=${encodeURIComponent(token)}`;
    dgWs = new WebSocket(dgUrl);
    dgWs.binaryType = 'arraybuffer';

    dgWs.onopen  = () => console.log('[Deepgram] connected, lang:', langCode);
    dgWs.onerror = (e) => console.warn('[Deepgram] error', e);
    dgWs.onclose = () => { dgWs = null; };

    dgWs.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'Results') {
          const transcript  = msg.channel?.alternatives?.[0]?.transcript || '';
          const confidence  = msg.channel?.alternatives?.[0]?.confidence || 0;
          const isFinal     = msg.is_final;
          const speechFinal = msg.speech_final;

          if (!transcript || !sessionActive || micMuted) return;

          if (isFinal) {
            _dgBuffer = _dgBuffer ? _dgBuffer + ' ' + transcript : transcript;
            updateStreamBubble(_dgBuffer.trim());
          } else {
            updateStreamBubble((_dgBuffer ? _dgBuffer + ' ' : '') + transcript);
          }

          if (speechFinal && _dgBuffer.trim()) {
            const words = _dgBuffer.trim().split(/\s+/).filter(Boolean);
            _words += words.length;
            _correct++;
            updateStats();

            // ── CHANGE 2: Fire /eval per utterance ───────────────────────────
            // We fire this async — does not block conversation flow.
            // evalResult comes from the last ##CORRECTION## tag Gemini output.
            const utteranceText = _dgBuffer.trim();
            fireUtteranceEval(utteranceText, confidence).catch(console.error);
            // ─────────────────────────────────────────────────────────────────

            finaliseStreamBubble();
          }
        }
        if (msg.type === 'UtteranceEnd' && _dgBuffer.trim()) {
          const words = _dgBuffer.trim().split(/\s+/).filter(Boolean);
          _words += words.length;
          _correct++;
          updateStats();
          finaliseStreamBubble();
        }
      } catch(e) {}
    };
  } catch(e) {
    console.warn('[Deepgram] init failed', e);
  }
}

function sendToDeeepgram(pcmBuffer) {
  if (dgWs?.readyState === WebSocket.OPEN && !micMuted) {
    dgWs.send(pcmBuffer);
  }
}

// ── CHANGE 2: Per-utterance eval call ─────────────────────────────────────────
// Called after each student utterance is finalised by Deepgram.
// Sends structured payload to the new brain worker's /eval endpoint.
// The evalResult (corrections) come from the last ##CORRECTION## tag
// that Gemini output — stored in _lastCorrectionResult.
let _lastCorrectionResult = null; // set by handleServerMessage when ##CORRECTION## parsed

async function fireUtteranceEval(utteranceText, confidence) {
  if (!_sessionId || !_userId || !utteranceText) return;

  const evalResult = _lastCorrectionResult
    ? {
        corrections: [{
          wrong:    _lastCorrectionResult.wrong || '',
          right:    _lastCorrectionResult.right || '',
          rule:     _lastCorrectionResult.note  || '',
          category: 'grammar',
        }],
        accuracy:  _lastCorrectionResult.wrong ? 0.6 : 1.0,
        xpDelta:   _lastCorrectionResult.wrong ? 5   : 15,
      }
    : { corrections: [], accuracy: 1.0, xpDelta: 15 };

  _evalQueue.push({
    sessionId: _sessionId,
    transcript: utteranceText,
    confidence: confidence || null,
    utteranceIndex: _utteranceIndex++,
    nodeId: _currentNodeId || null,
    language: _language,
    evalResult,
  });

  if (!_evalFlusher) {
    _evalFlusher = setInterval(async () => {
      if (!_evalQueue.length || !_idToken) return;
      const item = _evalQueue.shift();
      try {
        await safeWorkerFetch('/eval', {
          method: 'POST',
          idToken: _idToken,
          json: item,
          retries: 2,
          timeoutMs: 10000,
        });
      } catch (e) {
        console.warn('[AURA] /eval failed after retries:', e?.message);
      }
    }, 350);
  }

  // Reset after firing so we don't double-apply the same correction
  _lastCorrectionResult = null;
}
// ─────────────────────────────────────────────────────────────────────────────

// ── SERVER MESSAGE HANDLER ────────────────────────────────────────────────────
function handleServerMessage(msg) {
  if (msg.setupComplete !== undefined) {
    console.log('[AURA] Gemini setup complete');
  }

  if (msg.serverContent) {
    const sc = msg.serverContent;

    if (sc.modelTurn?.parts) {
      sc.modelTurn.parts.forEach(part => {
        if (part.inlineData?.mimeType?.startsWith('audio/') && part.inlineData.data) {
          getOrCreateAiBubble();
          setOrbSpeaking(true);
          enqueueAudio(playbackNode, part.inlineData.data);
        }
      });
    }

    if (sc.outputTranscription?.text) {
      _currentAiText += sc.outputTranscription.text;
      const el = getOrCreateAiBubble();
      const b  = el?.querySelector('.bubble');
      if (b) b.textContent = stripMetaTags(_currentAiText);
      scrollBottom();
    }

    // ── Gemini input transcription (what the user said) ─────────────────────
    // PRIMARY path:   Deepgram WebSocket is live — it shows the streaming bubble
    //                 in real-time. Gemini's copy is ignored to avoid duplicates.
    // FALLBACK path:  Deepgram is not connected — use Gemini's transcription
    //                 so the user always sees their speech on screen.
    if (sc.inputTranscription) {
      const text    = (sc.inputTranscription.text || '').trim();
      const isFinal = !!sc.inputTranscription.isFinal;
      if (text) {
        const dgLive = dgWs && dgWs.readyState === WebSocket.OPEN;
        if (!dgLive) {
          // Deepgram offline — drive the streaming bubble from Gemini events
          updateStreamBubble(text);
          if (isFinal) {
            const words = text.split(/\s+/).filter(Boolean);
            _words += words.length;
            _correct++;
            updateStats();
            finaliseStreamBubble();
          }
        } else if (isFinal && !_streamBubble && _dgBuffer === '') {
          // Deepgram online but somehow missed this final utterance — show it
          addMsg('me', text);
          const words = text.split(/\s+/).filter(Boolean);
          _words += words.length;
          _correct++;
          updateStats();
        }
      }
    }

    if (sc.turnComplete) {
      if (_currentAiText.trim()) {
        // Parse the ##CORRECTION## tag from Gemini's full output
        // and store it so fireUtteranceEval() can pick it up
        const correction = parseCorrectionTag(_currentAiText);
        if (correction) {
          _lastCorrectionResult = correction;
          // Show correction card in UI immediately
          if (correction.wrong || correction.right) {
            addCorrectionCard(correction.wrong, correction.right, correction.note);
          }
        }

        _transcript.push({ role: 'aura', text: _currentAiText.trim() });
      }
      _currentAiText = '';
      _aiEntryEl     = null;
      setOrbSpeaking(false);
    }

    if (sc.interrupted) setOrbSpeaking(false);
  }

  if (msg.error) {
    addMsg('ai', `⚠️ Error: ${msg.error.message || JSON.stringify(msg.error)}`);
  }
}

// ── CLEANUP ───────────────────────────────────────────────────────────────────
function cleanup() {
  if (window._keepAlive) { clearInterval(window._keepAlive); window._keepAlive = null; }
  if (dgWs) { try { dgWs.close(); } catch(e){} dgWs = null; }
  if (workletNode)  { try { workletNode.disconnect();  } catch(e){} workletNode  = null; }
  if (playbackNode) { try { playbackNode.disconnect(); } catch(e){} playbackNode = null; }
  if (micStream)    { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx)     { try { audioCtx.close(); } catch(e){} audioCtx = null; }
  if (micCtx)       { try { micCtx.close();   } catch(e){} micCtx   = null; }
  if (ws)           { try { ws.close();        } catch(e){} ws       = null; }
  micMuted = false;
  _streamBubble = null;
  _currentAiText = '';
  _aiEntryEl = null;
  _dgBuffer = '';
  _lastCorrectionResult = null;
  _utteranceIndex = 0;
  _idToken = null;
  if (_evalFlusher) {
    clearInterval(_evalFlusher);
    _evalFlusher = null;
  }
  _evalQueue.length = 0;
}

// ── END SESSION ───────────────────────────────────────────────────────────────
export async function endSession() {
  if (!sessionActive) return;
  sessionActive = false;
  window.sessionActive = false;
  const idTokenForFinalize = _idToken;
  stopTimer();
  setOrbSpeaking(false);
  window.dispatchEvent(new CustomEvent('aura:session-ended'));

  // ── CHANGE 3: Fire /consolidate with new payload ──────────────────────────
  if (_sessionId && _userId) {
    fireConsolidate(_sessionId, _userId, _language, _profileId, idTokenForFinalize).catch(console.error);
  }
  // ─────────────────────────────────────────────────────────────────────────

  cleanup();

  showSummary();
}

// ── CHANGE 3: New consolidate function ────────────────────────────────────────
// The new brain worker reads session_utterances from DB itself.
// We only need to tell it which session to consolidate + language + profileId.
async function fireConsolidate(sessionId, userId, language, profileId, idToken = null) {
  try {
    const res = await safeWorkerFetch('/consolidate', {
      method: 'POST',
      idToken,
      retries: 2,
      timeoutMs: 12000,
      extraHeaders: { 'X-Idempotency-Key': `${sessionId}:consolidate:v1` },
      json: {
        sessionId,
        language: language || 'German',
        profileId: profileId || null,
      },
    });
    if (!res.ok) {
      console.warn('[AURA] /consolidate failed:', res.status, await res.text());
    } else {
      const data = await res.json();
      console.log('[AURA] memory consolidated:', {
        summary:    data.summary,
        nextFocus:  data.nextFocus,
        totalXp:    data.totalXp,
        newStreak:  data.newStreak,
        levelUp:    data.levelUp,
      });
    }
  } catch(e) {
    console.warn('[AURA] /consolidate error (non-fatal):', e?.message);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function showSummary() {
  const mins = Math.floor(_timerSecs / 60);
  const acc  = (_correct + _errors) > 0
    ? Math.round((_correct / (_correct + _errors)) * 100)
    : 0;

  const overlay   = document.getElementById('summary-overlay');
  const metaEl    = document.getElementById('summaryMeta');
  const scoreEl   = document.getElementById('summaryScore');
  const verdictEl = document.getElementById('summaryVerdict');
  const bodyEl    = document.getElementById('summaryBody');

  if (metaEl)    metaEl.textContent    = `${mins} min · ${_words} words spoken`;
  if (scoreEl)   scoreEl.textContent   = acc + '%';
  if (verdictEl) verdictEl.textContent = acc >= 80 ? 'Excellent session!' : acc >= 60 ? 'Good work. Keep it up.' : 'Keep practising — progress takes time.';

  if (bodyEl) {
    bodyEl.innerHTML = _corrections.length
      ? `<div style="font-size:10px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">Corrections this session</div>` +
        _corrections.map(c => `
          <div style="padding:8px 0;border-bottom:0.5px solid var(--border);">
            ${c.wrong ? `<div style="font-size:12px;color:var(--red);font-family:monospace;text-decoration:line-through;">${esc(c.wrong)}</div>` : ''}
            ${c.right ? `<div style="font-size:12.5px;color:var(--green);font-family:monospace;font-weight:600;">✓ ${esc(c.right)}</div>` : ''}
            ${c.note  ? `<div style="font-size:11px;color:var(--muted);margin-top:3px;">${esc(c.note)}</div>` : ''}
          </div>`).join('')
      : `<div style="font-size:13px;color:var(--muted2);">${_words > 0 ? 'No corrections this session. Great accuracy!' : 'Session ended.'}</div>`;
  }

  if (overlay) overlay.classList.add('open');
}

// ── SESSION START ─────────────────────────────────────────────────────────────
async function startSession({ idToken, userDisplayName = 'there', profile = null } = {}) {
  if (sessionActive) return;
  if (!idToken) { addMsg('ai', '⚠️ Please sign in to start a session.'); return; }
  try {
    const sessionAccess = await checkSessionAccess(profile?.userId || window.currentUser?.uid);
    if (!sessionAccess?.allowed) {
      addMsg('ai', '⚠️ You have reached your free-session limit. Please upgrade to continue.');
      return;
    }
  } catch (_accessErr) {
    addMsg('ai', '⚠️ Could not verify account access. Please try again.');
    return;
  }

  // Reset all state
  _words = 0; _correct = 0; _errors = 0; _corrections = [];
  _dgBuffer = ''; _streamBubble = null; _currentAiText = ''; _aiEntryEl = null;
  _sessionId = null; _userId = null; _profileId = null;
  _idToken = idToken || null;                    // store so Deepgram token fetch can auth
  _language = profile?.targetLanguage || 'German';
  _currentNodeId = null;
  _utteranceIndex = 0;
  _lastCorrectionResult = null;
  _transcript = [];
  updateStats();

  // Clear chat area
  const wrap = document.getElementById('messagesWrap');
  if (wrap) wrap.innerHTML = '<div class="typing-indicator" id="typingIndicator" style="display:none;"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';

  const btn = document.getElementById('liveSessionBtn');
  if (btn) btn.disabled = true;

  // NOTE: System instruction is intentionally NOT built here for the voice path.
  // The backend /token endpoint builds a Supabase-informed system instruction
  // (via instructionAgent: CEFR mixing rules, error history, session memory,
  // curriculum context) and embeds it in the Gemini ephemeral token via
  // bidiGenerateContentSetup.systemInstruction. Sending a second systemInstruction
  // in the WebSocket setup message would override it with a stale, memory-free prompt.
  // → buildSystemPrompt() is only used below for the text-fallback (Claude API) path.

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (micCtx.state === 'suspended') await micCtx.resume();

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    playbackNode = await ensurePlaybackWorklet(audioCtx);

    // ── CHANGE 1: Send `language` to /token ──────────────────────────────────
    const resp = await safeWorkerFetch('/token', {
      method: 'POST',
      idToken,
      retries: 1,
      timeoutMs: 10000,
      json: {
        idToken,
        language: _language,
      },
    });
    // ─────────────────────────────────────────────────────────────────────────

    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      throw new Error(e.error || `Worker error ${resp.status}`);
    }
    const tokenData = await resp.json();
    const { token } = tokenData;
    if (!token) throw new Error('No token from Worker.');

    // Store session metadata returned by new brain worker
    _sessionId     = tokenData.sessionId   || null;
    _userId        = tokenData.userId      || null;
    _currentNodeId = tokenData.currentNode?.id || null;  // NEW: curriculum node
    _profileId     = profile?.id           || null;       // NEW: from active profile

    console.log('[AURA] session started', {
      sessionId:       _sessionId,
      currentNode:     tokenData.currentNode?.title,
      curriculumReason: tokenData.curriculumReason,
    });

    ws = new WebSocket(`${GEMINI_WS_EPHEMERAL}?access_token=${token}`);
    ws.binaryType = 'arraybuffer';

    const wsTimeout = setTimeout(() => {
      if (!sessionActive) { addMsg('ai', '⚠️ Connection timed out.'); cleanup(); if (btn) btn.disabled = false; }
    }, 10000);

    ws.onopen = async () => {
      clearTimeout(wsTimeout);
      // systemInstruction is intentionally omitted here — it was already embedded
      // in the ephemeral token by the backend (instructionAgent via /token).
      // Sending it again would override the Supabase-informed instruction with
      // a stale, memory-free prompt and break CEFR mixing, error tracking, and
      // session memory context reaching Gemini.
      ws.send(JSON.stringify({
        setup: {
          model: 'models/gemini-3.1-flash-live-preview',
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } }
          },
          inputAudioTranscription:  {},
          outputAudioTranscription: {},
        }
      }));

      workletNode = await createWorklet(micCtx, micStream, {
        onAudioChunk: (pcmBuffer) => {
          if (!sessionActive || micMuted) return;
          if (ws?.readyState === WebSocket.OPEN) {
            const b64 = btoa(String.fromCharCode(...new Uint8Array(pcmBuffer)));
            // NEW
ws.send(JSON.stringify({
  realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } }
}));
          }
          sendToDeeepgram(pcmBuffer);
        }
      });

      sessionActive = true;
      window.sessionActive = true;
      startTimer();
      setOrbSpeaking(true);
      if (btn) btn.disabled = false;

      initDeepgramSTT(_language);

      window.dispatchEvent(new CustomEvent('aura:session-started'));

      window._keepAlive = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN && sessionActive) {
          try { ws.send(JSON.stringify({ realtimeInput: { mediaChunks: [] } })); } catch(e) {}
        } else clearInterval(window._keepAlive);
      }, 8000);
    };

    ws.onmessage = (event) => {
      try {
        const txt = event.data instanceof ArrayBuffer
          ? new TextDecoder().decode(event.data) : event.data;
        handleServerMessage(JSON.parse(txt));
      } catch(e) {}
    };

    ws.onerror = () => { addMsg('ai', '⚠️ WebSocket error.'); cleanup(); if (btn) btn.disabled = false; };

    ws.onclose = (e) => {
      clearTimeout(wsTimeout);
      if (sessionActive) {
        if (e.code !== 1000) addMsg('ai', 'Connection lost. Please restart.');
        sessionActive = false;
        window.sessionActive = false;
        cleanup(); stopTimer();
        window.dispatchEvent(new CustomEvent('aura:session-ended'));
      }
    };

  } catch(err) {
    addMsg('ai', `⚠️ ${err.message}`);
    if (btn) btn.disabled = false;
    cleanup();
  }
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────
export function toggleMic() {
  micMuted = !micMuted;
  const icon = document.getElementById('micBtn')?.querySelector('.vc-icon');
  if (icon) icon.textContent = micMuted ? '🔇' : '🎙️';
  document.getElementById('micBtn')?.classList.toggle('mic-active', !micMuted);
  return micMuted;
}

export function sendText(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    clientContent: { turns: [{ role:'user', parts:[{ text }] }], turnComplete: true }
  }));
}

export function getSessionState() { return sessionActive ? 'active' : 'idle'; }

let _tokenFn   = () => Promise.resolve(null);
let _nameFn    = () => 'there';
let _profileFn = () => null;

export function initSession(callbacks) {
  if (callbacks.getIdToken)         _tokenFn   = callbacks.getIdToken;
  if (callbacks.getUserDisplayName) _nameFn    = callbacks.getUserDisplayName;
  if (callbacks.getActiveProfile)   _profileFn = callbacks.getActiveProfile;

  ['liveSessionBtn', 'idleStartBtn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', async () => {
      if (sessionActive) return;
      const idToken = await _tokenFn().catch(() => null);
      await startSession({
        idToken,
        userDisplayName: _nameFn(),
        profile: _profileFn() || null
      });
    });
  });

  document.getElementById('endSessionBtn')?.addEventListener('click', async () => {
    if (!sessionActive) return;
    if (!confirm('End this session?')) return;
    await endSession();
  });

  document.getElementById('summaryBtn')?.addEventListener('click', () => showSummary());

  document.getElementById('micBtn')?.addEventListener('click', () => {
    if (!sessionActive) return;
    toggleMic();
  });

  let sending = false;
  async function handleSend() {
    if (sending) return;
    const input = document.getElementById('chatInput');
    const text  = input?.value.trim();
    if (!text) return;

    if (sessionActive) {
      addMsg('me', text); input.value = '';
      sendText(text);
      _words += text.split(/\s+/).filter(Boolean).length;
      _correct++; updateStats();
      return;
    }

    // Text fallback when no live session
    sending = true;
    const sendBtnEl = document.getElementById('sendBtn');
    if (sendBtnEl) sendBtnEl.disabled = true;
    addMsg('me', text); input.value = '';
    const typing = document.getElementById('typingIndicator');
    if (typing) { typing.style.display = 'flex'; scrollBottom(); }

    try {
      const profile   = _profileFn() || null;
      const langPref  = profile?.langPref || profile?.nativeLanguage || 'English';
      let   textSystemPrompt;

      try {
        const blueprint    = buildBlueprintFromProfile(profile);
        textSystemPrompt   = buildSystemPrompt(blueprint, langPref);
      } catch (e) {
        const nativeLang   = profile?.nativeLanguage || 'English';
        const targetLang   = profile?.targetLanguage || 'German';
        const level        = profile?.level || 'A2';
        textSystemPrompt   = `You are AURA, a warm AI language tutor. The student is learning ${targetLang} at ${level} level. Their native language is ${nativeLang}. Reply in max 3 sentences. Correct grammar errors gently. No bullet points.`;
      }

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          system: textSystemPrompt,
          messages: [{ role: 'user', content: text }]
        })
      });
      const data = await res.json();
      if (typing) typing.style.display = 'none';
      addMsg('ai', data.content?.[0]?.text || 'Sehr gut! Keep going.');
    } catch {
      if (typing) typing.style.display = 'none';
      addMsg('ai', 'Sehr gut! Keep practising.');
    }

    sending = false;
    if (sendBtnEl) sendBtnEl.disabled = false;
  }

  document.getElementById('sendBtn')?.addEventListener('click', handleSend);
  document.getElementById('chatInput')?.addEventListener('keydown', e => { if (e.key==='Enter') handleSend(); });
}
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
