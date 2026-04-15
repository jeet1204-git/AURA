/**
 * session-bridge.js
 *
 * Minimal Gemini Live session manager wired directly to app-screens.html.
 * Replaces the old session.js for the new dashboard — no blueprint system,
 * no exam mode, no paywall. Just: token → WebSocket → mic → audio → UI.
 *
 * Drop into src/modules/session-bridge.js
 * Import in ui.js: import { initSession } from './session-bridge.js';
 */

import { WORKER_URL, GEMINI_WS_EPHEMERAL, MODEL } from '../config/constants.js';
import { getWorkletBlobUrl, createWorklet, ensurePlaybackWorklet, enqueueAudio } from '../audio/worklets.js';

// ── STATE ─────────────────────────────────────────────────────────────────────
let ws          = null;
let micStream   = null;
let micCtx      = null;
let audioCtx    = null;
let workletNode = null;
let dgWs        = null;
let dgClosingByApp = false;

let sessionActive = false;
let micMuted      = false;

// ── DOM REFS ──────────────────────────────────────────────────────────────────
const auraOrb      = () => document.getElementById('auraOrb');
const messagesWrap = () => document.getElementById('messagesWrap');
const typingEl     = () => document.getElementById('typingIndicator');
const statusEl     = () => document.querySelector('.session-status');
const micBtnEl     = () => document.getElementById('micBtn');
const liveBtn      = () => document.getElementById('liveSessionBtn');
const endBtn       = () => document.getElementById('endSessionBtn');
const chatInput    = () => document.getElementById('chatInput');
const sendBtn      = () => document.getElementById('sendBtn');
const timerEl      = () => document.getElementById('sessionTimer');

// ── HELPERS ───────────────────────────────────────────────────────────────────
function addMsg(role, html) {
  const wrap = messagesWrap();
  if (!wrap) return;
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'ai' ? 'ai' : 'me');
  div.innerHTML = `<div class="msg-label">${role === 'ai' ? 'AURA' : 'YOU'}</div><div class="bubble">${html}</div>`;
  const typing = typingEl();
  typing ? wrap.insertBefore(div, typing) : wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function setStatus(label, color) {
  const el = statusEl();
  if (!el) return;
  const dot = el.querySelector('.status-dot');
  if (dot) dot.style.background = color || 'var(--green)';
  const textNode = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = ' ' + label;
  else el.append(' ' + label);
}

function setOrbSpeaking(on) {
  auraOrb()?.classList.toggle('speaking', on);
  const wfLabel = document.querySelector('.wf-label');
  if (wfLabel) wfLabel.textContent = on ? 'AURA Speaking' : 'Listening…';
}

// ── TIMER ─────────────────────────────────────────────────────────────────────
let timerSeconds = 0;
let timerInterval = null;

