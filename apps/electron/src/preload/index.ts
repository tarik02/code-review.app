import { ipcRenderer } from "electron";
import { trpcElectronPreload } from "@hadeeb/trpc-worker/adapter";

trpcElectronPreload({ ipcRenderer });
