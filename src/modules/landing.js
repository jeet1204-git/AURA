// ── THEME ──
const html = document.documentElement;
const themeBtn = document.getElementById('themeToggle');
const pref = window.matchMedia('(prefers-color-scheme: dark)').matches;
let theme = localStorage.getItem('aura-theme') || (pref ? 'dark' : 'light');
function applyTheme(t) {
  theme = t;
  html.setAttribute('data-theme', t === 'light' ? 'light' : '');
  themeBtn.textContent = t === 'light' ? '🌙' : '☀️';
  localStorage.setItem('aura-theme', t);
}
applyTheme(theme);
themeBtn.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));

// ── CUSTOM CURSOR ──
const dot = document.getElementById('cursorDot');
const ring = document.getElementById('cursorRing');
let mx = 0, my = 0, rx = 0, ry = 0;
document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
function animateCursor() {
  dot.style.left = mx + 'px'; dot.style.top = my + 'px';
  rx += (mx - rx) * 0.12; ry += (my - ry) * 0.12;
  ring.style.left = rx + 'px'; ring.style.top = ry + 'px';
  requestAnimationFrame(animateCursor);
}
animateCursor();
document.querySelectorAll('a,button,.lc,.mode-card,.tier,.feat-card,.lang-sel-btn').forEach(el => {
  el.addEventListener('mouseenter', () => ring.classList.add('hover'));
  el.addEventListener('mouseleave', () => ring.classList.remove('hover'));
});
document.addEventListener('mousedown', () => ring.classList.add('click'));
document.addEventListener('mouseup', () => ring.classList.remove('click'));

// ── SCROLL REVEAL ──
const revealObs = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

// ── FEATURES SLIDER ──
const track = document.getElementById('featTrack');
const dots = document.querySelectorAll('.s-dot');
const cards = track.querySelectorAll('.feat-card');
let currentSlide = 0;
function goToSlide(i) {
  currentSlide = Math.max(0, Math.min(i, cards.length - 1));
  track.scrollTo({ left: currentSlide * (400 + 16), behavior: 'smooth' });
  dots.forEach((d, idx) => d.classList.toggle('active', idx === currentSlide));
}
document.getElementById('prevBtn').addEventListener('click', () => goToSlide(currentSlide - 1));
document.getElementById('nextBtn').addEventListener('click', () => goToSlide(currentSlide + 1));
track.addEventListener('scroll', () => {
  const i = Math.round(track.scrollLeft / (400 + 16));
  if (i !== currentSlide) { currentSlide = i; dots.forEach((d, idx) => d.classList.toggle('active', idx === i)); }
});

