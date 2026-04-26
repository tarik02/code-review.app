import electronUpdater from "electron-updater";
import { EventEmitter } from "node:events";
import { app } from "electron";
import type { AvailableUpdate, UpdateEvent } from "../shared/types";

const updateEvents = new EventEmitter();
let availableUpdate: AvailableUpdate | null = null;
let isConfigured = false;

function getAutoUpdater() {
  return electronUpdater.autoUpdater;
}

function toAvailableUpdate(updateInfo: { version: string; releaseNotes?: unknown }) {
  const body =
    typeof updateInfo.releaseNotes === "string"
      ? updateInfo.releaseNotes
      : updateInfo.releaseNotes == null
        ? null
        : JSON.stringify(updateInfo.releaseNotes);
  return {
    version: updateInfo.version,
    body,
  };
}

function emitUpdateEvent(event: UpdateEvent) {
  updateEvents.emit("event", event);
}

function configureUpdater() {
  if (isConfigured) return;
  isConfigured = true;
  const autoUpdater = getAutoUpdater();
  autoUpdater.autoDownload = false;

  autoUpdater.on("checking-for-update", () => {
    emitUpdateEvent({ type: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    availableUpdate = toAvailableUpdate(info);
    emitUpdateEvent({ type: "available", update: availableUpdate });
  });
  autoUpdater.on("update-not-available", () => {
    availableUpdate = null;
    emitUpdateEvent({ type: "not_available" });
  });
  autoUpdater.on("download-progress", (progress) => {
    emitUpdateEvent({
      type: "progress",
      downloaded: progress.transferred,
      contentLength: progress.total > 0 ? progress.total : null,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    availableUpdate = toAvailableUpdate(info);
    emitUpdateEvent({ type: "downloaded", update: availableUpdate });
  });
  autoUpdater.on("error", (error) => {
    emitUpdateEvent({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

async function checkForUpdate() {
  configureUpdater();
  if (!app.isPackaged) {
    return null;
  }
  const autoUpdater = getAutoUpdater();
  const result = await autoUpdater.checkForUpdates();
  if (!result?.isUpdateAvailable || !result.updateInfo) return null;
  availableUpdate = toAvailableUpdate(result.updateInfo);
  return availableUpdate;
}

async function installUpdate() {
  configureUpdater();
  if (!availableUpdate) {
    await checkForUpdate();
  }
  const autoUpdater = getAutoUpdater();
  await autoUpdater.downloadUpdate();
  autoUpdater.quitAndInstall();
}

function subscribeToUpdateEvents(listener: (event: UpdateEvent) => void) {
  updateEvents.on("event", listener);
  return () => {
    updateEvents.off("event", listener);
  };
}

export { checkForUpdate, configureUpdater, installUpdate, subscribeToUpdateEvents };
