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
const HERO_SCREEN = {
  German: {
    label: 'B1 German',
    greeting: 'Guten Morgen! Wie war dein Wochenende?',
    userWrong: 'Ich bin gegangen ins Kino.',
    fix: '✗ &nbsp;gegangen ins → ins Kino <strong>gegangen</strong>',
    exp: 'Verb always sentence na end ma aave chhe.',
    userRight: 'Ich bin ins Kino gegangen. Danke, AURA!',
    perfect: 'Perfekt! 🎉 Das war wirklich gut.',
    input: 'How do I say "I went to the cinema"?',
    voiceLines: [
      'Guten Morgen! Wie war dein Wochenende?',
      'Almost! One small fix.',
      'In German, the verb always goes to the end.',
      'Ich bin ins Kino gegangen — that is correct!',
      'Perfekt. Das war wirklich gut.'
    ]
  },
  French: {
    label: 'A2 French',
    greeting: 'Bonjour! Comment s\'est passé ton week-end?',
    userWrong: 'Je suis allé au cinéma avec mes amis.',
    fix: '✓ &nbsp;Correct! Passé composé with être.',
    exp: '"Aller" verb sathe "être" vaperay chhe past tense ma.',
    userRight: 'Merci beaucoup, AURA!',
    perfect: 'Très bien! Your French is improving fast.',
    input: 'How do I say "I went to the cinema"?',
    voiceLines: [
      'Bonjour! Comment s\'est passé ton week-end?',
      'Très bien!',
      'You used passé composé correctly.',
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
    input: 'How do I like" in Japanese?',
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

// ── HERO VOICE ──
const heroVoiceBtn = document.getElementById('heroVoiceBtn');
const heroVoiceWave = document.getElementById('heroVoiceWave');
const heroVoiceBtnText = document.getElementById('heroVoiceBtnText');
const heroPlayRing = document.getElementById('heroPlayRing');
let voiceSpeaking = false;

const VOICE_SCRIPT = {
  German: "Guten Morgen! Wie war dein Wochenende? ... Almost! One small fix. In German, the verb always goes to the end. Ich bin ins Kino gegangen — that is correct! Perfekt. Das war wirklich gut.",
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
  const allVoices = speechSynthesis.getVoices();
  const langCode = heroLang === 'German' ? 'de' : heroLang === 'French' ? 'fr' : 'ja';
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

// ── CTA BUTTONS — check auth before navigating ──
// "Start for free" and "Try free" / "nav-cta" go to auth if not signed in,
// or straight to dashboard if already signed in.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/constants.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Update "Log in" link in nav based on auth state
supabase.auth.onAuthStateChange((event, session) => {
  const loginEl = document.querySelector('.nav-login');
  if (!loginEl) return;
  if (session?.user) {
    loginEl.textContent = 'Dashboard';
    loginEl.style.cursor = 'pointer';
    loginEl.style.color = 'var(--text)';
    loginEl.addEventListener('click', () => {
      window.location.href = '/#aura';
    });
  } else {
    loginEl.textContent = 'Log in';
    loginEl.style.cursor = 'pointer';
    loginEl.addEventListener('click', () => {
      window.location.href = '/';
    });
  }
});

async function handleCtaClick() {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;

  if (!user) {
    window.location.href = '/src/app/screens/auth.html';
    return;
  }

  // Signed in — check onboarding status in Supabase
  try {
    const { data: row } = await supabase
      .from('users')
      .select('extra_data')
      .eq('id', user.id)
      .single();

    if (row?.extra_data?.onboardingComplete) {
      window.location.href = '/src/app/screens/app-screens.html';
    } else {
      window.location.href = '/src/app/screens/onboarding.html';
    }
  } catch {
    window.location.href = '/src/app/screens/app-screens.html';
  }
}

document.querySelectorAll('.btn-primary, .nav-cta, .cta-big').forEach(btn => {
  btn.addEventListener('click', handleCtaClick);
});
