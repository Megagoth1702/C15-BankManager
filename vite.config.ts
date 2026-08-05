import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

/** C15 playground target for the `/c15-api` dev proxy (Live mode HTTP + optional WS). */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const c15Host = env.C15_HOST || '192.168.8.2';
  const c15Port = env.C15_PORT || '8080';
  const c15Target = `http://${c15Host}:${c15Port}`;
  // Pages: /C15-OfflinePresetManager/  · Local pack: ./  (set VITE_BASE)
  const base = env.VITE_BASE || process.env.VITE_BASE || '/C15-OfflinePresetManager/';

  return {
    base,
    plugins: [tailwindcss(), svelte()],
    server: {
      proxy: {
        // Same-origin bridge so browser Live can call playground without CORS.
        // Example: ws://localhost:5173/c15-api/ws/{id} → ws://192.168.8.2:8080/ws/{id}
        '/c15-api': {
          target: c15Target,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/c15-api/, ''),
        },
      },
    },
    preview: {
      proxy: {
        '/c15-api': {
          target: c15Target,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/c15-api/, ''),
        },
      },
    },
  };
});