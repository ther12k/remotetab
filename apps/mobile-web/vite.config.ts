/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'RemoteTab',
        short_name: 'RemoteTab',
        description: 'View and control one Chrome tab on your laptop.',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b0f14',
        theme_color: '#0b0f14',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
});
