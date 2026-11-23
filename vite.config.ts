import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // `npm run dev` serves the UI; API calls go to `wrangler pages dev` on 8788
    proxy: { '/api': 'http://localhost:8788' },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
