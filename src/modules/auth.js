import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, getIdToken } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { FIREBASE_CONFIG } from '../config/constants.js';

// ── Firebase init ─────────────────────────────────────────────────────────────
export const fbApp = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
export const auth  = getAuth(fbApp);

// ── Auth tab switching ────────────────────────────────────────────────────────
export function switchAuthTab(tab) {
  const loginTab  = document.getElementById('auth-tab-login');
  const signupTab = document.getElementById('auth-tab-signup');
  const loginForm = document.getElementById('auth-form-login');
  const signupForm = document.getElementById('auth-form-signup');
  const errEl = document.getElementById('auth-error');
  if (errEl) errEl.textContent = '';

  if (tab === 'signup') {
    loginTab.classList.remove('active');
    signupTab.classList.add('active');
    loginForm.style.display = 'none';
    signupForm.style.display = 'flex';
  } else {
    signupTab.classList.remove('active');
    loginTab.classList.add('active');
    signupForm.style.display = 'none';
    loginForm.style.display = 'flex';
  }
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) el.textContent = msg;
}

// ── Email login ───────────────────────────────────────────────────────────────
export async function doEmailLogin() {
  if (!auth) return;
  const email = document.getElementById('auth-email')?.value?.trim();
  const pass  = document.getElementById('auth-password')?.value;
  if (!email || !pass) { showAuthError('Please enter email and password.'); return; }
  const btn = document.getElementById('auth-login-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    const msg = e.code === 'auth/user-not-found'      ? 'No account found. Create one below.'
      : e.code === 'auth/wrong-password'              ? 'Incorrect password.'
      : e.code === 'auth/invalid-email'               ? 'Invalid email address.'
      : e.code === 'auth/invalid-credential'          ? 'Invalid credentials. Check your email and password.'
      : e.message || 'Sign in failed.';
    showAuthError(msg);
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
}

// ── Email signup ──────────────────────────────────────────────────────────────
export async function doEmailSignup() {
  if (!auth) return;
  const email = document.getElementById('auth-signup-email')?.value?.trim();
  const pass  = document.getElementById('auth-signup-password')?.value;
  if (!email || !pass) { showAuthError('Please enter email and password.'); return; }
  if (pass.length < 6) { showAuthError('Password must be at least 6 characters.'); return; }
  const btn = document.getElementById('auth-signup-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating account...'; }
  try {
    await createUserWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    const msg = e.code === 'auth/email-already-in-use' ? 'Account exists. Sign in instead.'
      : e.code === 'auth/weak-password'                ? 'Password too weak. Use 6+ characters.'
      : e.code === 'auth/invalid-email'                ? 'Invalid email address.'
      : e.message || 'Signup failed.';
    showAuthError(msg);
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Create account'; }
}

// ── Google login ──────────────────────────────────────────────────────────────
export async function doGoogleLogin() {
  if (!auth) return;
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showAuthError(e.message || 'Google sign-in failed.');
    }
  }
}

// ── Hash-based routing ────────────────────────────────────────────────────────
export function handleHashChange() {
  const h     = window.location.hash;
  const isApp = h === '#aura' || (h.indexOf('#aura') === 0 && h.length === 5);
  document.documentElement.setAttribute('data-route', isApp ? 'app' : 'landing');
  if (isApp) {
    document.body.style.background = 'var(--app-bg)';
    if (auth && !auth.currentUser) {
      const authScreen = document.getElementById('auth-screen');
      const checking   = document.getElementById('auth-checking');
      const formWrap   = document.getElementById('auth-form-wrap');
      if (authScreen) authScreen.classList.add('active');
      if (checking)   checking.style.display = 'none';
      if (formWrap)   formWrap.style.display = '';
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

// ── Re-export getIdToken for use in other modules ────────────────────────────
export { getIdToken };
