/**
 * session-bridge.js
 * Gemini Live session bridge for app-screens.html.
 * Handles voice connection, transcription display, visual corrections.
 */

import { WORKER_URL, GEMINI_WS_EPHEMERAL } from '../config/constants.js';
import { createWorklet, ensurePlaybackWorklet, enqueueAudio } from '../audio/worklets.js';

// ── STATE ─────────────────────────────────────────────────────────────────────
let ws            = null;
let micStream     = null;
let micCtx        = null;
let audioCtx      = null;
let playbackNode  = null;
let workletNode   = null;
let sessionActive = false;
let micMuted      = false;

// Live session stats
let _wordCount    = 0;
let _correctCount = 0;
let _errCount     = 0;
// Track corrections made this session for the right panel
const _sessionCorrections = [];

// ── DOM HELPERS ───────────────────────────────────────────────────────────────
function addMsg(role, text, extra = '') {
  const wrap = document.getElementById('messagesWrap');
  if (!wrap) return null;
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'ai' ? 'ai' : 'me');
  div.innerHTML = `<div class="msg-label">${role === 'ai' ? 'AURA' : 'YOU'}</div><div class="bubble">${escHtml(text)}</div>${extra}`;
  const typing = document.getElementById('typingIndicator');
  typing ? wrap.insertBefore(div, typing) : wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

// Streaming AURA message — updates in place as chunks arrive
let _streamingEl   = null;
let _streamingText = '';

function streamAuraChunk(chunk) {
  const wrap = document.getElementById('messagesWrap');
  if (!wrap) return;
  _streamingText += chunk;
  if (!_streamingEl) {
    _streamingEl = document.createElement('div');
    _streamingEl.className = 'msg ai streaming';
    _streamingEl.innerHTML = `<div class="msg-label">AURA</div><div class="bubble" id="streamBubble"></div>`;
    const typing = document.getElementById('typingIndicator');
    typing ? wrap.insertBefore(_streamingEl, typing) : wrap.appendChild(_streamingEl);
  }
  const bubble = _streamingEl.querySelector('.bubble');
  if (bubble) bubble.textContent = _streamingText;
  wrap.scrollTop = wrap.scrollHeight;
}

