import { FIREBASE_CONFIG } from '../config/constants.js';

const PAGES = ['home', 'features', 'why', 'mocktest'];

function navigateTo(page, scrollToId, opts = {}) {
  const skipHistory = opts?.skipHistory === true;
  if (!PAGES.includes(page)) page = 'home';

  // Hide all pages
  PAGES.forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) { el.classList.remove('active'); }
  });

  // Show target page
  const target = document.getElementById('page-' + page);
  if (target) { target.classList.add('active'); }

  // Update URL — use proper path-style for landing pages to avoid confusing route guard
  // Never use #aura for landing pages, and never use landing page hashes in app mode
  const hashVal = scrollToId || page;
  if (!skipHistory) {
    if (hashVal === 'home' || hashVal === '') {
      history.pushState({ page, scrollToId }, '', window.location.pathname);
    } else {
      history.pushState({ page, scrollToId }, '', '#' + hashVal);
    }
  }

  // Scroll — to section or top
  if (scrollToId) {
    requestAnimationFrame(() => {
      const el = document.getElementById(scrollToId);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      else window.scrollTo(0, 0);
    });
  } else {
    window.scrollTo(0, 0);
  }

  // Re-init flower logos on the newly visible page
  target?.querySelectorAll('svg.flower-logo:not(.inited)').forEach(svg => {
    initFlowerLogo(svg); svg.classList.add('inited');
  });

  // Re-trigger scroll reveal for newly visible .rv elements
  target?.querySelectorAll('.rv:not(.vis)').forEach(el => io?.observe(el));
}

// Handle browser back/forward — merged with AURA session back-nav
window.addEventListener('popstate', (e) => {
  // If inside an active AURA session, let AURA handle it (original logic below)
  const speakingInterface = document.getElementById('speaking-interface');
  if (speakingInterface && speakingInterface.style.display !== 'none') return;
  // Otherwise handle page routing
  const page = e.state?.page || 'home';
  if (PAGES.includes(page)) navigateTo(page, e.state?.scrollToId, { skipHistory: true });
});

// On initial load — respect hash if present.
// Deferred to end of script so initFlowerLogo + io are defined first.
// Only intercepts page-level hashes (features, why) — leaves
// section anchors like #pricing, #how-it-works untouched.
window.addEventListener('DOMContentLoaded', () => {
  const hash = location.hash.replace('#','');
  if (PAGES.includes(hash) && hash !== 'home') navigateTo(hash);
});

/* Why page waitlist — separate ID so it doesn't clash with homepage waitlist */

function makeFlowerPath(cx, cy, outerR, innerR, petals) {
  const step = (2 * Math.PI) / petals;
  const pts = [];
  for (let i = 0; i < petals; i++) {
    const oa = i * step - Math.PI / 2;
    const ia = oa + step / 2;
    pts.push({
      o: [cx + outerR * Math.cos(oa), cy + outerR * Math.sin(oa)],
      v: [cx + innerR * Math.cos(ia), cy + innerR * Math.sin(ia)]
    });
  }
  const s = pts[petals - 1].v;
  let d = `M${s[0].toFixed(2)},${s[1].toFixed(2)}`;
  for (const p of pts) {
    d += ` Q${p.o[0].toFixed(2)},${p.o[1].toFixed(2)} ${p.v[0].toFixed(2)},${p.v[1].toFixed(2)}`;
  }
  return d + 'Z';
}

const RINGS = [
  { petals: 8, orF: 0.94, irF: 0.68 },
  { petals: 7, orF: 0.78, irF: 0.56 },
  { petals: 6, orF: 0.63, irF: 0.44 },
  { petals: 5, orF: 0.48, irF: 0.32 },
  { petals: 4, orF: 0.33, irF: 0.20 }
];

function initFlowerLogo(svg) {
  const vb = svg.viewBox.baseVal;
  const cx = vb.width / 2, cy = vb.height / 2;
  const maxR = Math.min(vb.width, vb.height) / 2;
  const paths = svg.querySelectorAll('path.logo-ring');
  paths.forEach((path, i) => {
    if (i < RINGS.length) {
      const r = RINGS[i];
      path.setAttribute('d', makeFlowerPath(cx, cy, maxR * r.orF, maxR * r.irF, r.petals));
    }
  });
  const dot = svg.querySelector('.center-dot');
  if (dot) {
    const r = maxR * 0.12;
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    dot.setAttribute('r', r.toFixed(2));
  }
}

