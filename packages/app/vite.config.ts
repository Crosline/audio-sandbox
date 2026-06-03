import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// GitHub Project Pages: served at username.github.io/audiosandbox/
// In dev, base is '/'; in production build it must match the repo path.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/audiosandbox/' : '/',
  plugins: [svelte(), tailwindcss()],
}));
