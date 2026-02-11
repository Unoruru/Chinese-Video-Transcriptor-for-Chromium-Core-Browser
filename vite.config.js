import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { crx } from '@crxjs/vite-plugin';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import manifest from './manifest.json' with { type: 'json' };

function offscreenDevPlugin() {
  return {
    name: 'offscreen-dev',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const port = server.config.server.port || 5173;
        const outDir = resolve(server.config.root, server.config.build.outDir || 'dist');
        const dir = resolve(outDir, 'src', 'offscreen');
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, 'offscreen.html'), [
          '<!DOCTYPE html>',
          '<html>',
          '<head><meta charset="UTF-8"></head>',
          '<body>',
          `<script type="module" src="http://localhost:${port}/@vite/client"><\/script>`,
          `<script type="module" src="http://localhost:${port}/src/offscreen/offscreen.js"><\/script>`,
          '</body>',
          '</html>',
        ].join('\n'));
      });
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      'onnxruntime-web': resolve('node_modules/onnxruntime-web/dist/ort.all.min.mjs'),
    },
  },
  plugins: [
    crx({ manifest }),
    offscreenDevPlugin(),
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
