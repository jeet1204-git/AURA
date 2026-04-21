const path = window.location.pathname;
const hash = window.location.hash || '';

const shouldLoadApp =
  path.includes('/app/screens') ||
  hash.includes('#aura') ||
  hash.includes('access_token=') ||
  hash.includes('refresh_token=') ||
  hash.includes('token_type=');

if (shouldLoadApp) {
  import('./modules/ui.js');
} else {
  import('./modules/landing.js');
}
