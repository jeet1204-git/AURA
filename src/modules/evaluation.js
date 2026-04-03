import { WORKER_URL } from '../config/constants.js';

// ── EVALUATION PROMPT BUILDERS ───────────────────────────────────────────────

export function buildPracticeEvalPrompt(level, langPref, evidence) {
  const ev = evidence || {};
  const evidenceBlock = evidence ? `
STRUCTURED EVIDENCE (computed from session data — use this to ground your scores):
- Total student turns: ${ev.totalUserTurns}
- Average turn length (words): ${ev.avgTurnLength}
- One-word turns: ${ev.oneWordTurns}
- Substantial turns (5+ words): ${ev.substantialTurns}
- Long turns (10+ words): ${ev.longTurns}
- German sentence count (estimated): ${ev.germanSentenceCount}
- Connectors used: ${ev.connectorsFound?.length ? ev.connectorsFound.join(', ') : 'none detected'}
- Self-repair signals: ${ev.selfRepairCount}
- Independent responses (unscaffolded, 4+ words): ${ev.independentResponseCount}
- Scaffold/support turns from AURA: ${ev.scaffoldTurns}
- Support ratio: ${Math.round((ev.supportRatio || 0) * 100)}% of AURA turns were scaffolding
- Support dependence flag: ${ev.dependenceFlag ? 'YES — learner relied heavily on scaffolding' : 'NO — learner performed largely independently'}
- Task completion proxy: ${ev.taskCompletionProxy ? 'MET' : 'NOT MET'}
- Stage distribution: ${JSON.stringify(ev.stageDistribution || {})}

SCORING GUIDANCE FROM EVIDENCE:
- If support dependence flag is YES, cap the overall score. High support = lower readiness.
- If substantial turns < 2, fluency and taskCompletion scores must both be below 60.
- If connectors found is empty, vocabulary and grammar scores should reflect limited range.
- Scores must be consistent with the evidence above. Do not contradict it.
` : '';

  return `You are an expert Goethe-Institut examiner evaluating a ${level} German speaking practice session for a student whose native language is ${langPref}. Evaluate STRICTLY but FAIRLY.
${evidenceBlock}
SCORING WEIGHTS for "overall" (apply these exactly):
- taskCompletion: 35%
- grammar: 25%
- vocabulary: 20%
- fluency: 20%

NOTE: The transcript may contain "[non-German speech detected]" markers. These mean the student spoke in their native language and AURA redirected them. Do NOT count these as silence or penalise them as errors — they are already handled by the session flow. Only evaluate the German speech turns.

Respond ONLY with valid JSON — no markdown, no backticks, no preamble:
{"overall":<0-100>,"vocabulary":<0-100>,"grammar":<0-100>,"fluency":<0-100>,"taskCompletion":<0-100>,"vocabComment":"<1 sentence>","grammarComment":"<1 sentence>","fluencyComment":"<1 sentence>","taskComment":"<1 sentence>","overallFeedback":"<3-4 sentences, warm and constructive — acknowledge effort, name what worked, name one clear improvement>","topErrors":[{"original":"","corrected":"","note":""}],"pronunciationTips":[{"word":"","wrongWay":"","rightWay":"","nativeNote":"<tip specific to ${langPref} speakers>"}],"whatWentWell":"<2 sentences>"}`;
}

