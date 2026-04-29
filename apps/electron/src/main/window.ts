import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, BrowserWindowConstructorOptions, nativeTheme, shell } from "electron";
import type { ThemePreference } from "@code-review-app/shared";
import { registerTrpc } from "./trpc";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

function isSafeExternalUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isAllowedNavigation(url: string) {
  if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) {
    return true;
  }
  return url.startsWith("file:");
}

const TITLEBAR_HEIGHT = 40;
const TRAFFIC_LIGHT_SIZE = 12;
const TITLEBAR_COLOR = "#01000000"; // #00000000 does not work correctly on Linux
const TITLEBAR_LIGHT_SYMBOL_COLOR = "#1f2937";
const TITLEBAR_DARK_SYMBOL_COLOR = "#f8fafc";

type WindowTitleBarOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
>;

function getWindowTitleBarOptions(): WindowTitleBarOptions {
  if (process.platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: (TITLEBAR_HEIGHT - TRAFFIC_LIGHT_SIZE) / 2 },
    };
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: TITLEBAR_COLOR,
      height: TITLEBAR_HEIGHT,
      symbolColor: nativeTheme.shouldUseDarkColors
        ? TITLEBAR_DARK_SYMBOL_COLOR
        : TITLEBAR_LIGHT_SYMBOL_COLOR,
    },
  };
}

function getInitialWindowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";
}

function applyNativeThemePreference(preference: ThemePreference): void {
  nativeTheme.themeSource = preference === "auto" ? "system" : preference;
  syncAllWindowAppearance();
}

function syncWindowAppearance(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }

  window.setBackgroundColor(getInitialWindowBackgroundColor());
  const { titleBarOverlay } = getWindowTitleBarOptions();
  if (typeof titleBarOverlay === "object") {
    window.setTitleBarOverlay(titleBarOverlay);
  }
}

function syncAllWindowAppearance(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    syncWindowAppearance(window);
  }
}

nativeTheme.on("updated", syncAllWindowAppearance);

function forwardRendererConsole(window: BrowserWindow): void {
  window.webContents.on("console-message", (details) => {
    const source = details.sourceId ? ` ${details.sourceId}:${details.lineNumber}` : "";
    console.log(`[renderer:${details.level}] ${details.message}${source}`);
  });
}

async function createMainWindow() {
  const window = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 800,
    minHeight: 400,
    title: "code-review.app",
    backgroundColor: getInitialWindowBackgroundColor(),
    ...getWindowTitleBarOptions(),
    webPreferences: {
      preload: path.join(currentDirectory, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  registerTrpc(window);
  forwardRendererConsole(window);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(path.join(currentDirectory, "../renderer/index.html"));
  }

  return window;
}

export { applyNativeThemePreference, createMainWindow };
