import { app, BrowserWindow } from 'electron';
import { Effect } from 'effect';
import { SettingsService, summarizeError } from '@code-review-app/backend';
import { applyNativeThemePreference, createMainWindow } from './window';
import { configureUpdater } from './updater';
import { backendRuntime } from './backend-runtime';
import {
  emitDeepLink,
  emitOAuthCallback,
  isDeepLinkUrl,
  isOAuthCallbackUrl,
} from './oauth-callback';

app.setName('code-review.app');

if (process.platform === 'linux' && process.env.APPIMAGE) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
}

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient('code-review.app', process.execPath, [process.argv[1]]);
} else {
  app.setAsDefaultProtocolClient('code-review.app');
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
}

function currentWindow() {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

function handlePotentialAppUrl(url: string) {
  const window = currentWindow();
  return emitOAuthCallback(url, window) || emitDeepLink(url, window);
}

app.on('open-url', (event, url) => {
  if (isOAuthCallbackUrl(url) || isDeepLinkUrl(url)) {
    event.preventDefault();
    handlePotentialAppUrl(url);
  }
});

app.on('second-instance', (_event, argv) => {
  for (const item of argv) {
    if (handlePotentialAppUrl(item)) {
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
    handlePotentialAppUrl(item);
  }
}

async function syncNativeThemeFromSettings() {
  try {
    const preference = await backendRuntime.runPromise(
      Effect.gen(function* () {
        const settings = yield* SettingsService;
        return (yield* settings.getThemePreference()).preference;
      }),
    );
    applyNativeThemePreference(preference);
  } catch (error) {
    void Effect.runFork(
      Effect.logError('Failed to sync native theme from settings.').pipe(
        Effect.annotateLogs({
          error: summarizeError(error),
        }),
      ),
    );
  }
}

app.whenReady().then(async () => {
  await syncNativeThemeFromSettings();
  configureUpdater();
  await createMainWindow();
  handleStartupProtocolUrls();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void backendRuntime.dispose();
});
