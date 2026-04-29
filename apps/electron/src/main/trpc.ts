import { app, dialog, ipcMain } from "electron";
import type { BrowserWindow, OpenDialogOptions } from "electron";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { createElectronServer } from "@hadeeb/trpc-worker/adapter";
import { createAppRouter, type BackendRouterPlatform } from "@code-review-app/backend";
import { backendRuntime } from "./backend-runtime";
import { checkForUpdate, installUpdate, subscribeToUpdateEvents } from "./updater";
import {
  getLatestOAuthCallback,
  subscribeToDeepLinks,
  subscribeToOAuthCallbacks,
} from "./oauth-callback";
import { applyNativeThemePreference } from "./window";

type ElectronTrpcServer = ReturnType<typeof createElectronServer>;
type ConnectionListener = (client: any, request: any) => void;

function createCompatibleElectronServer(): ElectronTrpcServer {
  const wss = createElectronServer({ ipcMain });

  return {
    ...wss,
    on(event, listener) {
      if (event !== "connection") {
        return wss.on(event, listener);
      }

      const connectionListener: ConnectionListener = (client, request) => {
        const originalOn = client.on.bind(client);

        client.on = ((clientEvent: string, clientListener: (...args: unknown[]) => void) => {
          if (clientEvent !== "message") {
            return originalOn(clientEvent, clientListener);
          }

          return originalOn("message", (data: unknown) => {
            // Current @trpc/server WS handling expects Node Buffer payloads.
            // The MessagePort bridge delivers decoded strings from the renderer.
            const rawData = typeof data === "string" ? Buffer.from(data, "utf8") : data;
            return clientListener(rawData, false);
          });
        }) as typeof client.on;

        return (listener as ConnectionListener)(client, request);
      };

      return wss.on(event, connectionListener);
    },
  } as ElectronTrpcServer;
}

function createElectronRouterPlatform(window: BrowserWindow): BackendRouterPlatform {
  return {
    getCurrentVersion: () => app.getVersion(),
    selectCustomBackgroundFile: async () => {
      const openDialogOptions = {
        properties: ["openFile"],
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"],
          },
        ],
      } satisfies OpenDialogOptions;
      const result = window.isDestroyed()
        ? await dialog.showOpenDialog(openDialogOptions)
        : await dialog.showOpenDialog(window, openDialogOptions);

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    },
    getLatestOAuthCallback,
    subscribeToOAuthCallbacks,
    subscribeToDeepLinks,
    subscribeToFullScreenStatus: (listener) => {
      if (window.isDestroyed()) {
        listener(false);
        return () => {};
      }

      const emitStatus = () => {
        if (!window.isDestroyed()) {
          listener(window.isFullScreen());
        }
      };

      emitStatus();
      window.on("enter-full-screen", emitStatus);
      window.on("leave-full-screen", emitStatus);

      return () => {
        if (window.isDestroyed()) return;
        window.off("enter-full-screen", emitStatus);
        window.off("leave-full-screen", emitStatus);
      };
    },
    setNativeTheme: applyNativeThemePreference,
    toggleMaximize: () => {
      if (window.isDestroyed()) return;
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    },
    checkForUpdate,
    installUpdate,
    subscribeToUpdateEvents,
  };
}

function registerTrpc(window: BrowserWindow) {
  const router = createAppRouter({
    runtime: backendRuntime,
    platform: createElectronRouterPlatform(window),
  });

  return applyWSSHandler({
    router,
    wss: createCompatibleElectronServer(),
    createContext: async () => ({}),
  });
}

export { createElectronRouterPlatform, registerTrpc };
