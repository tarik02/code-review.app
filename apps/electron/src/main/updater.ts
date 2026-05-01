import electronUpdater from 'electron-updater';
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { Effect } from 'effect';
import type { AvailableUpdate, UpdateEvent } from '@code-review-app/shared';
import { getErrorMessage } from '@code-review-app/backend';
import { backendRuntime } from './backend-runtime';

const updateEvents = new EventEmitter();
let availableUpdate: AvailableUpdate | null = null;
let isConfigured = false;

function getAutoUpdater() {
  return electronUpdater.autoUpdater;
}

function toAvailableUpdate(updateInfo: { version: string; releaseNotes?: unknown }) {
  const body =
    typeof updateInfo.releaseNotes === 'string'
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
  updateEvents.emit('event', event);
}

function isUpdaterEnabled() {
  return app.isPackaged && process.env.CODE_REVIEW_APP_DISABLE_UPDATER !== '1';
}

function logUpdaterError(context: string, error: unknown) {
  void backendRuntime.runFork(
      Effect.logError(`[updater] ${context} failed`).pipe(
        Effect.annotateLogs({
        error: getErrorMessage(error),
        }),
      ),
  );
}

function configureUpdater() {
  if (isConfigured) return;
  if (!isUpdaterEnabled()) return;
  isConfigured = true;
  const autoUpdater = getAutoUpdater();
  autoUpdater.autoDownload = false;

  autoUpdater.on('checking-for-update', () => {
    emitUpdateEvent({ type: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    availableUpdate = toAvailableUpdate(info);
    emitUpdateEvent({ type: 'available', update: availableUpdate });
  });
  autoUpdater.on('update-not-available', () => {
    availableUpdate = null;
    emitUpdateEvent({ type: 'not_available' });
  });
  autoUpdater.on('download-progress', (progress) => {
    emitUpdateEvent({
      type: 'progress',
      downloaded: progress.transferred,
      contentLength: progress.total > 0 ? progress.total : null,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    availableUpdate = toAvailableUpdate(info);
    emitUpdateEvent({ type: 'downloaded', update: availableUpdate });
  });
  autoUpdater.on('error', (error) => {
    logUpdaterError('event', error);
    emitUpdateEvent({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

async function checkForUpdate() {
  if (!isUpdaterEnabled()) {
    return null;
  }
  configureUpdater();
  const autoUpdater = getAutoUpdater();
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.isUpdateAvailable || !result.updateInfo) return null;
    availableUpdate = toAvailableUpdate(result.updateInfo);
    return availableUpdate;
  } catch (error) {
    logUpdaterError('check', error);
    throw error;
  }
}

async function installUpdate() {
  if (!isUpdaterEnabled()) {
    return;
  }
  configureUpdater();
  if (!availableUpdate) {
    await checkForUpdate();
  }
  const autoUpdater = getAutoUpdater();
  try {
    await autoUpdater.downloadUpdate();
    autoUpdater.quitAndInstall();
  } catch (error) {
    logUpdaterError('install', error);
    throw error;
  }
}

function subscribeToUpdateEvents(listener: (event: UpdateEvent) => void) {
  updateEvents.on('event', listener);
  return () => {
    updateEvents.off('event', listener);
  };
}

export { checkForUpdate, configureUpdater, installUpdate, subscribeToUpdateEvents };
