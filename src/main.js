const path = window.location.pathname;
if (path.includes('app-screens')) {
  import('./modules/ui.js');
} else {
  import('./modules/landing.js');
}