function startTimer() {
  timerSeconds = 0;
  timerInterval = setInterval(() => {
    timerSeconds++;
    const h = String(Math.floor(timerSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((timerSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(timerSeconds % 60).padStart(2, '0');
    const el = timerEl();
    if (el) el.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ── SESSION START ─────────────────────────────────────────────────────────────
export async function startSession({ idToken, userDisplayName = 'there' } = {}) {
  if (sessionActive) return;
  if (!idToken) { addMsg('ai', '⚠️ Please sign in to start a session.'); return; }

  const btn = liveBtn();
  if (btn) btn.disabled = true;
  setStatus('Connecting…', 'var(--amber)');
  addMsg('ai', '✨ Starting your live session — one moment…');

  try {
    // 1. Audio contexts
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (micCtx.state === 'suspended') await micCtx.resume();

    // 2. Mic permission
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    // 3. Playback worklet
    await ensurePlaybackWorklet(audioCtx);

    // 4. Fetch ephemeral token from Worker
    const resp = await fetch(`${WORKER_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Worker error ${resp.status}`);
    }
    const { token } = await resp.json();
    if (!token) throw new Error('No token returned from Worker.');

    // 5. Open Gemini Live WebSocket
    ws = new WebSocket(`${GEMINI_WS_EPHEMERAL}?access_token=${encodeURIComponent(token)}`);
    ws.binaryType = 'arraybuffer';

    const wsTimeout = setTimeout(() => {
      if (!sessionActive) {
        addMsg('ai', '⚠️ Connection timed out. Please try again.');
        cleanup();
      }
    }, 10000);

    ws.onopen = async () => {
      clearTimeout(wsTimeout);

      // Send setup
      ws.send(JSON.stringify({
        setup: {
          model: MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: { parts: [{ text: buildSystemPrompt(userDisplayName) }] }
        }
      }));

      // Start mic worklet
      workletNode = await createWorklet(micCtx, micStream);

      sessionActive = true;
      startTimer();
      setStatus('Live · Voice', 'var(--green)');
      setOrbSpeaking(true);
      if (btn) btn.disabled = false;
      addMsg('ai', `Hey ${userDisplayName}! I'm connected. Say something in German whenever you're ready 🎙️`);

      // Keep-alive ping every 8s
      window._keepAlive = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN && sessionActive) {
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
      addMsg('ai', '⚠️ WebSocket error. Please try again.');
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
    addMsg('ai', `⚠️ ${err.message}`);
    setStatus('Disconnected', 'var(--red)');
    if (btn) btn.disabled = false;
    cleanup();
  }
}

// ── SERVER MESSAGE HANDLER ────────────────────────────────────────────────────
let currentAiText = '';

function handleServerMessage(msg) {
  // Setup complete — Gemini is ready
  if (msg.setupComplete !== undefined) {
    setStatus('Live · Voice', 'var(--green)');
  }

  if (msg.serverContent) {
    const sc = msg.serverContent;

    // Audio output — play it
    if (sc.modelTurn?.parts) {
      sc.modelTurn.parts.forEach(part => {
        if (part.inlineData?.mimeType?.startsWith('audio/')) {
          setOrbSpeaking(true);
          enqueueAudio(audioCtx, part.inlineData.data);
        }
      });
    }

    // AURA's text transcript — accumulate
    if (sc.outputTranscription?.text) {
      currentAiText += sc.outputTranscription.text;
    }

    // User's speech transcript
    if (sc.inputTranscription?.isFinal) {
      const text = (sc.inputTranscription.text || '').trim();
      if (text) addMsg('me', text);
    }

    // Turn complete — show AURA's full message
    if (sc.turnComplete) {
      if (currentAiText.trim()) {
        addMsg('ai', currentAiText.trim());
        currentAiText = '';
      }
      setOrbSpeaking(false);
    }

    if (sc.interrupted) setOrbSpeaking(false);
  }

  if (msg.error) {
    addMsg('ai', `⚠️ API Error: ${msg.error.message || JSON.stringify(msg.error)}`);
  }
}

// ── END SESSION ───────────────────────────────────────────────────────────────
export async function endSession() {
  if (!sessionActive) return;
  addMsg('ai', 'Wrapping up your session…');
  cleanup();
  stopTimer();
  setStatus('Session ended', 'var(--muted)');
  setOrbSpeaking(false);
  addMsg('ai', 'Great work today! See you next time 👋');
}

// ── MIC TOGGLE ────────────────────────────────────────────────────────────────
export function toggleMic() {
  micMuted = !micMuted;
  const btn = micBtnEl();
  const icon = btn?.querySelector('.vc-icon');
  if (icon) icon.textContent = micMuted ? '🔇' : '🎙️';
  btn?.classList.toggle('mic-active', !micMuted);
  return micMuted;
}

// ── SEND TEXT INTO SESSION ────────────────────────────────────────────────────
export function sendText(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    clientContent: {
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true
    }
  }));
}

export function getSessionState() {
  return sessionActive ? 'active' : 'idle';
}

// ── CLEANUP ───────────────────────────────────────────────────────────────────
function cleanup() {
  sessionActive = false;
  if (window._keepAlive) { clearInterval(window._keepAlive); window._keepAlive = null; }
  if (dgWs) { dgClosingByApp = true; try { dgWs.close(); } catch (e) {} dgWs = null; }
  if (workletNode) { try { workletNode.disconnect(); } catch (e) {} workletNode = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
  if (micCtx) { try { micCtx.close(); } catch (e) {} micCtx = null; }
  if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  micMuted = false;
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
function buildSystemPrompt(name = 'there') {
  return `You are AURA, a warm and intelligent AI language tutor.

The student's name is ${name}. They are learning German at B1 level.
Their native language is Gujarati. They also speak English fluently.

Your personality:
- Warm, encouraging, patient — never condescending
- You celebrate small wins genuinely
- You speak naturally and conversationally

Your teaching approach:
- Respond primarily in English, weaving in German words and examples naturally
- If the student makes a grammar error, correct it once, clearly, then move on
- Occasionally say a short encouraging phrase in Gujarati to feel personal
- Ask follow-up questions to keep the conversation alive
- Keep each voice turn concise: 2-3 sentences maximum

Start by greeting the student warmly in German, then immediately switch to a mix of English and German for the conversation.`;
}

// ── INIT — wires all dashboard buttons ───────────────────────────────────────
export function initSession({ getIdToken, getUserDisplayName }) {
  // Live session button
  liveBtn()?.addEventListener('click', async () => {
    if (sessionActive) return;
    const idToken = await getIdToken().catch(() => null);
    await startSession({ idToken, userDisplayName: getUserDisplayName() });
  });

  // End session button
  endBtn()?.addEventListener('click', async () => {
    if (!sessionActive) return;
    if (!confirm('End this session? Your progress will be saved.')) return;
    endBtn().disabled = true;
    await endSession();
    endBtn().disabled = false;
  });

  // Mic button
  micBtnEl()?.addEventListener('click', () => {
    if (!sessionActive) return;
    toggleMic();
  });

  // Chat input — routes through live session if active, else REST fallback
  let sending = false;

  async function handleSend() {
    if (sending) return;
    const input = chatInput();
    const text = input?.value.trim();
    if (!text) return;

    if (sessionActive) {
      addMsg('me', text);
      input.value = '';
      sendText(text);
      return;
    }

    // REST fallback
    sending = true;
    if (sendBtn()) sendBtn().disabled = true;
    addMsg('me', text);
    input.value = '';
    const typing = typingEl();
    if (typing) { typing.style.display = 'flex'; messagesWrap().scrollTop = messagesWrap().scrollHeight; }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          system: `You are AURA, a warm AI language tutor. Student is learning German at B1 level. Native language: Gujarati. Also speaks English. Reply in max 3 sentences. Correct grammar errors gently. Ask a follow-up question if correct. Occasionally add a tip in Gujarati (italicized). No bullet points.`,
          messages: [{ role: 'user', content: text }]
        })
      });
      const data = await res.json();
      if (typing) typing.style.display = 'none';
      addMsg('ai', data.content?.[0]?.text || 'Sehr gut! Keep going.');
    } catch {
      if (typing) typing.style.display = 'none';
      addMsg('ai', 'Sehr gut! Your German is coming along well. Try another sentence?');
    }

    sending = false;
    if (sendBtn()) sendBtn().disabled = false;
  }

  sendBtn()?.addEventListener('click', handleSend);
  chatInput()?.addEventListener('keydown', e => { if (e.key === 'Enter') handleSend(); });
}
