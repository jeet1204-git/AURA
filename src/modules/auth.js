/**
 * auth.js — AURA Auth layer (Supabase edition)
 * Drop-in replacement for the Firebase auth module.
 * Keeps the same exported function signatures so other modules need minimal changes.
 *
 * Replaces:
 *   firebase-app.js  initializeApp / getApp
 *   firebase-auth.js getAuth / signInWithEmailAndPassword / createUserWithEmailAndPassword
 *                    signInWithPopup / GoogleAuthProvider / getIdToken / onAuthStateChanged
 */
import { supabase } from './supabase-client.js';

// Re-export supabase so other modules (ui.js) can import it from here
export { supabase };

// ── Auth tab switching ────────────────────────────────────────────────────────

export function switchAuthTab(tab) {
  const loginTab   = document.getElementById('auth-tab-login');
  const signupTab  = document.getElementById('auth-tab-signup');
  const loginForm  = document.getElementById('auth-form-login');
  const signupForm = document.getElementById('auth-form-signup');
  const errEl      = document.getElementById('auth-error');

  if (errEl) errEl.textContent = '';

  if (tab === 'signup') {
    loginTab.classList.remove('active');
    signupTab.classList.add('active');
    loginForm.style.display  = 'none';
    signupForm.style.display = 'flex';
  } else {
    signupTab.classList.remove('active');
    loginTab.classList.add('active');
    signupForm.style.display = 'none';
    loginForm.style.display  = 'flex';
  }
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) el.textContent = msg;
}

// ── Email login ───────────────────────────────────────────────────────────────

export async function doEmailLogin() {
  const email = document.getElementById('auth-email')?.value?.trim();
  const pass  = document.getElementById('auth-password')?.value;

  if (!email || !pass) { showAuthError('Please enter email and password.'); return; }

  const btn = document.getElementById('auth-login-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }

  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });

  if (error) {
    const msg = error.message.toLowerCase().includes('invalid')
      ? 'Invalid credentials. Check your email and password.'
      : error.message || 'Sign in failed.';
    showAuthError(msg);
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
}

// ── Email signup ──────────────────────────────────────────────────────────────

export async function doEmailSignup() {
  const email = document.getElementById('auth-signup-email')?.value?.trim();
  const pass  = document.getElementById('auth-signup-password')?.value;

  if (!email || !pass) { showAuthError('Please enter email and password.'); return; }
  if (pass.length < 6) { showAuthError('Password must be at least 6 characters.'); return; }

  const btn = document.getElementById('auth-signup-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating account...'; }

  const { error } = await supabase.auth.signUp({ email, password: pass });

  if (error) {
    const msg = error.message.toLowerCase().includes('already')
      ? 'Account exists. Sign in instead.'
      : error.message || 'Signup failed.';
    showAuthError(msg);
  } else {
    showAuthError('Check your email for a confirmation link!');
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Create account'; }
}

// ── Google login ──────────────────────────────────────────────────────────────

export async function doGoogleLogin() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // After Google auth, redirect back to the app dashboard
      redirectTo: window.location.origin + '/#aura',
    },
  });

  if (error) {
    showAuthError(error.message || 'Google sign-in failed.');
  }
  // On success Supabase redirects the browser — no further action needed here.
}

// ── Hash-based routing ────────────────────────────────────────────────────────

export async function handleHashChange() {
  const h    = window.location.hash;
  const isApp = h === '#aura' || (h.indexOf('#aura') === 0 && h.length === 5);
  document.documentElement.setAttribute('data-route', isApp ? 'app' : 'landing');

  if (isApp) {
    document.body.style.background = 'var(--app-bg)';
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const authScreen = document.getElementById('auth-screen');
      const checking   = document.getElementById('auth-checking');
      const formWrap   = document.getElementById('auth-form-wrap');
      if (authScreen) authScreen.classList.add('active');
      if (checking)   checking.style.display = 'none';
      if (formWrap)   formWrap.style.display  = '';
    }
  } else {
    document.body.style.background = 'var(--white)';
  }
}

// ── Enter key support ─────────────────────────────────────────────────────────

export function initAuthKeyListeners() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const active = document.activeElement;
    if (!active) return;

    if (active.id === 'auth-email' || active.id === 'auth-password') {
      e.preventDefault(); doEmailLogin();
    }
    if (active.id === 'auth-signup-email' || active.id === 'auth-signup-password') {
      e.preventDefault(); doEmailSignup();
    }
  });
}

// ── Expose to window for inline HTML onclick handlers ────────────────────────
window.switchAuthTab  = switchAuthTab;
window.doEmailLogin   = doEmailLogin;
window.doEmailSignup  = doEmailSignup;
window.doGoogleLogin  = doGoogleLogin;

// ── getIdToken — returns the current Supabase access_token ───────────────────
// Same usage as Firebase's getIdToken(user).
export async function getIdToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}
