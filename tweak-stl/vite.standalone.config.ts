import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

/**
 * Builds StitchMesh as a single, self-contained index.html with everything
 * (JS + CSS) inlined — no Electron, no dev server, no external requests.
 * Opening the file directly (file://) works because there is nothing left
 * for the browser to fetch: an inline <script type="module"> with no
 * external imports is exempt from Chromium's file:// module-CORS block,
 * which only applies to fetching *additional* module files.
 */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist-standalone',
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    chunkSizeWarningLimit: Number.MAX_SAFE_INTEGER,
  },
});
