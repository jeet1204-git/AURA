/**
 * session-bridge.js — AURA Live Session Engine
 * Uses real buildSystemPrompt() from prompts.js for both voice and text fallback.
 */

import { WORKER_URL, DEEPGRAM_WORKER_URL, GEMINI_WS_EPHEMERAL } from '../config/constants.js';
import { createWorklet, ensurePlaybackWorklet, enqueueAudio } from '../audio/worklets.js';
import { buildSystemPrompt, buildPromptLanguageConfig } from './prompts.js';
import { BLUEPRINT_POLICIES } from '../config/scoring.js';

// ── STATE ─────────────────────────────────────────────────────────────────────
let ws            = null;
let dgWs          = null;   // Deepgram WebSocket for live STT
let micStream     = null;
let micCtx        = null;
let audioCtx      = null;
let playbackNode  = null;
let workletNode   = null;
export let sessionActive = false;
let micMuted      = false;

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

// Session tracking — for eval and consolidate
let _sessionId   = null;
let _userId      = null;
let _transcript  = []; // accumulates { role, text } turns

// ── BLUEPRINT BUILDER ─────────────────────────────────────────────────────────
// Builds a minimal but real blueprint from the user's Firestore profile.
// Falls back to A2 guided daily conversation if profile fields are missing.
function buildBlueprintFromProfile(profile) {
  const level  = profile?.level          || 'A2';
  const mode   = profile?.preferredMode  || 'guided';

  const policyKey = `${level.toLowerCase()}_${mode}`;
  const policy    = BLUEPRINT_POLICIES[policyKey] || BLUEPRINT_POLICIES['a2_guided'];

  // Default A2 daily-conversation scenario
  const scenario = {
    id:    'daily_conversation',
    title: 'Daily Conversation',
    role:  'conversation partner',
    desc:  'Everyday topics — yourself, your day, your plans.',
    level,
    emoji: '💬',
  };

  return {
    level,
    mode,
    scenarioId:   scenario.id,
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
    const r = await fetch(`${DEEPGRAM_WORKER_URL}/deepgram-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!r.ok) { console.warn('[Deepgram] token fetch failed', r.status); return; }
    const { token } = await r.json();
    if (!token) { console.warn('[Deepgram] no token returned'); return; }

    const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&language=${langCode}&smart_format=false&punctuate=false&encoding=linear16&sample_rate=16000&endpointing=400&utterance_end_ms=1000&interim_results=true&access_token=${encodeURIComponent(token)}`;
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

// ── CORRECTION DETECTION ─────────────────────────────────────────────────────
function detectCorrection(text) {
  if (!text || text.length < 10) return false;
  let wrong = '', right = '', note = '';

  const arrow = text.match(/["""»]?([^"""»\n]{3,50})["""«]?\s*[→\->]+\s*["""»]?([^"""«.!?\n]{3,60})/);
  if (arrow) { wrong = arrow[1].trim(); right = arrow[2].trim(); }

  if (!right) {
    const sondern = text.match(/nicht\s+["""»]?([^,»"""]{1,30})["""«]?,?\s+sondern\s+["""»]?([^.<!?\n]{3,50})/i);
    if (sondern) { wrong = sondern[1].trim(); right = sondern[2].trim(); }
  }

  if (!right) {
    const tryPat = text.match(/(?:try|say|use|sag(?:en Sie)?)\s*:\s*["""»]?([^.!?\n"»]{4,60})/i);
    if (tryPat) right = tryPat[1].trim();
  }

  const isCorrecting = /(?:kleiner fehler|fast richtig|kleine korrektur|small mistake|small fix|almost|not quite|fast perfekt)/i.test(text);

  if ((wrong && right) || (isCorrecting && right)) {
    const noteMatch = text.match(/(?:because|da |weil |denn |remember|note that)[^.!?\n]{5,100}/i);
    if (noteMatch) note = noteMatch[0].trim();
    addCorrectionCard(wrong, right, note);
    if (_correct > 0) _correct--;
    updateStats();
    return true;
  }
  return false;
}

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
      if (b) b.textContent = _currentAiText;
      scrollBottom();
    }

    if (sc.inputTranscription?.isFinal) {
      const text = (sc.inputTranscription.text || '').trim();
      if (text && !_streamBubble && _dgBuffer === '') {
        addMsg('me', text);
        const words = text.split(/\s+/).filter(Boolean);
        _words += words.length;
        _correct++;
        updateStats();
      }
    }

    if (sc.turnComplete) {
      if (_currentAiText.trim()) {
        detectCorrection(_currentAiText);
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
  micMuted = false; _streamBubble = null; _currentAiText = ''; _aiEntryEl = null; _dgBuffer = '';
}

// ── END SESSION ───────────────────────────────────────────────────────────────
export async function endSession() {
  if (!sessionActive) return;
  sessionActive = false;
  window.sessionActive = false;
  cleanup();
  stopTimer();
  setOrbSpeaking(false);
  window.dispatchEvent(new CustomEvent('aura:session-ended'));

  // Fire eval + consolidate to save session and update memory
  if (_sessionId && _userId && _transcript.length > 0) {
    const transcriptText = _transcript
      .map(t => `${t.role === 'student' ? 'STUDENT' : 'AURA'}: ${t.text}`)
      .join('\n');
    evalAndConsolidate(_sessionId, _userId, transcriptText).catch(console.error);
  }

  showSummary();
}

async function evalAndConsolidate(sessionId, userId, transcriptText) {
  try {
    // Step 1: eval
    const evalRes = await fetch(`${WORKER_URL}/eval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sessionId, transcript: transcriptText }),
    });
    if (!evalRes.ok) {
      console.warn('[AURA] /eval failed:', evalRes.status);
    } else {
      const evalData = await evalRes.json();
      console.log('[AURA] session eval complete', evalData?.scores);
    }

    // Step 2: consolidate (updates memory)
    const consRes = await fetch(`${WORKER_URL}/consolidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sessionId, transcript: transcriptText }),
    });
    if (!consRes.ok) {
      console.warn('[AURA] /consolidate failed:', consRes.status);
    } else {
      console.log('[AURA] memory consolidated successfully');
    }
  } catch (e) {
    console.warn('[AURA] evalAndConsolidate error:', e?.message);
  }
}

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

  // Reset
  _words = 0; _correct = 0; _errors = 0; _corrections = [];
  _dgBuffer = ''; _streamBubble = null; _currentAiText = ''; _aiEntryEl = null;
  _sessionId = null; _userId = null; _transcript = [];
  updateStats();

  // Clear chat area
  const wrap = document.getElementById('messagesWrap');
  if (wrap) wrap.innerHTML = '<div class="typing-indicator" id="typingIndicator" style="display:none;"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';

  const btn = document.getElementById('liveSessionBtn');
  if (btn) btn.disabled = true;

  // ── BUILD REAL SYSTEM PROMPT ──────────────────────────────────────────────
  const langPref = profile?.langPref || profile?.nativeLanguage || 'English';
  const lang     = profile?.targetLanguage || 'German';

  let systemPrompt;
  try {
    const blueprint = buildBlueprintFromProfile(profile);
    systemPrompt = buildSystemPrompt(blueprint, langPref);
    console.log('[AURA] system prompt built via prompts.js', {
      level: blueprint.level,
      mode:  blueprint.mode,
      langPref,
    });
  } catch (promptErr) {
    console.error('[AURA] buildSystemPrompt failed, using minimal fallback', promptErr);
    // Minimal safe fallback — should only trigger if prompts.js has a bug
    const nativeLang = profile?.nativeLanguage || 'English';
    const level      = profile?.level || 'A2';
    systemPrompt = `You are AURA, a warm AI language tutor. The student is learning ${lang} at ${level} level. Their native language is ${nativeLang}. Use ${nativeLang} only for corrections (one sentence max). Keep each turn to 2-3 sentences. Greet the student warmly in ${lang} to begin.`;
  }
  // ── END SYSTEM PROMPT BUILD ───────────────────────────────────────────────

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (micCtx.state === 'suspended') await micCtx.resume();

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    playbackNode = await ensurePlaybackWorklet(audioCtx);

    const resp = await fetch(`${WORKER_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      throw new Error(e.error || `Worker error ${resp.status}`);
    }
    const tokenData = await resp.json();
    const { token } = tokenData;
    if (!token) throw new Error('No token from Worker.');

    // Store sessionId and userId for eval/consolidate on session end
    _sessionId = tokenData.sessionId || null;
    _userId    = tokenData.userId    || null;

    ws = new WebSocket(`${GEMINI_WS_EPHEMERAL}?access_token=${token}`);
    ws.binaryType = 'arraybuffer';

    const wsTimeout = setTimeout(() => {
      if (!sessionActive) { addMsg('ai', '⚠️ Connection timed out.'); cleanup(); if (btn) btn.disabled = false; }
    }, 10000);

    ws.onopen = async () => {
      clearTimeout(wsTimeout);
      ws.send(JSON.stringify({
        setup: {
          model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } }
          },
          inputAudioTranscription:  {},
          outputAudioTranscription: {},
          systemInstruction: { parts: [{ text: systemPrompt }] }
        }
      }));

      workletNode = await createWorklet(micCtx, micStream, {
        onAudioChunk: (pcmBuffer) => {
          if (!sessionActive || micMuted) return;
          if (ws?.readyState === WebSocket.OPEN) {
            const b64 = btoa(String.fromCharCode(...new Uint8Array(pcmBuffer)));
            ws.send(JSON.stringify({
              realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: b64 }] }
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

      initDeepgramSTT(lang);

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

// Module-level callback refs — set once by initSession, used everywhere.
// Stored this way to survive Vite's minifier renaming destructured params.
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

    // ── ANTHROPIC TEXT FALLBACK ───────────────────────────────────────────
    // Uses real buildSystemPrompt so the text fallback is identical to voice.
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
    // ── END ANTHROPIC TEXT FALLBACK ───────────────────────────────────────
  }

  document.getElementById('sendBtn')?.addEventListener('click', handleSend);
  document.getElementById('chatInput')?.addEventListener('keydown', e => { if (e.key==='Enter') handleSend(); });
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
