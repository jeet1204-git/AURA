import { WORKER_URL } from '../config/constants.js';
import { buildExamEvalPrompt } from './evaluation.js';
import { escHtml, toast } from './evaluation.js';
import { getIdToken } from './auth.js';
import { checkSessionAccess } from './firestore.js';

// ── State ──────────────────────────────────────────────────────────────────
let mtSelectedExam = null;   // 'a1_speaking' | 'a2_teil1' | 'a2_teil2' | 'a2_teil3' | 'a2_full'
let mtSelectedStyle = 'supportive';
let mtActiveBlueprint = null;
let mtConvoHistory = [];
let mtWordsUsed = new Set();
let mtWs = null, mtAudioCtx = null, mtMicCtx = null, mtMicStream = null;
let mtWorkletNode = null, mtPlaybackNode = null;
let mtSessionActive = false;
let mtTimerInterval = null, mtTimerSeconds = 0;
let mtPrepTimer = null;
let mtPrepSeconds = 20;
let mtExamPhase = 'prep'; // 'prep' | 'speaking' | 'ended'

// ── Exam configs ────────────────────────────────────────────────────────────
const MT_EXAM_CONFIGS = {
  a1_speaking: {
    label: 'Goethe A1 · Sprechen',
    cert: 'Goethe-Zertifikat A1',
    section: 'Sprechen',
    isTeil2: false,
    level: 'A1',
    examPart: 'teil1',
    durationMins: 5,
    prepSecs: 15,
    rules: [
      { icon: '🎙️', text: 'You will be asked simple personal questions in German.' },
      { icon: '🤫', text: 'The examiner will NOT correct you during the exam.' },
      { icon: '🕐', text: 'Speak for at least 2–3 sentences per answer.' },
      { icon: '🇩🇪', text: 'Answer only in German. No English, no Gujarati.' },
      { icon: '📵', text: 'No hints will be given. Silence is part of the exam.' },
    ],
  },
  a2_teil1: {
    label: 'Goethe A2 FIT · Sprechen Teil 1',
    cert: 'Goethe-Zertifikat A2 Fit',
    section: 'Sprechen Teil 1',
    isTeil2: false,
    level: 'A2',
    examPart: 'teil1',
    durationMins: 5,
    prepSecs: 15,
    rules: [
      { icon: '🃏', text: 'You get 4 word cards (e.g. Geburtstag, Wohnort, Beruf, Hobby).' },
      { icon: '❓', text: 'For each card: form a question and ask your partner. They answer, then ask you back.' },
      { icon: '🔄', text: 'This Q&A exchange repeats for all 4 cards.' },
      { icon: '🇩🇪', text: 'German only. Short, natural A2 sentences.' },
      { icon: '🤫', text: 'No corrections during the exam.' },
    ],
  },
  a2_teil2: {
    label: 'Goethe A2 FIT · Sprechen Teil 2',
    cert: 'Goethe-Zertifikat A2 Fit',
    section: 'Sprechen Teil 2',
    isTeil2: true,
    level: 'A2',
    examPart: 'teil2',
    durationMins: 6,
    prepSecs: 20,
    rules: [
      { icon: '📋', text: 'You will receive a card with a topic and 4 corner keywords.' },
      { icon: '👁', text: 'The card stays visible the whole time — refer to it while you speak.' },
      { icon: '🗣', text: 'Speak for 60–90 seconds. Cover the main topic AND all 4 corners.' },
      { icon: '🤫', text: 'The examiner is silent while you speak. This is normal.' },
      { icon: '🎯', text: 'Target: 12–15 sentences. Use weil, deshalb, aber, außerdem.' },
    ],
  },
  a2_teil3: {
    label: 'Goethe A2 FIT · Sprechen Teil 3',
    cert: 'Goethe-Zertifikat A2 Fit',
    section: 'Sprechen Teil 3',
    isTeil2: false,
    isTeil3: true,
    level: 'A2',
    examPart: 'teil3',
    durationMins: 6,
    prepSecs: 10,
    rules: [
      { icon: '🤝', text: 'You and AURA are planning something together — a party, a trip, or an event.' },
      { icon: '🗣', text: 'This is a dialogue. Make suggestions, agree, disagree, and negotiate in German.' },
      { icon: '🎯', text: 'Both of you must contribute. AURA will make suggestions — you respond and add your own.' },
      { icon: '🤫', text: 'No corrections during the exam. AURA plays your partner, not your teacher.' },
      { icon: '🇩🇪', text: 'German only. Use modal verbs: können, sollen, wollen, dürfen.' },
    ],
  },
  a2_full: {
    label: 'Goethe A2 FIT · Full Mock',
    cert: 'Goethe-Zertifikat A2 Fit',
    section: 'Full Mock Exam',
    isTeil2: true,
    isFull: true,
    level: 'A2',
    examPart: 'full_mock',
    durationMins: 15,
    prepSecs: 20,
    rules: [
      { icon: '📋', text: 'Complete A2 Sprechen simulation: Teil 1 → Teil 2 → Teil 3.' },
      { icon: '🎙️', text: 'Teil 1: examiner asks personal questions. You answer in German.' },
      { icon: '🃏', text: 'Teil 2: card with 4 corners. Speak for 60–90 seconds covering all points.' },
      { icon: '🤝', text: 'Teil 3: collaborative planning with AURA as your partner.' },
      { icon: '⏱', text: 'Total: ~15 minutes. Pass mark is 60% overall (official Goethe standard).' },
    ],
  },
};

