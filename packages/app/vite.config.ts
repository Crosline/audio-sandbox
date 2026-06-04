import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

/**
 * GitHub Pages serves a 404.html for unknown paths. For a single-page app we copy
 * index.html -> 404.html so deep links / refreshes resolve to the app instead of a
 * GitHub 404 page. Runs after the bundle is written.
 */
function spaFallback(): Plugin {
  return {
    name: 'spa-404-fallback',
    apply: 'build',
    closeBundle() {
      const dist = resolve(import.meta.dirname, 'dist');
      const index = resolve(dist, 'index.html');
      if (existsSync(index)) copyFileSync(index, resolve(dist, '404.html'));
    },
  };
}

// GitHub Project Pages: served at https://crosline.github.io/audio-sandbox/
// The production base path MUST match the repo name (audio-sandbox), or assets 404.
// In dev, base is '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/audio-sandbox/' : '/',
  plugins: [svelte(), tailwindcss(), spaFallback()],
}));
