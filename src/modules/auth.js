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
    loginTab?.classList.remove('active');
    signupTab?.classList.add('active');
    if (loginForm) loginForm.style.display = 'none';
    if (signupForm) signupForm.style.display = 'flex';
  } else {
    signupTab?.classList.remove('active');
    loginTab?.classList.add('active');
    if (signupForm) signupForm.style.display = 'none';
    if (loginForm) loginForm.style.display = 'flex';
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

  if (!email || !pass) {
    showAuthError('Please enter email and password.');
    return;
  }

  const btn = document.getElementById('auth-login-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Signing in...';
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });

  if (error) {
    const msg = error.message.toLowerCase().includes('invalid')
      ? 'Invalid credentials. Check your email and password.'
      : error.message || 'Sign in failed.';
    showAuthError(msg);
  } else {
    window.location.replace('https://auraspeak.in/#aura');
    return;
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

// ── Email signup ──────────────────────────────────────────────────────────────

export async function doEmailSignup() {
  const email = document.getElementById('auth-signup-email')?.value?.trim();
  const pass  = document.getElementById('auth-signup-password')?.value;

  if (!email || !pass) {
    showAuthError('Please enter email and password.');
    return;
  }

  if (pass.length < 6) {
    showAuthError('Password must be at least 6 characters.');
    return;
  }

  const btn = document.getElementById('auth-signup-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Creating account...';
  }

  const { error } = await supabase.auth.signUp({ email, password: pass });

  if (error) {
    const msg = error.message.toLowerCase().includes('already')
      ? 'Account exists. Sign in instead.'
      : error.message || 'Signup failed.';
    showAuthError(msg);
  } else {
    showAuthError('Check your email for a confirmation link!');
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
}

// ── Google login ──────────────────────────────────────────────────────────────

export async function doGoogleLogin() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: 'https://auraspeak.in/',
    },
  });

  if (error) {
    showAuthError(error.message || 'Google sign-in failed.');
  }
}

// ── Hash-based routing + OAuth callback handling ─────────────────────────────

export async function handleHashChange() {
  const h = window.location.hash || '';

  const isOAuthCallback =
    h.includes('access_token=') ||
    h.includes('refresh_token=') ||
    h.includes('token_type=');

  if (isOAuthCallback) {
    // Give Supabase a chance to parse/store the session from the URL
    const { data } = await supabase.auth.getSession();

    if (data?.session) {
      // Important: leave the auth page completely and go to the real app entry
      window.location.replace('https://auraspeak.in/#aura');
      return;
    }
  }

  const isApp = h === '#aura' || h.startsWith('#aura');
  document.documentElement.setAttribute('data-route', isApp ? 'app' : 'landing');

  if (isApp) {
    document.body.style.background = 'var(--app-bg)';

    const { data } = await supabase.auth.getSession();

    if (!data?.session) {
      const authScreen = document.getElementById('auth-screen');
      const checking   = document.getElementById('auth-checking');
      const formWrap   = document.getElementById('auth-form-wrap');

      if (authScreen) authScreen.classList.add('active');
      if (checking) checking.style.display = 'none';
      if (formWrap) formWrap.style.display = '';
    } else {
      const authScreen = document.getElementById('auth-screen');
      if (authScreen) authScreen.classList.remove('active');
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
      e.preventDefault();
      doEmailLogin();
    }

    if (active.id === 'auth-signup-email' || active.id === 'auth-signup-password') {
      e.preventDefault();
      doEmailSignup();
    }
  });
}

// ── Keep auth state synced and leave auth page when signed in ────────────────

supabase.auth.onAuthStateChange((_event, session) => {
  if (session && window.location.hash !== '#aura') {
    window.location.replace('https://auraspeak.in/#aura');
  }
});

// ── Expose to window for inline HTML onclick handlers ────────────────────────

window.switchAuthTab = switchAuthTab;
window.doEmailLogin = doEmailLogin;
window.doEmailSignup = doEmailSignup;
window.doGoogleLogin = doGoogleLogin;

// ── getIdToken — returns the current Supabase access_token ───────────────────

export async function getIdToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}
