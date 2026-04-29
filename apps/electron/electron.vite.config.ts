import babel from "@rolldown/plugin-babel";
import { defineConfig } from "electron-vite";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { resolve } from "node:path";

const repoRoot = resolve("../..");

const workspaceAliases = {
  "@code-review-app/backend/router": resolve(repoRoot, "packages/backend/src/router.ts"),
  "@code-review-app/backend": resolve(repoRoot, "packages/backend/src/index.ts"),
  "@code-review-app/shared": resolve(repoRoot, "packages/shared/src/index.ts"),
};
const workspacePackages = ["@code-review-app/backend", "@code-review-app/shared"];
const nativeExternalPackages = ["@libsql/client", "@libsql/client/sqlite3", "libsql"];
const reactCompilerBabelPlugin = await babel({
  presets: [reactCompilerPreset()],
});

export default defineConfig({
  main: {
    resolve: {
      alias: workspaceAliases,
    },
    ssr: {
      noExternal: workspacePackages,
    },
    build: {
      externalizeDeps: {
        exclude: workspacePackages,
      },
      rolldownOptions: {
        external: [...nativeExternalPackages, /^@libsql\/.+/],
        input: resolve("src/main/index.ts"),
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        input: resolve("src/preload/index.ts"),
        output: {
          entryFileNames: "[name].mjs",
        },
      },
    },
  },
  renderer: {
    root: resolve(repoRoot, "packages/frontend"),
    plugins: [react(), reactCompilerBabelPlugin, ...tailwindcss()],
    resolve: {
      alias: {
        ...workspaceAliases,
        "@": resolve(repoRoot, "packages/frontend/src"),
      },
    },
    ssr: {
      noExternal: workspacePackages,
    },
    build: {
      target: "chrome120",
      rolldownOptions: {
        input: resolve(repoRoot, "packages/frontend/index.html"),
      },
    },
    worker: {
      format: "es",
    },
  },
});
