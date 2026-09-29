import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

/**
 * React Fast Refresh injects an inline script in development only. Allow it
 * there; production builds keep the strict script-src 'self' policy.
 */
function devInlineScripts(): Plugin {
  return {
    name: 'drashti-dev-inline-scripts',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
  };
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The import worker is its own bundle, started as a utility process (src/main/import/worker.ts).
        input: { index: resolve('src/main/index.ts'), 'import-worker': resolve('src/main/import/worker.ts') },
        onwarn(warning, warn) {
          // zod's comments confuse Rollup's annotation parser; harmless, so keep the build output readable.
          if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('node_modules/zod')) return;
          warn(warning);
        },
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads must be a single CommonJS file.
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react(), tailwindcss(), devInlineScripts()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          output: resolve('src/renderer/output.html'),
          audio: resolve('src/renderer/audio.html'),
        },
      },
    },
  },
});