// ── HERO LIVE CHAT ──
// Pre-scripted screen content per language (fixed — matches what's visible)
const HERO_SCREEN = {
  German: {
    label: 'B1 German',
    greeting: 'Guten Morgen! Wie war dein Wochenende?',
    userWrong: 'Ich bin gegangen ins Kino.',
    fix: '✗ &nbsp;gegangen ins → ins Kino <strong>gegangen</strong>',
    exp: 'Verb always sentence na end ma aave chhe. "Ich bin ins Kino gegangen" correct chhe.',
    userRight: 'Ich bin ins Kino gegangen.',
    perfect: 'Perfekt. That\'s exactly it. ✓',
    input: 'How do I use der, die, das in German?',
    voiceLines: [
      'Guten Morgen! Ich bin AURA.',
      'Wie war dein Wochenende?',
      'Almost! One small fix.',
      'Gegangen ins — it should be ins Kino gegangen.',
      'In German, the verb always goes to the end of the sentence.',
      'Ich bin ins Kino gegangen — that\'s correct!',
      'Perfekt. That\'s exactly it!'
    ]
  },
  French: {
    label: 'A2 French',
    greeting: 'Bonjour! Comment s\'est passé ton week-end?',
    userWrong: 'Je suis allé au cinéma hier.',
    fix: '✓ &nbsp;Correct! Good use of passé composé.',
    exp: '"Je suis allé" — être verb sathe passé composé bane chhe. Tame sari rite yaad rakhyu!',
    userRight: 'Merci, AURA! C\'est utile.',
    perfect: 'Très bien! Keep going. ✓',
    input: 'How do I conjugate être in present tense?',
    voiceLines: [
      'Bonjour! Je suis AURA, votre tuteur de langues.',
      'Comment s\'est passé ton week-end?',
      'Très bien! You used the passé composé correctly.',
      'Je suis allé au cinéma — perfect French!',
      'Continuons!'
    ]
  },
  Japanese: {
    label: 'A1 Japanese',
    greeting: 'こんにちは！週末はどうでしたか？',
    userWrong: '映画館に行きました。',
    fix: '✓ &nbsp;Correct! 〜ました is perfect past tense.',
    exp: '"行きました" — past tense chhe. Tame bilkul saru bol\'yu!',
    userRight: 'ありがとう、AURA！',
    perfect: '素晴らしい！That\'s great! ✓',
    input: 'How do I say "I like" in Japanese?',
    voiceLines: [
      'こんにちは！私はAURAです。',
      '週末はどうでしたか？',
      'Very good!',
      '映画館に行きました — that\'s perfect Japanese past tense!',
      '素晴らしい！'
    ]
  }
};

let heroLang = 'German';
let heroSending = false;

const heroMsgs = document.getElementById('heroMsgs');
const heroInput = document.getElementById('heroInput');
const heroSendBtn = document.getElementById('heroSendBtn');
const heroTyping = document.getElementById('heroTyping');
const heroLangLabel = document.getElementById('heroLangLabel');

function updateHeroScreen(lang) {
  heroLang = lang;
  const s = HERO_SCREEN[lang];
  heroLangLabel.textContent = s.label;
  document.getElementById('heroGreeting').textContent = s.greeting;
  document.getElementById('heroErrBox').innerHTML = s.fix;
  document.getElementById('heroExpText').textContent = s.exp.replace(/<[^>]*>/g, '');
  document.getElementById('heroCorrected').textContent = s.userRight;
  heroInput.value = s.input;
}

document.getElementById('heroLangPicker').addEventListener('click', e => {
  const btn = e.target.closest('.hero-lang-btn');
  if (!btn) return;
  document.querySelectorAll('.hero-lang-btn').forEach(b => b.classList.toggle('active', b === btn));
  updateHeroScreen(btn.dataset.lang);
});

function addHeroMsg(role, html) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'ai' ? 'ai' : 'me');
  div.innerHTML = `<div class="msg-lbl">${role === 'ai' ? 'AURA' : 'YOU'}</div><div class="bubble">${html}</div>`;
  heroMsgs.appendChild(div);
  heroMsgs.scrollTop = heroMsgs.scrollHeight;
}

async function heroSend() {
  if (heroSending) return;
  const msg = heroInput.value.trim();
  if (!msg) return;
  heroSending = true;
  heroSendBtn.disabled = true;
  addHeroMsg('me', msg);
  heroInput.value = '';
  heroTyping.style.display = 'block';
  heroMsgs.scrollTop = heroMsgs.scrollHeight;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `You are AURA, a warm AI language tutor. Student is learning ${heroLang}. Reply in max 3 sentences. Give the correct answer, one clear example, and a tiny hint in Gujarati (italic). No bullet points. Be encouraging.`,
        messages: [{ role: 'user', content: msg }]
      })
    });
    const data = await res.json();
    const reply = data.content?.[0]?.text || 'Great question! Let me explain that for you.';
    heroTyping.style.display = 'none';
    addHeroMsg('ai', reply);
  } catch {
    heroTyping.style.display = 'none';
    const s = HERO_SCREEN[heroLang];
    addHeroMsg('ai', s.perfect);
  }
  heroSending = false;
  heroSendBtn.disabled = false;
  heroInput.value = HERO_SCREEN[heroLang].input;
}

