import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── HTML fragment injection plugin ────────────────────────────────────────────
// Replaces <!-- inject: path/to/file.html --> comments with actual file content
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
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    }
  }
});