export function buildExamEvalPrompt(bp, langPref) {
  const part      = bp.examPart    || 'teil1';
  const corners   = bp.corners     || [];
  const topic     = bp.topicTitle  || bp.title || '';
  const runType   = bp.examRunType || 'practice';
  const isTeil2   = part === 'teil2';

  const cornerBlock = isTeil2 && corners.length
    ? `\nThe 4 card corners the student was required to address:\n${corners.map((c,i) => `  ${i+1}. ${c}`).join('\n')}`
    : '';

  const cornerJsonFields = isTeil2
    ? `,\n  "cornerCoverage": [${corners.map(c => `{"corner":"${c}","covered":<true|false>,"partial":<true|false>,"note":"<1 sentence>"}`).join(',')}],\n  "cornerScore": <0-100>`
    : '';

  return `You are a certified Goethe-Institut A2 oral examiner scoring a ${part === 'full_mock' ? 'full mock' : 'Sprechen ' + part.replace('teil','Teil ')} exam session.
Student native language: ${langPref}
Topic: "${topic}"${cornerBlock}
Run type: ${runType === 'scored' ? 'Scored mock — apply strict Goethe pass/fail thresholds' : 'Practice run — be thorough but encouraging in feedback'}

SCORING CRITERIA — A2 GOETHE EXAM STANDARDS:
- overall: weighted composite (see weights below)
- cornerCoverage (Teil 2 only): did the student address each of the 4 corner subtopics?
- connectorUse: active use of weil, deshalb, aber, trotzdem, wenn, dann, außerdem, obwohl
- sentenceCount: estimated number of complete German sentences produced
- taskCompletion: did the student address the main question fully?
- grammar: A2-level accuracy (verb position, cases, tense)
- vocabulary: A2-level range and appropriateness
- fluency: flow, hesitation level, self-correction frequency

PASS THRESHOLDS (Goethe A2 standard):
- safe_pass: overall ≥ 60 (Goethe A2 official pass mark)
- borderline_pass: overall 50–59
- at_risk: overall < 50

SCORING WEIGHTS for "overall":
- taskCompletion: 30%
- cornerCoverage (Teil 2): 25%
- grammar: 20%
- vocabulary: 15%
- fluency: 10%

Respond ONLY with valid JSON — no markdown, no backticks, no preamble:
{
  "overall": <0-100>,
  "vocabulary": <0-100>,
  "grammar": <0-100>,
  "fluency": <0-100>,
  "taskCompletion": <0-100>,
  "connectorUse": <0-100>,
  "sentenceCount": <integer>,
  "passVerdict": <"safe_pass"|"borderline_pass"|"at_risk">,
  "verdictReason": "<1-2 sentences explaining the verdict>",
  "vocabComment": "<1 sentence>",
  "grammarComment": "<1 sentence>",
  "fluencyComment": "<1 sentence>",
  "taskComment": "<1 sentence>",
  "connectorComment": "<1 sentence listing connectors used or missing>",
  "overallFeedback": "<3-4 sentences — examiner-register, no warmth, factual>",
  "topErrors": [{"original":"","corrected":"","note":""}],
  "pronunciationTips": [{"word":"","wrongWay":"","rightWay":"","nativeNote":"<tip for ${langPref} speakers>"}],
  "whatWentWell": "<2 sentences>"${cornerJsonFields}
}`;
}

