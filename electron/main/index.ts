import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window";
import { configureUpdater } from "./updater";
import { runtime } from "../backend/runtime";
import {
  emitDeepLink,
  emitOAuthCallback,
  isDeepLinkUrl,
  isOAuthCallbackUrl,
} from "./oauth-callback";

app.setName("code-review.app");

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient("code-review.app", process.execPath, [process.argv[1]]);
} else {
  app.setAsDefaultProtocolClient("code-review.app");
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
}

function currentWindow() {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

function handlePotentialRuduUrl(url: string) {
  const window = currentWindow();
  return emitOAuthCallback(url, window) || emitDeepLink(url, window);
}

app.on("open-url", (event, url) => {
  console.log(url);
  if (isOAuthCallbackUrl(url) || isDeepLinkUrl(url)) {
    event.preventDefault();
    handlePotentialRuduUrl(url);
  }
});

app.on("second-instance", (_event, argv) => {
  for (const item of argv) {
    if (handlePotentialRuduUrl(item)) {
      return;
    }
  }

  const window = currentWindow();
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

function handleStartupProtocolUrls() {
  for (const item of process.argv) {
    handlePotentialRuduUrl(item);
  }
}

app.whenReady().then(async () => {
  configureUpdater();
  await createMainWindow();
  handleStartupProtocolUrls();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void runtime.dispose();
});
