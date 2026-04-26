import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";

const oauthCallbacks = new EventEmitter();
const pendingOAuthCallbacks: string[] = [];
const deepLinkCallbacks = new EventEmitter();
const pendingDeepLinks: string[] = [];

function isOAuthCallbackUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "code-review.app:" && parsed.hostname === "oauth" && parsed.pathname === "/callback";
  } catch {
    return false;
  }
}

function emitOAuthCallback(url: string, window: BrowserWindow | null) {
  if (!isOAuthCallbackUrl(url)) return false;
  if (oauthCallbacks.listenerCount("callback") === 0) {
    pendingOAuthCallbacks.push(url);
  }
  oauthCallbacks.emit("callback", url);
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
  return true;
}

function subscribeToOAuthCallbacks(listener: (url: string) => void) {
  oauthCallbacks.on("callback", listener);
  while (pendingOAuthCallbacks.length > 0) {
    const url = pendingOAuthCallbacks.shift();
    if (url) listener(url);
  }
  return () => {
    oauthCallbacks.off("callback", listener);
  };
}

function isDeepLinkUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "code-review.app:" && parsed.hostname === "open";
  } catch {
    return false;
  }
}

function emitDeepLink(url: string, window: BrowserWindow | null) {
  if (!isDeepLinkUrl(url)) return false;
  if (deepLinkCallbacks.listenerCount("callback") === 0) {
    pendingDeepLinks.push(url);
  }
  deepLinkCallbacks.emit("callback", url);
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
  return true;
}

function subscribeToDeepLinks(listener: (url: string) => void) {
  deepLinkCallbacks.on("callback", listener);
  while (pendingDeepLinks.length > 0) {
    const url = pendingDeepLinks.shift();
    if (url) listener(url);
  }
  return () => {
    deepLinkCallbacks.off("callback", listener);
  };
}

export {
  emitDeepLink,
  emitOAuthCallback,
  isDeepLinkUrl,
  isOAuthCallbackUrl,
  subscribeToDeepLinks,
  subscribeToOAuthCallbacks,
};
