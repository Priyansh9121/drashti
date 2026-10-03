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
        // The workers are bundles of their own, started as utility processes.
        input: {
          index: resolve('src/main/index.ts'),
          'import-worker': resolve('src/main/import/worker.ts'),
          // The stream worker: encoding, sending and recording (src/main/stream/worker/worker.ts).
          'stream-worker': resolve('src/main/stream/worker/worker.ts'),
          // The network worker: the HTTP and WebSocket server for paired devices (src/main/network/worker/worker.ts).
          'network-worker': resolve('src/main/network/worker/worker.ts'),
        },
        // ws's optional native helpers are not installed. Left as plain requires, they fail and ws uses its
        // own JavaScript; bundled, Vite would put an empty object in their place and ws would call
        // functions that are not there on every frame of 32 bytes or more.
        external: ['bufferutil', 'utf-8-validate'],
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
      // The network's pages run in phones' browsers too: Safari 16.4 on an iPhone is the oldest
      // (Tailwind's styles need it), so the code is built for that as well as Electron's Chromium.
      target: ['chrome140', 'safari16', 'firefox128'],
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          output: resolve('src/renderer/output.html'),
          audio: resolve('src/renderer/audio.html'),
          // The stream's Program, drawn off screen (src/main/stream/program-window.ts).
          stream: resolve('src/renderer/stream.html'),
          // The component gallery, for development (Diagnostics > Component Gallery).
          gallery: resolve('src/renderer/gallery.html'),
          // Pages for phones, tablets and browsers on the local network (src/main/network/web-files.ts).
          pair: resolve('src/renderer/pair.html'),
          remote: resolve('src/renderer/remote.html'),
        },
      },
    },
  },
});
