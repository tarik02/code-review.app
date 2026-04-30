import babel from '@rolldown/plugin-babel';
import { defineConfig } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const repoRoot = resolve('../..');

const workspaceAliases = {
  '@code-review-app/backend/router': resolve(repoRoot, 'packages/backend/src/router.ts'),
  '@code-review-app/backend': resolve(repoRoot, 'packages/backend/src/index.ts'),
  '@code-review-app/shared': resolve(repoRoot, 'packages/shared/src/index.ts'),
};
const workspacePackages = ['@code-review-app/backend', '@code-review-app/shared'];
const bundledMainPackages = [...workspacePackages, 'effect', '@libsql/client'];
const nativeExternalPackages = ['libsql'];
const reactCompilerBabelPlugin = await babel({
  presets: [reactCompilerPreset()],
});

export default defineConfig({
  main: {
    resolve: {
      alias: workspaceAliases,
    },
    ssr: {
      noExternal: bundledMainPackages,
    },
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        external: nativeExternalPackages,
        input: resolve('src/main/index.ts'),
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        input: resolve('src/preload/index.ts'),
        output: {
          entryFileNames: '[name].mjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(repoRoot, 'packages/frontend'),
    plugins: [
      tanstackRouter({
        target: 'react',
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
        quoteStyle: 'single',
        autoCodeSplitting: false,
      }),
      react(),
      reactCompilerBabelPlugin,
      ...tailwindcss(),
    ],
    resolve: {
      alias: {
        ...workspaceAliases,
        '@': resolve(repoRoot, 'packages/frontend/src'),
      },
    },
    ssr: {
      noExternal: workspacePackages,
    },
    build: {
      target: 'chrome120',
      rolldownOptions: {
        input: resolve(repoRoot, 'packages/frontend/index.html'),
      },
    },
    worker: {
      format: 'es',
    },
  },
});