document.querySelectorAll('svg.flower-logo').forEach(svg => { initFlowerLogo(svg); svg.classList.add('inited'); });

/* ==========
   SCROLL REVEAL
========== */

// Enable scroll animations only when JS is running
document.body.classList.add('js-ready');

const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vis'); io.unobserve(e.target); } });
}, { threshold: 0.01, rootMargin: '0px 0px -60px 0px' });
document.querySelectorAll('.rv').forEach(el => io.observe(el));

// Safety: force-reveal any .rv still hidden after 2s (catches edge cases)
setTimeout(() => {
  document.querySelectorAll('.rv:not(.vis)').forEach(el => el.classList.add('vis'));
}, 2000);

// Safety: ensure hero elements (CSS-animated) are always visible
// In case CSS animations don't fire (reduced motion, old browser, etc.)
setTimeout(() => {
  const heroEls = document.querySelectorAll('.hero-eyebrow,.hero-title,.hero-sub,.hero-actions,.hero-visual');
  heroEls.forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
}, 1500);

/* ==========
   CHAPTER NAV ACTIVE STATE
========== */
const chapLinks = document.querySelectorAll('.chapnav-inner a');
const sections  = document.querySelectorAll('section[id], div[id]');

const chapIO = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      const id = e.target.id;
      chapLinks.forEach(a => {
        a.classList.toggle('active', a.getAttribute('href') === '#' + id);
      });
    }
  });
}, { rootMargin: '-40% 0px -55% 0px' });
sections.forEach(s => chapIO.observe(s));


/* ==========
   SCENARIOS TAB SWITCHER
========== */
const scData = {
  restaurant: {
    emoji: '🍽️',
    title: 'Beim Restaurant',
    sub: 'Ordering food, asking questions, paying the bill',
    sample: '"Entschuldigung, haben Sie noch einen Tisch frei? Wir sind zu dritt."',
    tr: "Excuse me, do you still have a free table? We're a party of three."
  },
  job: {
    emoji: '💼',
    title: 'Das Vorstellungsgespräch',
    sub: 'Introducing yourself, answering tricky questions, asking about the role',
    sample: '"Ich habe fünf Jahre Erfahrung im Bereich Softwareentwicklung und möchte gerne mehr über die Teamstruktur erfahren."',
    tr: "I have five years of experience in software development and I'd like to learn more about the team structure."
  },
  doctor: {
    emoji: '🏥',
    title: 'Beim Arzt',
    sub: 'Describing symptoms, understanding medical advice, scheduling follow-ups',
    sample: '"Ich habe seit drei Tagen starke Kopfschmerzen und bin sehr müde. Ich mache mir ein bisschen Sorgen."',
    tr: "I've had a bad headache for three days and I'm very tired. I'm a bit worried."
  },
  travel: {
    emoji: '🚂',
    title: 'Unterwegs in Deutschland',
    sub: 'Buying tickets, asking for directions, dealing with delays',
    sample: '"Entschuldigung, fährt dieser Zug nach München? Ich habe ein Ticket für den ICE um 14 Uhr."',
    tr: 'Excuse me, does this train go to Munich? I have a ticket for the 2pm ICE.'
  },
  smalltalk: {
    emoji: '☕',
    title: 'Smalltalk auf Deutsch',
    sub: 'Weather, weekend plans, work — the glue of German social life',
    sample: '"Na, wie war dein Wochenende? Wir waren wandern — das Wetter war endlich mal schön!"',
    tr: 'So, how was your weekend? We went hiking — the weather was finally nice!'
  }
};

document.querySelectorAll('.sc-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.sc-chip').forEach(c => c.classList.remove('sel'));
    chip.classList.add('sel');
    const key = chip.dataset.sc;
    const d = scData[key];
    document.querySelector('.sc-title-el').textContent = d.title;
    document.querySelector('.sc-sub-el').textContent = d.sub;
    document.querySelector('.sc-sample-el').textContent = '"' + d.sample.replace(/^"|"$/g,'') + '"';
    document.querySelector('.sc-tr-el').textContent = d.tr;
    document.querySelector('.sc-emoji-el').textContent = d.emoji;
  });
});

/* ==========
   PRICING TOGGLE
========== */
const billingToggle = document.getElementById('billingToggle');
const priceDisplay = document.getElementById('priceDisplay');
const priceDesc    = document.getElementById('priceDesc');
let annual = false;