function finaliseAuraMessage() {
  if (!_streamingEl) return _streamingText;
  const text = _streamingText;
  _streamingEl.classList.remove('streaming');
  _streamingEl = null;
  _streamingText = '';
  return text;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setOrbSpeaking(on) {
  document.getElementById('auraOrb')?.classList.toggle('speaking', on);
  const lbl = document.getElementById('wfLabel');
  if (lbl) lbl.textContent = on ? 'AURA Speaking' : 'Listening…';
}

function updateStats() {
  const ws = document.getElementById('wordsSpoken');
  const cc = document.getElementById('correctCount');
  const ec = document.getElementById('errCount');
  if (ws) ws.textContent = _wordCount;
  if (cc) cc.textContent = _correctCount;
  if (ec) ec.textContent = _errCount;
}

// ── CORRECTION DETECTION ──────────────────────────────────────────────────────
// Parses AURA's text for correction patterns and renders a visual block.
// Does NOT speak the correction — it only appears on screen.
function detectAndRenderCorrection(auraText, parentEl) {
  const text = auraText || '';
  let wrong = '', right = '', note = '', nativeNote = '';

  // Pattern 1: "X → Y" or "X -> Y"
  const arrowMatch = text.match(/["""»]?([^"""»\n]{2,40})["""«]?\s*[→\-]{1,2}>\s*["""»]?([^"""«\n.!?]{2,50})["""«]?/);
  if (arrowMatch) { wrong = arrowMatch[1].trim(); right = arrowMatch[2].trim(); }

  // Pattern 2: "nicht X, sondern Y"
  if (!right) {
    const nichtMatch = text.match(/nicht\s+["""»]?([^,»"""]{1,30})["""«]?,?\s+sondern\s+["""»]?([^.!?\n]{2,50})/i);
    if (nichtMatch) { wrong = nichtMatch[1].trim(); right = nichtMatch[2].trim(); }
  }

  // Pattern 3: "say/try: X" 
  if (!right) {
    const tryMatch = text.match(/(?:say|try|sag|probier)\s*:\s*["""»]?([^"""«\n.!?]{3,60})/i);
    if (tryMatch) right = tryMatch[1].trim();
  }

  // Pattern 4: "Fast richtig" or "Kleiner Fehler" signal correction nearby
  if (!right && /(?:fast richtig|kleiner fehler|small mistake|almost)/i.test(text)) {
    // Extract quoted correct form
    const qMatch = text.match(/["""»]([^"""«]{3,50})["""«]/);
    if (qMatch) right = qMatch[1].trim();
  }

  if (!right) return false; // No correction detected

  // Clean up wrong/right
  wrong = wrong.replace(/^["'"""»]+|["'"""«]+$/g, '').trim();
  right = right.replace(/^["'"""»]+|["'"""«]+$/g, '').trim();
  if (right === wrong) return false;

  // Extract explanatory note (sentence after correction)
  const noteMatch = text.match(/[.!]\s+([A-Z][^.!?\n]{10,80}[.!])\s*$/);
  if (noteMatch && !noteMatch[1].includes(right) && !noteMatch[1].includes(wrong)) {
    note = noteMatch[1].trim();
  }

  // Build visual correction block
  const block = document.createElement('div');
  block.className = 'corr-block';
  block.innerHTML = `
    <div class="corr-label">✕ Correction</div>
    ${wrong ? `<div class="corr-wrong">${escHtml(wrong)}</div><div class="corr-arrow">↓</div>` : ''}
    <div class="corr-right">✓ ${escHtml(right)}</div>
    ${note ? `<div class="corr-note">${escHtml(note)}</div>` : ''}
    ${nativeNote ? `<div class="corr-note-native">${escHtml(nativeNote)}</div>` : ''}
  `;

  // Append after AURA's message bubble
  if (parentEl) {
    parentEl.appendChild(block);
    const wrap = document.getElementById('messagesWrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }

  // Track in session
  _errCount++;
  _sessionCorrections.push({ wrong, right, note });
  updateStats();
  updateCorrectionsPanel();
  return true;
}

function updateCorrectionsPanel() {
  const card = document.getElementById('correctionsCard');
  const list = document.getElementById('correctionsList');
  if (!card || !list) return;
  if (!_sessionCorrections.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  list.innerHTML = _sessionCorrections.slice(-5).reverse().map(c => `
    <div class="correction-item">
      <div class="ci-icon">→</div>
      <div>
        ${c.wrong ? `<div class="ci-wrong">${escHtml(c.wrong)}</div>` : ''}
        <div class="ci-right">${escHtml(c.right)}</div>
        ${c.note ? `<div class="ci-note">${escHtml(c.note)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ── TIMER ─────────────────────────────────────────────────────────────────────
let _timerSec = 0, _timerInterval = null;

function startTimer() {
  _timerSec = 0;
  _timerInterval = setInterval(() => {
    _timerSec++;
    const h = String(Math.floor(_timerSec / 3600)).padStart(2,'0');
    const m = String(Math.floor((_timerSec % 3600) / 60)).padStart(2,'0');
    const s = String(_timerSec % 60).padStart(2,'0');
    const el = document.getElementById('sessionTimer');
    if (el) el.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

function stopTimer() { clearInterval(_timerInterval); _timerInterval = null; }

// ── SESSION START ─────────────────────────────────────────────────────────────
export async function startSession({ idToken, userDisplayName = 'there' } = {}) {
  if (sessionActive) return;
  if (!idToken) { addMsg('ai', 'Please sign in to start a session.'); return; }

  const btn = document.getElementById('liveSessionBtn');
  if (btn) btn.disabled = true;

  // Reset stats
  _wordCount = 0; _correctCount = 0; _errCount = 0;
  _sessionCorrections.length = 0;
  updateStats();
  const corrCard = document.getElementById('correctionsCard');
  if (corrCard) corrCard.style.display = 'none';
  const corrList = document.getElementById('correctionsList');
  if (corrList) corrList.innerHTML = '';

  // Clear chat
  const wrap = document.getElementById('messagesWrap');
  if (wrap) {
    const typing = document.getElementById('typingIndicator');
    wrap.innerHTML = '';
    if (typing) wrap.appendChild(typing);
  }

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
      if (resp.status === 403 && e.upgrade) {
        addMsg('ai', 'You have used your free sessions. Upgrade to Pro to continue.');
        if (btn) btn.disabled = false;
        cleanup(); return;
      }
      throw new Error(e.error || `Worker error ${resp.status}`);
    }
    const { token } = await resp.json();
    if (!token) throw new Error('No token returned from Worker.');

    // Build a personalised system prompt from the active profile
    const profile = window._activeProfile || {};
    const lang       = profile.targetLanguage || 'German';
    const level      = profile.level          || 'B1';
    const native     = profile.nativeLanguage || 'Gujarati';
    const goal       = profile.goal           || 'daily conversation';
    const mode       = profile.preferredMode  || 'guided';

    const systemPromptText = `You are AURA, a warm and intelligent AI language tutor.
The student's name is ${userDisplayName}. They are learning ${lang} at ${level} level.
Their native language is ${native}. Mode: ${mode}.
Their goal: ${goal}.

Personality: warm, encouraging, patient. Celebrate small wins genuinely.

Teaching approach:
- Conduct the session in ${lang}. Use ${native} or English only for corrections and brief grammar notes.
- When the student makes a mistake, say a short verbal signal in ${lang} (e.g. "Fast richtig." or "Kleiner Fehler."), then say the correct version once clearly.
- After verbal correction, append a correction summary in this exact format on a new line:
  CORRECTION: [wrong] → [right] | NOTE: [one-sentence explanation in English]
- Keep each voice turn to 2-3 sentences maximum.
- Ask follow-up questions to keep the conversation flowing.
- Start by greeting the student warmly in ${lang}.`;

    ws = new WebSocket(`${GEMINI_WS_EPHEMERAL}?access_token=${token}`);
    ws.binaryType = 'arraybuffer';

    const wsTimeout = setTimeout(() => {
      if (!sessionActive) {
        addMsg('ai', 'Connection timed out. Please try again.');
        if (btn) btn.disabled = false;
        cleanup();
      }
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
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: { parts: [{ text: systemPromptText }] }
        }
      }));

      workletNode = await createWorklet(micCtx, micStream, {
        onAudioChunk: (pcmBuffer) => {
          if (!sessionActive || micMuted) return;
          if (ws?.readyState !== WebSocket.OPEN) return;
          const b64 = btoa(String.fromCharCode(...new Uint8Array(pcmBuffer)));
          ws.send(JSON.stringify({
            realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: b64 }] }
          }));
        }
      });

      sessionActive = true;
      window.sessionActive = true;
      startTimer();
      setOrbSpeaking(true);
      if (btn) btn.disabled = false;

      // Keep-alive every 8s
      window._keepAlive = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN && sessionActive) {
          try { ws.send(JSON.stringify({ realtimeInput: { mediaChunks: [] } })); } catch (e) {}
        } else clearInterval(window._keepAlive);
      }, 8000);
    };

    ws.onmessage = (event) => {
      try {
        const txt = event.data instanceof ArrayBuffer
          ? new TextDecoder().decode(event.data)
          : event.data;
        handleServerMessage(JSON.parse(txt));
      } catch (e) {}
    };

    ws.onerror = () => {
      addMsg('ai', 'Connection error. Please try again.');
      cleanup();
    };

    ws.onclose = (e) => {
      clearTimeout(wsTimeout);
      if (sessionActive) {
        if (e.code !== 1000) addMsg('ai', 'Connection lost. Please restart the session.');
        cleanup();
      }
    };

  } catch (err) {
    addMsg('ai', `Could not start: ${err.message}`);
    if (btn) btn.disabled = false;
    cleanup();
  }
}

