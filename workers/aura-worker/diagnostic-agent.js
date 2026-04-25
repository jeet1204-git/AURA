/**
 * diagnostic-agent.js
 * AURA Intelligent Diagnostic Onboarding Layer.
 *
 * Runs a short Gemini text conversation (3 learner turns) to:
 *   1. Understand motivation and prior exposure
 *   2. Show a simple probe phrase in the target language
 *   3. Ask the learner to produce it back
 *   4. Estimate entry CEFR band (A1–C1) from responses
 *
 * The whole conversation happens in the learner's native language.
 * Called by /diagnostic route in worker.js.
 */

const GEMINI_TEXT_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// ── One probe phrase per target language — simple greeting + name question ──
const PROBE_PHRASES = {
  German:     { phrase: 'Guten Tag! Wie heißen Sie?',            translation: 'Good day! What is your name?' },
  French:     { phrase: 'Bonjour ! Comment vous appelez-vous ?', translation: 'Hello! What is your name?' },
  Spanish:    { phrase: '¡Buenos días! ¿Cómo se llama usted?',   translation: 'Good morning! What is your name?' },
  Japanese:   { phrase: 'はじめまして。お名前は何ですか？',              translation: 'Nice to meet you. What is your name?' },
  Italian:    { phrase: 'Buongiorno! Come si chiama?',            translation: 'Good morning! What is your name?' },
  Mandarin:   { phrase: '你好！你叫什么名字？',                         translation: 'Hello! What is your name?' },
  Korean:     { phrase: '안녕하세요! 성함이 어떻게 되세요?',              translation: 'Hello! What is your name?' },
  Portuguese: { phrase: 'Bom dia! Como se chama?',                translation: 'Good morning! What is your name?' },
  Arabic:     { phrase: 'مرحبا! ما اسمك؟',                        translation: 'Hello! What is your name?' },
  Hindi:      { phrase: 'नमस्ते! आपका नाम क्या है?',                translation: 'Hello! What is your name?' },
};

// ── System prompt: tells Gemini exactly how to run each turn ─────────────────
function buildSystemPrompt(nativeLanguage, targetLanguage) {
  const probe = PROBE_PHRASES[targetLanguage]
    || { phrase: 'Hello! How are you?', translation: 'Hello! How are you?' };

  return `You are AURA, conducting a language placement assessment. You speak ONLY in ${nativeLanguage} throughout this entire conversation — never in ${targetLanguage} except for the single probe phrase below.

TARGET LANGUAGE: ${targetLanguage}
NATIVE LANGUAGE OF LEARNER: ${nativeLanguage}

== YOUR JOB ==
Have a warm, natural 3-exchange conversation to assess the learner's ${targetLanguage} proficiency level. You will then output a final assessment message.

== EXCHANGE 1 — your very first message ==
- Greet warmly in ${nativeLanguage}. Say your name is AURA and you are their ${targetLanguage} tutor.
- Ask why they want to learn ${targetLanguage}. Keep this question open and warm.
- Maximum 3 sentences total.

== EXCHANGE 2 — after their first reply ==
- Acknowledge their motivation briefly (one sentence, warm).
- Show them this ${targetLanguage} phrase exactly as written: "${probe.phrase}"
- Ask two things in ${nativeLanguage}: (a) What do they think this phrase means? (b) Can they try writing it back in ${targetLanguage}?
- Maximum 3 sentences total.

== EXCHANGE 3 — after their second reply ==
- React warmly to their attempt (one sentence).
- Ask what their main goal is. Give exactly these options: travel, work/professional, exam preparation, or daily conversation.
- Maximum 2 sentences total.

== FINAL ASSESSMENT — after their third reply ==
- Give a warm, honest 2-sentence assessment in ${nativeLanguage} that names the CEFR level (e.g., "Based on our conversation, you are at A1 level — you are just beginning your ${targetLanguage} journey and AURA will start from zero with you.")
- On a new line, output ONLY this block — nothing else after it:
##DIAGNOSTIC_RESULT##{"estimatedLevel":"A1","confidence":"high","goalType":"conversation","reasoning":"one sentence explaining the estimate"}##END##

== CEFR ESTIMATION RULES ==
- A1: Could not understand or reproduce ANY of the probe phrase; completely fresh start.
- A2: Recognised some words in the probe but could not reproduce it accurately.
- B1: Understood the probe, reproduced it with some errors.
- B2: Understood and reproduced it well with minor imprecision.
- C1: Reproduced it accurately with natural ease.

goalType must be one of: "travel", "work", "exam", "conversation".
Choose the closest match from what the learner said in exchange 3.

== ABSOLUTE RULES ==
1. NEVER output ##DIAGNOSTIC_RESULT## before the final assessment message (i.e., before the 4th AI message).
2. ALWAYS speak in ${nativeLanguage} — never switch to ${targetLanguage} except for the probe phrase in exchange 2.
3. Be warm, patient, and encouraging at every step — never make the learner feel judged.
4. Keep messages SHORT — 2–3 sentences maximum. No lists, no markdown.`;
}

// ── Main export: run one diagnostic turn ─────────────────────────────────────
// history: Array of { role: 'aura' | 'user', text: string }
// Returns: { message: string, complete: boolean, diagnosticResult: object | null }
export async function runDiagnosticTurn(env, { nativeLanguage, targetLanguage, history }) {
  const systemInstruction = buildSystemPrompt(nativeLanguage, targetLanguage);

  // Convert to Gemini content format
  const contents = history.map(msg => ({
    role: msg.role === 'aura' ? 'model' : 'user',
    parts: [{ text: msg.text }],
  }));

  const res = await fetch(
    `${GEMINI_TEXT_URL}?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: {
          temperature:     0.65,
          maxOutputTokens: 320,
          topP:            0.9,
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini diagnostic API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data        = await res.json();
  const rawText     = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const finishReason = data?.candidates?.[0]?.finishReason || '';

  // Extract ##DIAGNOSTIC_RESULT## block if present
  const resultMatch = rawText.match(/##DIAGNOSTIC_RESULT##([\s\S]*?)##END##/);
  let diagnosticResult = null;
  let cleanMessage = rawText;

  if (resultMatch) {
    try {
      diagnosticResult = JSON.parse(resultMatch[1].trim());
    } catch (e) {
      console.error('[diagnostic-agent] Failed to parse CEFR result JSON:', resultMatch[1]);
      // Still mark complete — we'll fall back to A1 on the save side
      diagnosticResult = { estimatedLevel: 'A1', confidence: 'low', goalType: 'conversation', reasoning: 'Parse error fallback' };
    }
    // Strip the tag block from the visible message
    cleanMessage = rawText.replace(/\n*##DIAGNOSTIC_RESULT##[\s\S]*?##END##/, '').trim();
  }

  return {
    message:         cleanMessage,
    complete:        !!diagnosticResult,
    diagnosticResult,
    finishReason,
  };
}
