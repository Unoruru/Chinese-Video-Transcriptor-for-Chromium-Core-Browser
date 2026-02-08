import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { crx } from '@crxjs/vite-plugin';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  resolve: {
    alias: {
      'onnxruntime-web': resolve('node_modules/onnxruntime-web/dist/ort.all.min.mjs'),
    },
  },
  plugins: [
    crx({ manifest }),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
          dest: '.',
        },
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs',
          dest: '.',
        },
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: '.',
        },
        {
          src: 'src/content/content.js',
          dest: '.',
        },
      ],
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        offscreen: 'src/offscreen/offscreen.html',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