// ── SERVER MESSAGE HANDLER ────────────────────────────────────────────────────
function handleServerMessage(msg) {
  if (msg.serverContent) {
    const sc = msg.serverContent;

    // AURA's audio
    if (sc.modelTurn?.parts) {
      sc.modelTurn.parts.forEach(part => {
        if (part.inlineData?.mimeType?.startsWith('audio/') && part.inlineData.data) {
          setOrbSpeaking(true);
          enqueueAudio(playbackNode, part.inlineData.data);
        }
      });
    }

    // AURA's text transcription — stream it
    if (sc.outputTranscription?.text) {
      streamAuraChunk(sc.outputTranscription.text);
    }

    // Student's speech — show as a message bubble
    if (sc.inputTranscription?.isFinal) {
      const text = (sc.inputTranscription.text || '').trim();
      if (text && !micMuted) {
        // Count words
        const words = text.split(/\s+/).filter(w => w.length > 1);
        _wordCount += words.length;
        _correctCount++;
        updateStats();
        addMsg('me', text);
      }
    }

    // AURA's turn complete — finalise bubble and detect corrections
    if (sc.turnComplete) {
      const fullText = finaliseAuraMessage();
      setOrbSpeaking(false);

      if (fullText) {
        // Parse the CORRECTION: format we asked AURA to use
        const corrLineMatch = fullText.match(/CORRECTION:\s*(.+?)\s*→\s*(.+?)(?:\s*\|\s*NOTE:\s*(.+))?$/im);
        if (corrLineMatch) {
          const wrong = corrLineMatch[1].trim();
          const right = corrLineMatch[2].trim();
          const note  = corrLineMatch[3]?.trim() || '';
          // Remove the correction line from the displayed bubble
          const displayText = fullText.replace(/CORRECTION:.*$/im, '').trim();
          const bubble = _streamingEl?.querySelector('.bubble');
          if (bubble) bubble.textContent = displayText;

          // Render visual correction block under AURA's last message
          const lastAuraMsg = document.querySelector('#messagesWrap .msg.ai:last-of-type');
          if (lastAuraMsg) {
            const block = document.createElement('div');
            block.className = 'corr-block';
            block.innerHTML = `
              <div class="corr-label">✕ Correction</div>
              ${wrong ? `<div class="corr-wrong">${escHtml(wrong)}</div><div class="corr-arrow">↓</div>` : ''}
              <div class="corr-right">✓ ${escHtml(right)}</div>
              ${note ? `<div class="corr-note">${escHtml(note)}</div>` : ''}
            `;
            lastAuraMsg.appendChild(block);
            const wrap = document.getElementById('messagesWrap');
            if (wrap) wrap.scrollTop = wrap.scrollHeight;
          }

          // Track in right panel
          _errCount++;
          _correctCount = Math.max(0, _correctCount - 1); // this turn had an error not a correct
          _sessionCorrections.push({ wrong, right, note });
          updateStats();
          updateCorrectionsPanel();
        } else {
          // No explicit correction — try to detect from natural language
          const lastAuraMsg = document.querySelector('#messagesWrap .msg.ai:last-of-type');
          if (/fast richtig|kleiner fehler|small mistake|almost|nicht.*sondern/i.test(fullText)) {
            detectAndRenderCorrection(fullText, lastAuraMsg);
          }
        }
      }
    }

    if (sc.interrupted) setOrbSpeaking(false);
  }

  if (msg.error) {
    addMsg('ai', `API Error: ${msg.error.message || JSON.stringify(msg.error)}`);
  }
}

