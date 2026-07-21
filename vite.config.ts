import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/C15-OfflinePresetManagerTest/',
  plugins: [tailwindcss(), svelte()],
});