export function resetPostSessionCoaching(fallbackText = '') {
  const card = document.getElementById('post-session-coaching');
  const list = document.getElementById('post-session-coaching-list');
  if (!card || !list) return;
  if (!fallbackText) {
    card.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  card.style.display = 'block';
  list.innerHTML = `<div class="coaching-fallback">${escHtml(fallbackText)}</div>`;
}

// ── FEEDBACK ENGINE ───────────────────────────────────────────────────────────
// Phase E — structured feedback reads from score profile + evidence record.
// Feedback is confidence-aware: wording scales with score certainty.
// Nothing here freewheels outside scored evidence. See architecture D-07.

export function buildFeedbackRecord(parsed, evidence) {
  const ev  = evidence || collectSessionEvidence();
  const bp  = activeBlueprint || {};
  const isExam = bp.programType === 'exam';

  // ── Confidence band ───────────────────────────────────────────────────────
  // Low evidence = low confidence = hedged wording.
  const turns        = ev.totalUserTurns || 0;
  const confidence   = turns >= 10 ? 'high' : turns >= 5 ? 'medium' : 'low';

  // ── Readiness band (R0-R4) ────────────────────────────────────────────────
  const overall = parsed?.overall ?? 0;
  const readinessBand =
    overall >= 85 ? 'R4' :
    overall >= 70 ? 'R3' :
    overall >= 55 ? 'R2' :
    overall >= 40 ? 'R1' : 'R0';

  const readinessLabels = {
    R4: 'Exam-ready',
    R3: 'Nearly ready',
    R2: 'Developing',
    R1: 'Early stage',
    R0: 'Needs foundation work',
  };

  // ── Primary strength — evidence-bound ────────────────────────────────────
  let strength = null;
  if ((parsed?.whatWentWell || '').trim()) {
    strength = parsed.whatWentWell.trim();
  } else if (ev.connectorCount >= 3) {
    strength = `Used ${ev.connectorCount} connectors (${ev.connectorsFound.slice(0,3).join(', ')}), showing sentence variety.`;
  } else if (ev.longTurns >= 2) {
    strength = `Produced ${ev.longTurns} longer responses (10+ words), showing growing fluency.`;
  } else if (ev.substantialTurns >= 3) {
    strength = `Gave ${ev.substantialTurns} substantial responses, completing core task exchanges.`;
  } else {
    strength = confidence === 'low'
      ? 'Attempted the session — every session builds familiarity.'
      : 'Maintained engagement throughout the session.';
  }

  // ── Primary improvement focus — weakest scoring dimension ─────────────────
  const dims = [
    { key: 'fluency',         label: 'Fluency',          score: parsed?.fluency         ?? 0 },
    { key: 'grammar',         label: 'Grammar',          score: parsed?.grammar         ?? 0 },
    { key: 'vocabulary',      label: 'Vocabulary range', score: parsed?.vocabulary      ?? 0 },
    { key: 'taskCompletion',  label: 'Task completion',  score: parsed?.taskCompletion  ?? 0 },
  ];
  const weakest = dims.slice().sort((a, b) => a.score - b.score)[0];
  const dimCommentKey = `${weakest.key}Comment`;
  const improvementFocus = parsed?.[dimCommentKey]
    ? `${weakest.label}: ${parsed[dimCommentKey]}`
    : `Focus on ${weakest.label.toLowerCase()} in your next session.`;

  // ── Concrete corrections — top 2 from topErrors, evidence-filtered ────────
  const corrections = (parsed?.topErrors || [])
    .filter(e => e.original && e.corrected)
    .slice(0, 2)
    .map(e => ({
      from: e.original.trim(),
      to:   e.corrected.trim(),
      note: (e.note || '').trim(),
    }));

  // ── Pronunciation — top 1, native-language-specific ──────────────────────
  const pronTip = (parsed?.pronunciationTips || []).find(t => t.word && t.rightWay) || null;

  // ── Support dependence note ───────────────────────────────────────────────
  let dependenceNote = null;
  if (ev.dependenceFlag) {
    dependenceNote = confidence !== 'low'
      ? `This score reflects that ${Math.round(ev.supportRatio * 100)}% of AURA's responses included scaffolding. Independent performance would score higher.`
      : null;
  }

  // ── Next step recommendation ──────────────────────────────────────────────
  let nextStep = null;
  if (readinessBand === 'R4') {
    nextStep = isExam
      ? 'You are performing at exam level. Book a mock test to confirm readiness.'
      : 'You are ready for Immersion mode or the next level.';
  } else if (readinessBand === 'R3') {
    nextStep = isExam
      ? 'One more focused mock session should confirm exam readiness.'
      : 'Try Immersion mode to push independence further.';
  } else if (readinessBand === 'R2') {
    nextStep = `Repeat this scenario focusing on ${weakest.label.toLowerCase()}. Aim for 2-3 more sessions before moving up.`;
  } else {
    nextStep = `Stay in Guided mode. Focus on completing full sentences before adding complexity.`;
  }

  return {
    confidence,
    readinessBand,
    readinessLabel: readinessLabels[readinessBand],
    overall,
    strength,
    improvementFocus,
    corrections,
    pronTip,
    dependenceNote,
    nextStep,
    isExam,
  };
}

export function renderPostSessionCoaching(parsed, evidence) {
  const card = document.getElementById('post-session-coaching');
  const list = document.getElementById('post-session-coaching-list');
  if (!card || !list) return;

  // Build feedback record from score + evidence
  const fb = buildFeedbackRecord(parsed, evidence);

  const blocks = [];

  // 1 — Readiness band + strength
  blocks.push({
    label: `Readiness: ${fb.readinessLabel}`,
    text:  fb.strength,
    tone:  'positive',
  });

  // 2 — Primary improvement focus
  blocks.push({
    label: 'Focus for next session',
    text:  fb.improvementFocus,
    tone:  'neutral',
  });

  // 3 — Top correction (if any) or pronunciation
  if (fb.corrections.length) {
    const c = fb.corrections[0];
    const text = c.note
      ? `${c.from} → ${c.to} · ${c.note}`
      : `${c.from} → ${c.to}`;
    blocks.push({ label: 'Key correction', text, tone: 'fix' });
  } else if (fb.pronTip) {
    const p = fb.pronTip;
    blocks.push({
      label: 'Pronunciation',
      text:  `${p.word}: ${p.rightWay}${p.nativeNote ? ' · ' + p.nativeNote : ''}`,
      tone:  'fix',
    });
  }

  // 4 — Support dependence note (only if flagged and confidence is sufficient)
  if (fb.dependenceNote) {
    blocks.push({ label: 'Readiness note', text: fb.dependenceNote, tone: 'caution' });
  }

  // 5 — Next step (always show — this is the actionable coaching card)
  if (fb.nextStep) {
    blocks.push({ label: 'Next step', text: fb.nextStep, tone: 'neutral' });
  }

  if (!blocks.length) {
    card.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  const toneColors = {
    positive: 'var(--green)',
    neutral:  'var(--blue)',
    fix:      '#ff9f0a',
    caution:  'var(--mid)',
  };

  list.innerHTML = blocks.slice(0, 4).map(b => `
    <div class="coaching-chip">
      <div class="coaching-chip-label" style="color:${toneColors[b.tone] || 'var(--blue)'};">${escHtml(b.label)}</div>
      <div class="coaching-chip-text">${escHtml(b.text)}</div>
    </div>
  `).join('');
  card.style.display = 'block';
}
// ── END FEEDBACK ENGINE ───────────────────────────────────────────────────────

export function renderScore(result, evidence){
  const pct=Math.min(100,result.overall||0);
  const circ=2*Math.PI*70;
  const offset=circ-(pct/100)*circ;
  const ring=document.getElementById('score-ring-fill');
  if(ring){ring.style.strokeDasharray=circ;ring.style.strokeDashoffset=circ;setTimeout(()=>{ring.style.strokeDashoffset=offset;},100);}
  document.getElementById('score-num-inner').textContent=result.overall||'—';
  renderSessionLabels();
  [['vocab','vocabulary'],['grammar','grammar'],['fluency','fluency'],['task','taskCompletion']].forEach(([id,key])=>{
    const bar=document.getElementById('bar-'+id);const val=document.getElementById('score-'+id);const comm=document.getElementById('comment-'+id);
    if(bar)bar.style.width=(result[key]||0)+'%';
    if(val)val.textContent=(result[key]||0)+'/100';
    if(comm)comm.textContent=result[id+'Comment']||result[key+'Comment']||'';
  });
  document.getElementById('overall-feedback-text').textContent=result.overallFeedback||'';
  renderPostSessionCoaching(result, evidence);

  // ── Exam verdict card ──────────────────────────────────────────────────────
  const verdictCard = document.getElementById('exam-verdict-card');
  const isExam = activeBlueprint?.programType === 'exam';
  if (isExam && result.passVerdict && verdictCard) {
    const v = result.passVerdict;
    const labels = {
      safe_pass:        { badge: '✓ Pass (≥60%)',         text: 'Safe Pass',      cls: 'pass' },
      borderline_pass:  { badge: '⚠ Borderline (50–59%)', text: 'Borderline Pass', cls: 'borderline' },
      at_risk:          { badge: '✗ Not Yet Ready (<50%)', text: 'Needs More Work', cls: 'fail' },
    };
    const l = labels[v] || labels['at_risk'];
    verdictCard.className = l.cls;
    document.getElementById('exam-verdict-badge').textContent = l.badge;
    document.getElementById('exam-verdict-text').textContent  = l.text;
    document.getElementById('exam-verdict-sub').textContent   = result.verdictReason || '';
    verdictCard.style.display = 'block';
  } else if (verdictCard) {
    verdictCard.style.display = 'none';
  }

  // ── Corner coverage (Teil 2 only) ──────────────────────────────────────────
  const cornerCard = document.getElementById('exam-corner-coverage');
  const cornerList = document.getElementById('exam-corner-list');
  const isTeil2 = isExam && activeBlueprint?.examPart === 'teil2';
  if (isTeil2 && Array.isArray(result.cornerCoverage) && result.cornerCoverage.length && cornerCard && cornerList) {
    cornerList.innerHTML = result.cornerCoverage.map(c => {
      const status = c.covered ? 'covered' : (c.partial ? 'partial' : 'missed');
      const icon   = c.covered ? '✓' : (c.partial ? '~' : '✗');
      const label  = status === 'covered' ? 'Covered' : (status === 'partial' ? 'Partial' : 'Missed');
      return `<div class="corner-row">
        <div class="corner-icon ${status}">${icon}</div>
        <div class="corner-label">${escHtml(c.corner || '')}</div>
        <div class="corner-status ${status}">${label}</div>
      </div>
      ${c.note ? `<div style="font-size:12px;color:var(--mid);margin:-4px 0 4px 32px;line-height:1.45;">${escHtml(c.note)}</div>` : ''}`;
    }).join('');
    cornerCard.style.display = 'block';
  } else if (cornerCard) {
    cornerCard.style.display = 'none';
  }

  // ── A1 streak tracking (unchanged) ────────────────────────────────────────
  if (selectedScenario?.level === 'A1') {
    const success = (result.overall || 0) >= 60;
    const streak = success ? Math.min(99, getA1SuccessStreak() + 1) : 0;
    localStorage.setItem('aura_a1_success_streak', String(streak));
    updateSessionModeRecommendation();
  }

  // ── Errors + pronunciation (unchanged) ────────────────────────────────────
  const errList=document.getElementById('errors-list'); errList.innerHTML='';
  (result.topErrors||[]).filter(e=>e.original).forEach(e=>{errList.innerHTML+=`<li><span class="err-from">${escHtml(e.original)}</span> → <span class="err-to">${escHtml(e.corrected)}</span><br><small style="color:var(--cream3);font-weight:300;">${escHtml(e.note)}</small></li>`;});
  const pronList=document.getElementById('pronunciation-tips-list');const pronSec=document.getElementById('pronunciation-section');
  if(result.pronunciationTips?.length){
    pronSec.style.display='block';
    pronList.innerHTML=result.pronunciationTips.filter(t=>t&&t.word&&t.rightWay).map(t=>`<div class="pron-tip"><span class="pron-word">${escHtml(t.word)}</span><br>❌ ${escHtml(t.wrongWay||'')} → ✅ ${escHtml(t.rightWay)}<span class="pron-native-note">🌐 ${escHtml(t.nativeNote||t.gujaratiNote||'')}</span></div>`).join('');
  } else {
    pronSec.style.display='none';
    pronList.innerHTML='';
  }
}

export function escHtml(t){return(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'<br>');}
export function toast(msg,dur=3500){const t=document.createElement('div');t.className='toast-toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),dur);}