// ── END SESSION ───────────────────────────────────────────────────────────────
export async function endSession() {
  if (!sessionActive) return;
  cleanup();
  stopTimer();
  setOrbSpeaking(false);
  addMsg('ai', `Great work! You spoke ${_wordCount} words in this session. See you next time 👋`);
}

// ── MIC TOGGLE ────────────────────────────────────────────────────────────────
export function toggleMic() {
  micMuted = !micMuted;
  const btn  = document.getElementById('micBtn');
  const icon = btn?.querySelector('.vc-icon');
  if (icon) icon.textContent = micMuted ? '🔇' : '🎙️';
  btn?.classList.toggle('mic-active', !micMuted);
  return micMuted;
}

// ── SEND TEXT ─────────────────────────────────────────────────────────────────
export function sendText(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true }
  }));
}

export function getSessionState() { return sessionActive ? 'active' : 'idle'; }

// ── CLEANUP ───────────────────────────────────────────────────────────────────
function cleanup() {
  sessionActive = false;
  window.sessionActive = false;
  if (window._keepAlive) { clearInterval(window._keepAlive); window._keepAlive = null; }
  if (workletNode)  { try { workletNode.disconnect();  } catch (e) {} workletNode  = null; }
  if (playbackNode) { try { playbackNode.disconnect(); } catch (e) {} playbackNode = null; }
  if (micStream)    { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx)     { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
  if (micCtx)       { try { micCtx.close();   } catch (e) {} micCtx   = null; }
  if (ws)           { try { ws.close();        } catch (e) {} ws       = null; }
  micMuted = false;
}

// ── INIT — called from ui.js ──────────────────────────────────────────────────
export function initSession({ getIdToken, getUserDisplayName }) {
  document.getElementById('liveSessionBtn')?.addEventListener('click', async () => {
    if (sessionActive) return;
    const idToken = await getIdToken().catch(() => null);
    await startSession({ idToken, userDisplayName: getUserDisplayName() });
  });

  document.getElementById('idleStartBtn')?.addEventListener('click', async () => {
    if (sessionActive) return;
    const idToken = await getIdToken().catch(() => null);
    await startSession({ idToken, userDisplayName: getUserDisplayName() });
  });

  document.getElementById('micBtn')?.addEventListener('click', () => {
    if (!sessionActive) return;
    toggleMic();
  });

  // Text send
  let _sending = false;
  async function handleSend() {
    if (_sending) return;
    const input = document.getElementById('chatInput');
    const text  = input?.value.trim();
    if (!text) return;
    if (sessionActive && ws?.readyState === WebSocket.OPEN) {
      addMsg('me', text);
      input.value = '';
      sendText(text);
      return;
    }
    // Offline text fallback via Anthropic
    _sending = true;
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) sendBtn.disabled = true;
    addMsg('me', text);
    input.value = '';
    const typing = document.getElementById('typingIndicator');
    const wrap   = document.getElementById('messagesWrap');
    if (typing) { typing.style.display = 'flex'; if (wrap) wrap.scrollTop = wrap.scrollHeight; }
    try {
      const profile  = window._activeProfile || {};
      const lang     = profile.targetLanguage || 'German';
      const level    = profile.level          || 'B1';
      const native   = profile.nativeLanguage || 'Gujarati';
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          system: `You are AURA, a warm AI language tutor. Student is learning ${lang} at ${level}. Native language: ${native}. Reply in max 3 sentences. Correct grammar errors gently with the format: CORRECTION: [wrong] → [right]. No bullet points.`,
          messages: [{ role: 'user', content: text }]
        })
      });
      const data  = await res.json();
      if (typing) typing.style.display = 'none';
      const reply = data.content?.[0]?.text || 'Sehr gut! Keep going.';
      const msgEl = addMsg('ai', reply.replace(/CORRECTION:.*→.*$/im, '').trim());
      if (msgEl) detectAndRenderCorrection(reply, msgEl);
    } catch {
      if (typing) typing.style.display = 'none';
      addMsg('ai', 'Your German is coming along well. Try another sentence?');
    }
    _sending = false;
    if (sendBtn) sendBtn.disabled = false;
  }

  document.getElementById('sendBtn')?.addEventListener('click', handleSend);
  document.getElementById('chatInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSend();
  });

  document.querySelectorAll('.sug-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('chatInput');
      if (input) { input.value = chip.textContent.trim(); input.focus(); }
    });
  });
}
