import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const repoRoot = resolve("../..");
const workspaceAliases = {
  "@rudu/backend/router": resolve(repoRoot, "packages/backend/src/router.ts"),
  "@rudu/backend": resolve(repoRoot, "packages/backend/src/index.ts"),
  "@rudu/shared": resolve(repoRoot, "packages/shared/src/index.ts"),
};
const workspacePackages = ["@rudu/backend", "@rudu/shared"];
const nativeExternalPackages = [
  "@libsql/client",
  "@libsql/client/sqlite3",
  "libsql",
];
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
        external: [
          ...nativeExternalPackages,
          /^@libsql\/.+/,
        ],
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
    plugins: [react(), tailwindcss()],
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
