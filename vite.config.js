import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function injectHtmlFragments() {
  return {
    name: 'inject-html-fragments',
    transformIndexHtml(html) {
      return html.replace(/<!--\s*inject:\s*([^\s]+)\s*-->/g, (match, filePath) => {
        try {
          return readFileSync(resolve(__dirname, filePath), 'utf-8');
        } catch (e) {
          console.warn(`[inject-html-fragments] Could not read ${filePath}:`, e.message);
          return `<!-- missing: ${filePath} -->`;
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [injectHtmlFragments()],
  optimizeDeps: {
    exclude: ['firebase/app', 'firebase/auth']
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dashboard: resolve(__dirname, 'src/app/screens/app-screens.html')
        auth: resolve(__dirname, 'src/app/screens/auth.html')
      }
    }
  }
});
