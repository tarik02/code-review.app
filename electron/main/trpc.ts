import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { createElectronServer } from "@hadeeb/trpc-worker/adapter";
import { router } from "../shared/router";

type ElectronTrpcServer = ReturnType<typeof createElectronServer>;
type ConnectionListener = Parameters<ElectronTrpcServer["on"]>[1];

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
            const rawData =
              typeof data === "string" ? Buffer.from(data, "utf8") : data;
            return clientListener(rawData, false);
          });
        }) as typeof client.on;

        return listener(client, request);
      };

      return wss.on(event, connectionListener);
    },
  };
}

function registerTrpc(window: BrowserWindow) {
  return applyWSSHandler({
    router,
    wss: createCompatibleElectronServer(),
    createContext: async () => ({
      getWindow: () => (window.isDestroyed() ? null : window),
    }),
  });
}

export { registerTrpc };