if (billingToggle) {
  billingToggle.addEventListener('click', () => {
    annual = !annual;
    billingToggle.classList.toggle('annual', annual);
    if (annual) {
      if(priceDisplay) priceDisplay.innerHTML = '<sup>€</sup>8<sub>/mo</sub>';
      if(priceDesc) priceDesc.textContent = 'Billed €96/year · cancel anytime';
    } else {
      if(priceDisplay) priceDisplay.innerHTML = '<sup>€</sup>14<sub>/mo</sub>';
      if(priceDesc) priceDesc.textContent = 'Billed monthly · cancel anytime';
    }
  });
}

/* ==========
   WAITLIST
========== */

async function submitWaitlistEmail(email, { source = 'homepage', buttonEl = null, inputEl = null } = {}) {
  const normalizedEmail = (email || '').trim();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    if (inputEl) {
      inputEl.style.borderColor = '#ff3b30';
      setTimeout(() => { inputEl.style.borderColor = ''; }, 1500);
    }
    return;
  }

  if (buttonEl) {
    buttonEl.textContent = 'Saving…';
    buttonEl.disabled = true;
  }
  if (inputEl) inputEl.disabled = true;

  try {
    // Save to Firestore — waitlist collection
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const { getFirestore, collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    const firebaseConfig = {
      apiKey: 'AIzaSyDx2fBrlxNP_zs0xra8ccXyCHQtnHud30E',
      authDomain: 'german-made-easy.firebaseapp.com',
      projectId: 'german-made-easy',
      storageBucket: 'german-made-easy.firebasestorage.app',
      messagingSenderId: '259276936055',
      appId: '1:259276936055:web:5c9b4916734d0271100772'
    };

    const app = getApps().find(a => a.name === 'waitlist-app') || initializeApp(firebaseConfig, 'waitlist-app');
    const db = getFirestore(app);

    // Add to waitlist collection (duplicates handled server-side)
    await addDoc(collection(db, 'waitlist'), {
      email: normalizedEmail,
      joinedAt: serverTimestamp(),
      source,
      notified: false
    });

    // Send welcome email via EmailJS
    const EMAILJS_SERVICE_ID  = 'service_60lktxn';
    const EMAILJS_TEMPLATE_ID = 'template_nans6js';
    const EMAILJS_PUBLIC_KEY  = 'r6h3oM8LZD3wNWy1N';

    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: normalizedEmail,
      to_name: normalizedEmail.split('@')[0],
      reply_to: 'jeetupadhyaypersonal@gmail.com'
    }, EMAILJS_PUBLIC_KEY);

    if (buttonEl) {
      buttonEl.textContent = "✓ You're on the list!";
      buttonEl.style.background = '#16a34a';
    }

  } catch(err) {
    console.error('Waitlist error:', err);
    if (buttonEl) {
      buttonEl.textContent = 'Try again';
      buttonEl.disabled = false;
      buttonEl.style.background = '';
    }
    if (inputEl) inputEl.disabled = false;
  }
}

async function joinWaitlist() {
  const emailInput = document.getElementById('waitlist-email');
  if (!emailInput) return;
  const btn = emailInput.closest('.waitlist-form')?.querySelector('.waitlist-btn') || null;
  const email = emailInput?.value?.trim() || '';
  await submitWaitlistEmail(email, { source: 'homepage', buttonEl: btn, inputEl: emailInput });
}

/* ==========
   DEMO HINT HELPER
========== */
function insertHint(text) {
  const input = document.getElementById('demo-input');
  if (input) { input.value = text; input.focus(); }
}

/* ==========
   LIVE AI DEMO

// ── Window bindings ───────────────────────────────────────────────────────────
window.scrollToSection = (id) => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); };
window.navigateTo      = navigateTo;
window.joinWaitlist    = joinWaitlist;
window.joinWaitlistWhy = joinWaitlistWhy;

// ── Init on load ──────────────────────────────────────────────────────────────
export function initLanding() {
  document.querySelectorAll('svg.flower-logo').forEach(svg => { initFlowerLogo(svg); svg.classList.add('inited'); });
  initScrollReveal();
  initChapterNav();
  initPricing();
  initScenarioChips();
  navigateTo(window.location.hash.replace('#','') || 'home', null, { replace: true });
  window.addEventListener('popstate', () => navigateTo(window.location.hash.replace('#','') || 'home', null, { replace: true }));
}

export { navigateTo };