// ── Navigation helpers ──────────────────────────────────────────────────────
export function mtShowScreen(screenId) {
  document.querySelectorAll('#page-mocktest .mt-screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) { target.classList.add('active'); window.scrollTo(0,0); }
}

// ── Lobby interactions ──────────────────────────────────────────────────────
export function mtSelectExam(card) {
  document.querySelectorAll('.mt-exam-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  mtSelectedExam = card.dataset.exam;
  const btn = document.getElementById('mt-proceed-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Continue →'; }
}

export function mtSelectStyle(btn) {
  document.querySelectorAll('.mt-style-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  mtSelectedStyle = btn.dataset.style;
}

export function mtProceedToBriefing() {
  if (!mtSelectedExam) return;
  const cfg = MT_EXAM_CONFIGS[mtSelectedExam];
  document.getElementById('mt-briefing-title').textContent = cfg.label;
  document.getElementById('mt-briefing-subtitle').textContent =
    `Mock Exam · ${mtSelectedStyle.charAt(0).toUpperCase() + mtSelectedStyle.slice(1)} Examiner`;
  const rulesEl = document.getElementById('mt-briefing-rules');
  rulesEl.innerHTML = cfg.rules.map(r =>
    `<div class="mt-rule"><span class="mt-rule-icon">${r.icon}</span><span>${r.text}</span></div>`
  ).join('');
  mtShowScreen('mt-briefing');
}

// ── Begin exam ──────────────────────────────────────────────────────────────
export async function mtBeginExam() {
  if (!mtSelectedExam) return;
  const cfg = MT_EXAM_CONFIGS[mtSelectedExam];

  // Build blueprint using existing exam topic machinery
  try {
    // Set global state so buildExamBlueprint() works
    selectedLevel = cfg.level;
    selectedProgramType = 'exam';
    selectedExamPart = cfg.examPart;
    selectedExamRunType = 'scored';
    selectedExaminerStyle = mtSelectedStyle;
    selectedExamTopicId = null; // random draw
    mtActiveBlueprint = buildExamBlueprint();
    activeBlueprint = mtActiveBlueprint;
  } catch(e) {
    console.error('[MT] Failed to build blueprint:', e);
    alert('Could not load exam topic. Please try again.');
    return;
  }

  // Switch to exam screen
  mtShowScreen('mt-exam');

  // Set topbar label
  document.getElementById('mt-exam-label').textContent =
    `${cfg.cert} · ${cfg.section} · Mock Exam`;
  document.getElementById('mt-nav-title').textContent = 'Mock Test — In Progress';

  // Render card or question
  mtRenderCardPanel(cfg);

  // Reset conversation area
  const convo = document.getElementById('mt-convo-area');
  if (convo) {
    convo.innerHTML = `<div class="mt-examiner-strip">
      <div class="mt-examiner-avatar">⚖️</div>
      <div>
        <div class="mt-examiner-name">Goethe Examiner</div>
        <div class="mt-examiner-role" id="mt-examiner-role">Exam in progress</div>
      </div>
    </div>`;
  }

  // Reset state
  mtConvoHistory = [];
  mtWordsUsed = new Set();
  mtExamPhase = 'prep';
  mtTimerSeconds = cfg.durationMins * 60;

  // Show "PREP" in timer during preparation — not counting down yet
  const timerEl = document.getElementById('mt-exam-timer');
  if (timerEl) timerEl.textContent = 'PREP';

  // Warm up AudioContext during prep so there's no delay when speaking starts
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    if (audioCtx.state === 'suspended') await audioCtx.resume();
  } catch(e) { console.warn('[MT] AudioContext error:', e); }

  // Start prep countdown — timer only begins when prep ends
  mtStartPrepCountdown(cfg.prepSecs, async () => {
    mtExamPhase = 'speaking';
    mtUpdateCardPanelState('speaking');
    document.getElementById('mt-prep-countdown').classList.add('hidden');
    document.getElementById('mt-speaking-prompt').classList.add('visible');

    // NOW start the speaking timer
    mtUpdateTimer();
    if (mtTimerInterval) clearInterval(mtTimerInterval);
    mtTimerInterval = setInterval(() => {
      mtTimerSeconds--;
      mtUpdateTimer();
      if (mtTimerSeconds <= 0) mtEndExam();
    }, 1000);

    // Connect to Gemini Live
    await mtConnectLive();
  });
}

export function mtRenderCardPanel(cfg) {
  const bp = mtActiveBlueprint;
  const isTeil2 = cfg.isTeil2 && cfg.examPart !== 'full_mock';
  const isTeil1 = cfg.examPart === 'a2_teil1' || cfg.examPart === 'teil1';
  const isTeil3 = cfg.examPart === 'a2_teil3' || cfg.examPart === 'teil3';
  const isFullMock = cfg.examPart === 'full_mock';

  const card     = document.getElementById('mt-goethe-card');
  const qDisp    = document.getElementById('mt-question-display');
  const t1Cards  = document.getElementById('mt-teil1-cards');
  const t3Cal    = document.getElementById('mt-teil3-calendar');
  const qWrap    = document.getElementById('mt-question-text-wrap');

  // Hide all panels first
  if (card)    card.style.display    = 'none';
  if (qDisp)   qDisp.style.display   = 'none';
  if (t1Cards) t1Cards.style.display = 'none';
  if (t3Cal)   t3Cal.style.display   = 'none';
  if (qWrap)   qWrap.style.display   = 'none';

  if (isTeil2 || isFullMock) {
    // ── Teil 2: diamond card ──
    if (card) card.style.display = 'block';
    const corners = bp.corners || [];
    ['tl','tr','bl','br'].forEach((pos, i) => {
      const el = document.getElementById(`mt-c-${pos}`);
      if (el) { el.textContent = corners[i] ? corners[i] + '?' : '—'; el.classList.remove('covered'); }
    });
    const center = document.getElementById('mt-card-center');
    if (center) center.textContent = bp.topicTitle || bp.title || '—';
    const subtitle = document.getElementById('mt-card-subtitle');
    if (subtitle) subtitle.textContent = 'von sich erzählen';
    const certEl = document.getElementById('mt-card-cert');
    if (certEl) certEl.textContent = cfg.cert || 'Goethe-Zertifikat A2';
    const secEl = document.getElementById('mt-card-section');
    if (secEl) secEl.textContent = 'Sprechen Teil 2';

  } else if (isTeil1) {
    // ── Teil 1: four word cards ──
    if (qDisp)   qDisp.style.display   = 'block';
    if (t1Cards) t1Cards.style.display = 'block';
    const cards = bp.cards || ['Geburtstag', 'Wohnort', 'Beruf', 'Hobby'];
    cards.forEach((word, i) => {
      const el = document.getElementById(`mt-t1-card-${i}`);
      if (!el) return;
      el.innerHTML = `
        <div class="mt-t1-card-topbar">
          <span>Goethe-Zertifikat <span class="a2-badge">A2</span></span>
          <span>Sprechen Teil 1</span>
        </div>
        <div class="mt-t1-card-subtitle">Fragen zur Person</div>
        <div class="mt-t1-card-keyword">${escHtml(word)}?</div>`;
    });

  } else if (isTeil3) {
    // ── Teil 3: calendar ──
    if (qDisp) qDisp.style.display = 'block';
    if (t3Cal) t3Cal.style.display = 'block';
    const cal = bp.teil3Calendar;
    if (cal) {
      const taskEl = document.getElementById('mt-t3-task');
      const dayEl  = document.getElementById('mt-t3-day');
      const grid   = document.getElementById('mt-t3-calendar-grid');
      if (taskEl) taskEl.textContent = 'Aufgabe: ' + cal.task;
      if (dayEl)  dayEl.textContent  = cal.day;
      if (grid) {
        grid.innerHTML = cal.auraSlots.map(s => `
          <div class="mt-t3-slot ${s.busy ? 'busy' : 'free'}">
            <span class="mt-t3-time">${escHtml(s.time)}</span>
            <span class="mt-t3-activity ${s.busy ? '' : 'free-label'}">${escHtml(s.activity)}</span>
          </div>`).join('');
      }
    }

  } else {
    // ── Fallback ──
    if (qDisp)  qDisp.style.display  = 'block';
    if (qWrap)  qWrap.style.display  = 'block';
    const qText = document.getElementById('mt-question-text');
    if (qText) qText.textContent = bp.topicTitle || bp.title || '—';
  }

  // Set prep countdown duration
  const prepSecs = cfg.prepSecs;
  mtPrepSeconds = prepSecs;
  const secsEl = document.getElementById('mt-prep-secs');
  const fillEl = document.getElementById('mt-prep-fill');
  if (secsEl) secsEl.textContent = prepSecs;
  if (fillEl) { fillEl.style.transition = 'none'; fillEl.style.width = '100%'; fillEl.classList.remove('urgent'); }
  document.getElementById('mt-prep-countdown').classList.remove('hidden');
  document.getElementById('mt-speaking-prompt').classList.remove('visible');
  mtUpdateCardPanelState('prep');
}

export function mtUpdateCardPanelState(state) {
  const el = document.getElementById('mt-card-panel-state');
  const textEl = document.getElementById('mt-panel-state-text');
  if (!el) return;
  el.className = `${state}`;
  el.id = 'mt-card-panel-state';
  const labels = { prep: 'Preparation — read the card', speaking: 'Speaking — card stays visible', ended: 'Exam ended' };
  if (textEl) textEl.textContent = labels[state] || state;
}

// ── Prep countdown ──────────────────────────────────────────────────────────
export function mtStartPrepCountdown(seconds, onComplete) {
  if (mtPrepTimer) clearInterval(mtPrepTimer);
  let remaining = seconds;
  const secsEl = document.getElementById('mt-prep-secs');
  const fillEl = document.getElementById('mt-prep-fill');

  mtPrepTimer = setInterval(() => {
    remaining--;
    if (secsEl) secsEl.textContent = remaining;
    if (fillEl) {
      fillEl.style.transition = 'width 1s linear';
      fillEl.style.width = `${(remaining / seconds) * 100}%`;
      if (remaining <= 5) fillEl.classList.add('urgent');
    }
    if (remaining <= 0) {
      clearInterval(mtPrepTimer);
      mtPrepTimer = null;
      onComplete();
    }
  }, 1000);
}

// ── Timer ───────────────────────────────────────────────────────────────────
export function mtUpdateTimer() {
  const el = document.getElementById('mt-exam-timer');
  if (!el) return;
  const m = Math.floor(Math.abs(mtTimerSeconds) / 60);
  const s = Math.abs(mtTimerSeconds) % 60;
  el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  el.classList.toggle('urgent', mtTimerSeconds <= 60);
}

// ── Connect to Gemini Live (reuses existing machinery) ──────────────────────
export async function mtConnectLive() {
  try {
    const currentUser = window.currentUser || null;
    const idToken = currentUser ? await getIdToken(currentUser) : null;
    if (!idToken) { mtAppendExaminerMsg('Authentication required. Please refresh and try again.'); return; }
    const access = await checkSessionAccess(currentUser?.uid);
    if (!access?.allowed) {
      mtAppendExaminerMsg('Free-session limit reached. Please upgrade to continue mock tests.');
      return;
    }

    const tokenResp = await fetch(`${WORKER_URL}/token`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ idToken })
    });
    const tokenData = await tokenResp.json();
    const ephemeralToken = tokenData.token;
    if (!ephemeralToken) throw new Error('No token returned');

    const systemPrompt = buildSystemPrompt();
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(ephemeralToken)}`;

    mtWs = new WebSocket(wsUrl);
    mtWs.binaryType = 'arraybuffer';

    mtWs.onopen = () => {
      mtWs.send(JSON.stringify({
        setup: {
          model: 'models/gemini-3.1-flash-live-preview',
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } },
          systemInstruction: { parts: [{ text: systemPrompt }] }
        }
      }));
      mtSessionActive = true;
      mtStartMicCapture();
    };

    mtWs.onmessage = (evt) => { mtHandleWsMessage(evt); };
    mtWs.onerror  = (err) => { console.error('[MT] WS error', err); };
    mtWs.onclose  = (evt) => {
      mtSessionActive = false;
      if (mtExamPhase !== 'ended') {
        mtAppendExaminerMsg('Connection lost. Submitting your exam…');
        mtEndExam();
      }
    };
  } catch(err) {
    console.error('[MT] Connect error:', err);
    mtAppendExaminerMsg('Could not connect. Please check your connection and try again.');
  }
}

// ── WS message handler ──────────────────────────────────────────────────────
let mtCurrentAiText = '';
let mtCurrentAiEl = null;

export function mtHandleWsMessage(evt) {
  try {
    if (evt.data instanceof ArrayBuffer) {
      // Audio playback — reuse existing playPcm16 if available
      if (typeof playPcm16 === 'function') playPcm16(new Int16Array(evt.data));
      return;
    }
    const msg = JSON.parse(evt.data);

    // Setup complete — examiner speaks first
    if (msg.setupComplete) {
      mtWs.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'Begin the exam now.' }] }], turnComplete: true } }));
      return;
    }

    // Streaming text from examiner
    const part = msg.serverContent?.modelTurn?.parts?.[0];
    if (part?.text) {
      const txt = part.text;
      // Strip metadata tags silently
      const clean = txt.replace(/##STUDENT##.*?##END##/gs, '').trim();
      if (!clean) return;
      if (!mtCurrentAiEl) {
        mtCurrentAiText = '';
        mtCurrentAiEl = mtAppendExaminerMsg('');
      }
      mtCurrentAiText += clean;
      if (mtCurrentAiEl) mtCurrentAiEl.textContent = mtCurrentAiText;
    }

    // Turn complete
    if (msg.serverContent?.turnComplete) {
      if (mtCurrentAiText) {
        mtConvoHistory.push({ role: 'assistant', content: mtCurrentAiText });
      }
      mtCurrentAiText = '';
      mtCurrentAiEl = null;
    }

    // Audio data
    const audioPart = msg.serverContent?.modelTurn?.parts?.find(p => p.inlineData?.mimeType?.startsWith('audio/'));
    if (audioPart?.inlineData?.data && typeof playBase64Audio === 'function') {
      playBase64Audio(audioPart.inlineData.data);
    }
  } catch(e) { /* ignore parse errors */ }
}

export function mtAppendExaminerMsg(text) {
  const area = document.getElementById('mt-convo-area');
  if (!area) return null;
  const div = document.createElement('div');
  div.className = 'mt-msg examiner';
  div.innerHTML = `<div class="mt-msg-avatar">⚖️</div><div class="mt-msg-bubble">${escHtml(text)}</div>`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return div.querySelector('.mt-msg-bubble');
}

export function mtAppendStudentMsg(text) {
  const area = document.getElementById('mt-convo-area');
  if (!area) return;
  const div = document.createElement('div');
  div.className = 'mt-msg student';
  div.innerHTML = `<div class="mt-msg-avatar">🎙</div><div class="mt-msg-bubble">${escHtml(text)}</div>`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  // Track for evaluation
  mtConvoHistory.push({ role: 'user', content: text });
  text.toLowerCase().split(/\s+/).forEach(w => { if (w.length > 2) mtWordsUsed.add(w); });
}

// ── Mic capture — reuses shared audioCtx + cached worklet blob ──────────────
export async function mtStartMicCapture() {
  try {
    mtMicStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000, channelCount: 1 }
    });

    // Separate 16kHz context for mic capture (same pattern as createWorklet)
    mtMicCtx = new AudioContext({ sampleRate: 16000 });
    const source = mtMicCtx.createMediaStreamSource(mtMicStream);

    // Use the same cached blob URL — processor name is 'mic-processor'
    await mtMicCtx.audioWorklet.addModule(getWorkletBlobUrl());
    mtWorkletNode = new AudioWorkletNode(mtMicCtx, 'mic-processor');

    mtWorkletNode.port.onmessage = (e) => {
      if (mtWs?.readyState !== WebSocket.OPEN || !mtSessionActive || mtExamPhase !== 'speaking') return;
      const bytes = new Uint8Array(e.data);
      let bin = ''; for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
      // NEW
mtWs.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(bin), mimeType: 'audio/pcm;rate=16000' } } }));
      if(dgWs&&dgWs.readyState===WebSocket.OPEN) dgWs.send(bytes.buffer);
    };

    source.connect(mtWorkletNode);

    // Ensure playback worklet ready for examiner audio
    await ensurePlaybackWorklet();

    const statusEl = document.getElementById('mt-mic-status');
    if (statusEl) { statusEl.textContent = '🎙 Listening…'; statusEl.classList.add('active'); }
  } catch(e) {
    console.error('[MT] Mic error:', e);
    const statusEl = document.getElementById('mt-mic-status');
    if (statusEl) statusEl.textContent = '⚠ Microphone unavailable — check browser permissions';
  }
}

export function mtStopMicCapture() {
  try {
    if (mtWorkletNode) { mtWorkletNode.disconnect(); mtWorkletNode = null; }
    if (mtMicStream)   { mtMicStream.getTracks().forEach(t => t.stop()); mtMicStream = null; }
    if (mtMicCtx)      { mtMicCtx.close().catch(()=>{}); mtMicCtx = null; }
  } catch(e) {}
}

// ── End exam ────────────────────────────────────────────────────────────────
export async function mtEndExam() {
  if (mtExamPhase === 'ended') return;
  mtExamPhase = 'ended';

  if (mtTimerInterval) { clearInterval(mtTimerInterval); mtTimerInterval = null; }
  if (mtPrepTimer)     { clearInterval(mtPrepTimer); mtPrepTimer = null; }
  mtStopMicCapture();
  if (mtWs) { try { mtWs.close(); } catch(e) {} mtWs = null; }
  mtSessionActive = false;
  mtUpdateCardPanelState('ended');

  // Show results screen with loading state
  mtShowScreen('mt-results');
  document.getElementById('mt-verdict-hero').className = '';
  document.getElementById('mt-verdict-label').textContent = 'Evaluating…';
  document.getElementById('mt-verdict-score').textContent = '…';
  document.getElementById('mt-verdict-title').textContent = 'Processing your exam…';
  document.getElementById('mt-verdict-reason').textContent = '';
  document.getElementById('mt-score-breakdown').style.display = 'none';
  document.getElementById('mt-corner-section').style.display = 'none';
  document.getElementById('mt-feedback-block').style.display = 'none';
  document.getElementById('mt-errors-section').style.display = 'none';

  // Need at least 2 turns to evaluate
  if (mtConvoHistory.length < 2) {
    document.getElementById('mt-verdict-label').textContent = 'Too short';
    document.getElementById('mt-verdict-score').textContent = '—';
    document.getElementById('mt-verdict-title').textContent = 'Exam too short to score';
    document.getElementById('mt-verdict-reason').textContent = 'Please speak for at least 30 seconds before ending the exam.';
    return;
  }

  try {
    const currentUser = window.currentUser || null;
    const idToken = currentUser ? await getIdToken(currentUser) : null;
    if (!idToken) throw new Error('Auth required');
    const tokenResp = await fetch(`${WORKER_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ idToken }),
    });
    const tokenData = await tokenResp.json();
    const apiKey = tokenData.token || tokenData.key || tokenData.apiKey;
    if (!apiKey) throw new Error('No token');

    const transcript = mtConvoHistory.map(m => {
      const role = m.role === 'user' ? 'STUDENT' : 'EXAMINER';
      const content = m.content === '[non-German speech detected]'
        ? '[student spoke in native language — redirected to German]'
        : m.content;
      return `${role}: ${content}`;
    }).join('\n');
    const wordList = [...mtWordsUsed].slice(0,30).join(', ');

    const evalPrompt = buildExamEvalPrompt(mtActiveBlueprint, selectedLangPref);

    const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Session transcript:\n\n${transcript}\n\nGerman words used: ${wordList}` }] }],
        systemInstruction: { parts: [{ text: evalPrompt }] }
      })
    });

    const evalData = await resp.json();
    const raw = evalData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const result = JSON.parse(raw.replace(/```json|```/g,'').trim());
    mtRenderResults(result);
  } catch(err) {
    console.error('[MT] Eval error:', err);
    document.getElementById('mt-verdict-label').textContent = 'Error';
    document.getElementById('mt-verdict-title').textContent = 'Could not evaluate exam';
    document.getElementById('mt-verdict-reason').textContent = 'Please try again. If the problem persists, check your connection.';
  }
}

export function mtRenderResults(r) {
  const verdict = r.passVerdict || 'at_risk';
  const verdictMap = {
    safe_pass:       { cls:'pass',       label:'✓ Pass (≥60%)',          title:'Safe Pass' },
    borderline_pass: { cls:'borderline', label:'⚠ Borderline (50–59%)', title:'Borderline Pass' },
    at_risk:         { cls:'fail',       label:'✗ Not Ready (<50%)',      title:'Needs More Work' },
  };
  const v = verdictMap[verdict] || verdictMap['at_risk'];

  // Verdict hero
  const hero = document.getElementById('mt-verdict-hero');
  hero.className = v.cls;
  document.getElementById('mt-verdict-label').textContent  = v.label;
  document.getElementById('mt-verdict-score').textContent  = r.overall ?? '—';
  document.getElementById('mt-verdict-title').textContent  = v.title;
  document.getElementById('mt-verdict-reason').textContent = r.verdictReason || '';

  // Score bars helper
  const fillClass = (val) => val >= 75 ? 'high' : val >= 55 ? 'med' : val >= 40 ? 'low' : 'fail';
  const setBar = (barId, valId, val) => {
    const bar = document.getElementById(barId);
    const valEl = document.getElementById(valId);
    if (bar) { bar.className = `mt-score-fill ${fillClass(val || 0)}`; setTimeout(() => { bar.style.width = (val || 0) + '%'; }, 80); }
    if (valEl) valEl.textContent = (val ?? '—');
  };

  setBar('mt-bar-task',      'mt-val-task',      r.taskCompletion);
  setBar('mt-bar-connector', 'mt-val-connector', r.connectorUse);
  setBar('mt-bar-grammar',   'mt-val-grammar',   r.grammar);
  setBar('mt-bar-vocab',     'mt-val-vocab',     r.vocabulary);
  setBar('mt-bar-fluency',   'mt-val-fluency',   r.fluency);
  document.getElementById('mt-score-breakdown').style.display = 'block';

  // Sentence count
  if (r.sentenceCount) {
    const target = 15;
    const bar = document.getElementById('mt-bar-sentences');
    const val = document.getElementById('mt-val-sentences');
    const row = document.getElementById('mt-sentence-row');
    if (bar) { bar.className = `mt-score-fill ${r.sentenceCount >= 12 ? 'high' : r.sentenceCount >= 8 ? 'med' : 'low'}`; setTimeout(() => { bar.style.width = Math.min(100, (r.sentenceCount / target) * 100) + '%'; }, 80); }
    if (val) val.textContent = `${r.sentenceCount} / ${target}`;
    if (row) row.style.display = 'flex';
  }

  // Corner coverage
  if (Array.isArray(r.cornerCoverage) && r.cornerCoverage.length) {
    const list = document.getElementById('mt-corner-list');
    list.innerHTML = r.cornerCoverage.map(c => {
      const st = c.covered ? 'covered' : (c.partial ? 'partial' : 'missed');
      const ic = c.covered ? '✓' : (c.partial ? '~' : '✗');
      const lb = c.covered ? 'Covered' : (c.partial ? 'Partial' : 'Missed');
      // Also highlight the card corner if visible
      const cornerEls = document.querySelectorAll('.mt-goethe-corner');
      cornerEls.forEach(el => { if (el.textContent.replace('?','').trim() === (c.corner||'').trim() && c.covered) el.classList.add('covered'); });
      return `<div class="mt-corner-row">
        <div class="mt-corner-icon ${st}">${ic}</div>
        <div class="mt-corner-text">
          <div class="mt-corner-label">${escHtml(c.corner||'')}</div>
          ${c.note ? `<div class="mt-corner-note">${escHtml(c.note)}</div>` : ''}
        </div>
        <div class="mt-corner-status ${st}">${lb}</div>
      </div>`;
    }).join('');
    document.getElementById('mt-corner-section').style.display = 'block';
  }

  // Feedback
  if (r.overallFeedback) {
    document.getElementById('mt-feedback-text').textContent = r.overallFeedback;
    document.getElementById('mt-feedback-block').style.display = 'block';
  }

  // Errors
  const errors = (r.topErrors || []).filter(e => e.original);
  if (errors.length) {
    document.getElementById('mt-errors-list').innerHTML = errors.map(e =>
      `<div class="mt-error-item"><span class="mt-error-from">${escHtml(e.original)}</span> → <span class="mt-error-to">${escHtml(e.corrected)}</span><div class="mt-error-note">${escHtml(e.note||'')}</div></div>`
    ).join('');
    document.getElementById('mt-errors-section').style.display = 'block';
  }
}

export function mtRetakeExam() {
  mtShowScreen('mt-briefing');
}

// ── Practice mode: pin question card ───────────────────────────────────────
export function mtUpdatePracticeCardPin() {
  const pin = document.getElementById('practice-card-pin');
  const qEl = document.getElementById('pcp-question-text');
  const cornersEl = document.getElementById('pcp-corners-wrap');
  if (!pin) return;

  const bp = activeBlueprint;
  const isExam = bp?.programType === 'exam';

  // Only show for practice (non-exam) A2 exam-topic sessions, or A1
  if (!bp || isExam) {
    pin.classList.remove('visible');
    return;
  }

  const question = bp.title || bp.topicTitle || selectedScenario?.title || '';
  const corners  = bp.corners || [];

  if (!question) { pin.classList.remove('visible'); return; }

  if (qEl) qEl.textContent = question;
  if (cornersEl) {
    cornersEl.innerHTML = corners.map(c =>
      `<span class="pcp-corner-tag">${escHtml(c)}</span>`
    ).join('');
  }
  pin.classList.add('visible');
}



// Signal the synchronous stub that the module has fully loaded.
// This replaces the placeholder enterSpeakingInterface with the real one
// and replays any clicks that happened during the Firebase CDN fetch delay.
// ── Expose Mock Test Portal functions to global scope ──────────────────────
window.mtSelectExam        = mtSelectExam;
window.mtSelectStyle       = mtSelectStyle;
window.mtProceedToBriefing = mtProceedToBriefing;
window.mtBeginExam         = mtBeginExam;
window.mtEndExam           = mtEndExam;
window.mtRetakeExam        = mtRetakeExam;
window.mtShowScreen        = mtShowScreen;
window.mtUpdatePracticeCardPin = mtUpdatePracticeCardPin;
