import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        input: resolve("electron/main/index.ts"),
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        input: resolve("electron/preload/index.ts"),
        output: {
          entryFileNames: "[name].mjs",
        },
      },
    },
  },
  renderer: {
    root: ".",
    plugins: [react(), tailwindcss()],
    build: {
      target: "chrome120",
      rolldownOptions: {
        input: resolve("index.html"),
      },
    },
    worker: {
      format: "es",
    },
  },
});