heroSendBtn.addEventListener('click', heroSend);
heroInput.addEventListener('keydown', e => { if (e.key === 'Enter') heroSend(); });

// ── HERO VOICE (reads what's on screen — pre-scripted, no synthesis guesswork) ──
// TO USE REAL AURA VOICE: replace the SpeechSynthesisUtterance logic below
// with: const audio = new Audio('aura-voice-preview.mp3'); audio.play();
// Record that MP3 once using AURA's actual Gemini voice.

const heroVoiceBtn = document.getElementById('heroVoiceBtn');
const heroVoiceWave = document.getElementById('heroVoiceWave');
const heroVoiceBtnText = document.getElementById('heroVoiceBtnText');
const heroPlayRing = document.getElementById('heroPlayRing');
let voiceSpeaking = false;

// The exact lines visible on screen, spoken in order
const VOICE_SCRIPT = {
  German: "Guten Morgen! Wie war dein Wochenende? ... Almost! One small fix. In German, the verb always goes to the end. Ich bin ins Kino gegangen — that is correct! Perfekt. That is exactly it.",
  French: "Bonjour! Comment s'est passé ton week-end? ... Très bien! You used passé composé correctly. Je suis allé au cinéma. Continuons!",
  Japanese: "こんにちは！週末はどうでしたか？... Very good! 映画館に行きました — perfect past tense. 素晴らしい！"
};

function speakScreen() {
  if (voiceSpeaking) {
    speechSynthesis.cancel();
    voiceSpeaking = false;
    heroVoiceWave.style.display = 'none';
    heroVoiceBtnText.textContent = 'Hear AURA speak';
    heroPlayRing.textContent = '▶';
    heroVoiceWave.classList.remove('playing');
    return;
  }

  const script = VOICE_SCRIPT[heroLang];
  const utter = new SpeechSynthesisUtterance(script);

  // Best available voice selection — try to avoid the most robotic ones
  const allVoices = speechSynthesis.getVoices();
  const langCode = heroLang === 'German' ? 'de' : heroLang === 'French' ? 'fr' : 'ja';

  // Priority: Google voices > Apple voices > anything in that language > default
  const preferred = allVoices.find(v => v.lang.startsWith(langCode) && v.name.includes('Google'))
    || allVoices.find(v => v.lang.startsWith(langCode) && (v.name.includes('Samantha') || v.name.includes('Anna') || v.name.includes('Google')))
    || allVoices.find(v => v.lang.startsWith(langCode));

  if (preferred) utter.voice = preferred;
  utter.lang = heroLang === 'German' ? 'de-DE' : heroLang === 'French' ? 'fr-FR' : 'ja-JP';
  utter.rate = 0.9;
  utter.pitch = 1.05;

  utter.onstart = () => {
    voiceSpeaking = true;
    heroVoiceWave.style.display = 'flex';
    heroVoiceWave.classList.add('playing');
    heroVoiceBtnText.textContent = 'Stop';
    heroPlayRing.textContent = '■';
  };
  utter.onend = utter.onerror = () => {
    voiceSpeaking = false;
    heroVoiceWave.style.display = 'none';
    heroVoiceWave.classList.remove('playing');
    heroVoiceBtnText.textContent = 'Hear AURA speak';
    heroPlayRing.textContent = '▶';
  };

  speechSynthesis.speak(utter);
}

heroVoiceBtn.addEventListener('click', speakScreen);
// Preload voices (Chrome needs this)
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

// ── BILLING TOGGLE ──
function setBilling(mode) {
  document.getElementById('btnMonthly').classList.toggle('active', mode === 'monthly');
  document.getElementById('btnAnnual').classList.toggle('active', mode === 'annual');
  document.querySelectorAll('.price-val').forEach(el => {
    el.textContent = mode === 'annual' ? el.dataset.annual : el.dataset.monthly;
  });
}
