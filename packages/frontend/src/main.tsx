import React from "react";
import ReactDOM from "react-dom/client";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@mdxeditor/editor/style.css";
import Prism from "prismjs";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/geist-mono/700.css";
import App from "./App";
import "./index.css";
import PierreDiffsWorker from "@pierre/diffs/worker/worker-portable.js?worker";
import { isElectron, syncDocumentPlatformClass } from "./lib/platform";
import { syncDocumentWindowControlsOverlayClass } from "./lib/wco";
import { syncDocumentWindowFullscreenClass } from "./lib/window-fullscreen";

// Lexical's Prism integration expects a global Prism object at runtime.
if (typeof window !== "undefined") {
  (window as Window & { Prism?: typeof Prism }).Prism = Prism;
}

syncDocumentPlatformClass();

if (isElectron) {
  syncDocumentWindowControlsOverlayClass();
  syncDocumentWindowFullscreenClass();
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

const poolSize = Math.max(2, Math.min(4, Math.floor(navigator.hardwareConcurrency / 2) || 2));
const initialDiffTheme = document.documentElement.classList.contains("dark")
  ? "pierre-dark"
  : "pierre-light";

function createPierreDiffsWorker() {
  return new PierreDiffsWorker();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <WorkerPoolContextProvider
        highlighterOptions={{
          lineDiffType: "word",
          preferredHighlighter: "shiki-js",
          theme: initialDiffTheme,
        }}
        poolOptions={{
          poolSize,
          workerFactory: createPierreDiffsWorker,
        }}
      >
        <App />
      </WorkerPoolContextProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
