import { FileSystem } from '@effect/platform';
import path from 'node:path';
import { Cause, Effect, Layer, Option } from 'effect';
import { BackendConfig } from '../config.ts';
import { CacheService } from '../cache.ts';
import { AppSettingsService } from './app-settings.ts';
import { AuthTokenStore } from '../auth/token-store.ts';
import type {
  AccountVisibilitySettings,
  AppearanceBackgroundInput,
  AppearanceBackgroundSettings,
  CodeAppearanceSettings,
  DiffDataSettings,
  ReviewEditorSettings,
  ThemePreference,
  ThemePreferenceSettings,
} from '@code-review-app/shared';

type SettingsServiceShape = {
  getAccountVisibility(): Effect.Effect<AccountVisibilitySettings, Error>;
  setAccountVisibility(
    enabledAccountIds: string[],
  ): Effect.Effect<AccountVisibilitySettings, Error>;
  getDiffDataSettings(): Effect.Effect<DiffDataSettings, Error>;
  setDiffDataSettings(settings: DiffDataSettings): Effect.Effect<DiffDataSettings, Error>;
  getThemePreference(): Effect.Effect<ThemePreferenceSettings, Error>;
  setThemePreference(
    settings: ThemePreferenceSettings,
  ): Effect.Effect<ThemePreferenceSettings, Error>;
  getCodeAppearanceSettings(): Effect.Effect<CodeAppearanceSettings, Error>;
  setCodeAppearanceSettings(
    settings: CodeAppearanceSettings,
  ): Effect.Effect<CodeAppearanceSettings, Error>;
  getReviewEditorSettings(): Effect.Effect<ReviewEditorSettings, Error>;
  setReviewEditorSettings(
    settings: ReviewEditorSettings,
  ): Effect.Effect<ReviewEditorSettings, Error>;
  getAppearanceBackground(): Effect.Effect<AppearanceBackgroundSettings, Error>;
  setAppearanceBackground(
    input: AppearanceBackgroundInput,
  ): Effect.Effect<AppearanceBackgroundSettings, Error>;
  setCustomBackgroundFromPath(filePath: string): Effect.Effect<AppearanceBackgroundSettings, Error>;
};

class SettingsService extends Effect.Tag('SettingsService')<
  SettingsService,
  SettingsServiceShape
>() {}

function toVisibilitySettings(
  accountIds: string[],
  persistedVisibility: Record<string, boolean>,
): AccountVisibilitySettings {
  const enabledAccountIds: string[] = [];
  const disabledAccountIds: string[] = [];

  for (const accountId of accountIds) {
    const isEnabled = persistedVisibility[accountId] ?? true;
    if (isEnabled) {
      enabledAccountIds.push(accountId);
    } else {
      disabledAccountIds.push(accountId);
    }
  }

  return { enabledAccountIds, disabledAccountIds };
}

const APPEARANCE_BACKGROUND_KEY = 'appearance.background';
const THEME_PREFERENCE_KEY = 'theme_preference';
const DIFF_DATA_SETTINGS_KEY = 'diff_data_settings';
const CODE_APPEARANCE_SETTINGS_KEY = 'code_appearance_settings';
const REVIEW_EDITOR_SETTINGS_KEY = 'review_editor_settings';
const MAX_BACKGROUND_FILE_SIZE = 15 * 1024 * 1024;
const CUSTOM_FONT_FAMILY_PATTERN = /^[A-Za-z0-9,'" _-]+$/;

type PersistedAppearanceBackgroundSettings =
  | { kind: 'default' }
  | { kind: 'solid'; color: string }
  | {
      kind: 'customFile';
      filePath: string;
      fileName: string;
      mimeType: string;
    };

const backgroundMimeTypes = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

function getBackgroundExtension(filePath: string) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return extension in backgroundMimeTypes ? (extension as keyof typeof backgroundMimeTypes) : null;
}

function isHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function isBackgroundMimeType(value: string) {
  return Object.values(backgroundMimeTypes).includes(
    value as (typeof backgroundMimeTypes)[keyof typeof backgroundMimeTypes],
  );
}

function parsePersistedBackground(value: unknown): PersistedAppearanceBackgroundSettings {
  if (!value) {
    return { kind: 'default' };
  }

  try {
    const parsed =
      typeof value === 'string'
        ? (JSON.parse(value) as Record<string, unknown>)
        : (value as Record<string, unknown>);
    if (parsed.kind === 'default') {
      return { kind: 'default' };
    }
    if (parsed.kind === 'solid' && typeof parsed.color === 'string' && isHexColor(parsed.color)) {
      return { kind: 'solid', color: parsed.color };
    }
    if (
      parsed.kind === 'customFile' &&
      typeof parsed.filePath === 'string' &&
      typeof parsed.fileName === 'string' &&
      typeof parsed.mimeType === 'string' &&
      isBackgroundMimeType(parsed.mimeType)
    ) {
      return {
        kind: 'customFile',
        filePath: parsed.filePath,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
      };
    }
  } catch {
    // Fall through to the default background.
  }

  return { kind: 'default' };
}

function parseDiffDataSettings(value: unknown): DiffDataSettings {
  if (
    value &&
    typeof value === 'object' &&
    'mode' in value &&
    (value.mode === 'provider-api' || value.mode === 'git')
  ) {
    return { mode: value.mode };
  }

  return { mode: 'provider-api' };
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'auto' || value === 'light' || value === 'dark';
}

function parseThemePreferenceSettings(value: unknown): ThemePreferenceSettings {
  if (
    value &&
    typeof value === 'object' &&
    'preference' in value &&
    isThemePreference(value.preference)
  ) {
    return { preference: value.preference };
  }

  return { preference: 'auto' };
}

function validateThemePreferenceSettings(
  settings: ThemePreferenceSettings,
): ThemePreferenceSettings {
  if (!isThemePreference(settings.preference)) {
    throw new Error('Unsupported theme preference.');
  }

  return { preference: settings.preference };
}

function validateDiffDataSettings(settings: DiffDataSettings): DiffDataSettings {
  if (settings.mode !== 'provider-api' && settings.mode !== 'git') {
    throw new Error('Unsupported diff loading mode.');
  }

  return { mode: settings.mode };
}

function parseCodeAppearanceSettings(value: unknown): CodeAppearanceSettings {
  const parsed =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : ({} as const);
  const fontFamily =
    parsed.fontFamily === 'geist-mono' ||
    parsed.fontFamily === 'system-mono' ||
    parsed.fontFamily === 'custom'
      ? parsed.fontFamily
      : 'geist-mono';
  const customFontFamily =
    typeof parsed.customFontFamily === 'string' ? parsed.customFontFamily.trim() : null;
  const fontSizePx =
    typeof parsed.fontSizePx === 'number' &&
    Number.isInteger(parsed.fontSizePx) &&
    parsed.fontSizePx >= 11 &&
    parsed.fontSizePx <= 18
      ? parsed.fontSizePx
      : 13;
  const ligatures = typeof parsed.ligatures === 'boolean' ? parsed.ligatures : false;
  const diffThemePreset =
    parsed.diffThemePreset === 'pierre' ||
    parsed.diffThemePreset === 'github' ||
    parsed.diffThemePreset === 'catppuccin' ||
    parsed.diffThemePreset === 'solarized'
      ? parsed.diffThemePreset
      : 'pierre';

  if (
    fontFamily === 'custom' &&
    customFontFamily &&
    CUSTOM_FONT_FAMILY_PATTERN.test(customFontFamily)
  ) {
    return {
      fontFamily,
      customFontFamily,
      fontSizePx,
      ligatures,
      diffThemePreset,
    };
  }

  return {
    fontFamily: fontFamily === 'custom' ? 'geist-mono' : fontFamily,
    customFontFamily: null,
    fontSizePx,
    ligatures,
    diffThemePreset,
  };
}

function validateCodeAppearanceSettings(settings: CodeAppearanceSettings): CodeAppearanceSettings {
  if (
    settings.fontFamily !== 'geist-mono' &&
    settings.fontFamily !== 'system-mono' &&
    settings.fontFamily !== 'custom'
  ) {
    throw new Error('Unsupported code font family.');
  }

  if (
    !Number.isInteger(settings.fontSizePx) ||
    settings.fontSizePx < 11 ||
    settings.fontSizePx > 18
  ) {
    throw new Error('Code font size must be an integer between 11 and 18.');
  }

  if (
    settings.diffThemePreset !== 'pierre' &&
    settings.diffThemePreset !== 'github' &&
    settings.diffThemePreset !== 'catppuccin' &&
    settings.diffThemePreset !== 'solarized'
  ) {
    throw new Error('Unsupported diff theme preset.');
  }

  if (settings.fontFamily !== 'custom') {
    return {
      ...settings,
      customFontFamily: null,
    };
  }

  const customFontFamily = settings.customFontFamily?.trim() ?? '';
  if (customFontFamily.length === 0) {
    throw new Error('Custom code font family is required.');
  }
  if (!CUSTOM_FONT_FAMILY_PATTERN.test(customFontFamily)) {
    throw new Error('Custom code font family contains unsupported characters.');
  }

  return {
    ...settings,
    customFontFamily,
  };
}

function parseReviewEditorSettings(value: unknown): ReviewEditorSettings {
  if (
    value &&
    typeof value === 'object' &&
    'defaultMode' in value &&
    (value.defaultMode === 'rich-text' || value.defaultMode === 'source')
  ) {
    return { defaultMode: value.defaultMode };
  }

  return { defaultMode: 'rich-text' };
}

function validateReviewEditorSettings(settings: ReviewEditorSettings): ReviewEditorSettings {
  if (settings.defaultMode !== 'rich-text' && settings.defaultMode !== 'source') {
    throw new Error('Unsupported review editor mode.');
  }

  return { defaultMode: settings.defaultMode };
}

function readBackgroundDataUrl(
  fileSystem: FileSystem.FileSystem,
  background: PersistedAppearanceBackgroundSettings,
): Effect.Effect<AppearanceBackgroundSettings, Error> {
  if (background.kind !== 'customFile') {
    return Effect.succeed(background);
  }

  return Effect.gen(function* () {
    const dataUrl = yield* fileSystem.readFile(background.filePath).pipe(
      Effect.map(
        (data) => `data:${background.mimeType};base64,${Buffer.from(data).toString('base64')}`,
      ),
      Effect.option,
      Effect.map(Option.getOrNull),
    );

    return {
      kind: 'customFile',
      fileName: background.fileName,
      mimeType: background.mimeType,
      dataUrl,
    };
  });
}

const makeSettingsService = Effect.gen(function* () {
  const tokenStore = yield* AuthTokenStore;
  const cache = yield* CacheService;
  const appSettings = yield* AppSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const config = yield* BackendConfig;

  const getAccountVisibility: SettingsServiceShape['getAccountVisibility'] = Effect.fn(
    'SettingsService.getAccountVisibility',
  )(function* () {
    const accounts = yield* tokenStore.listAccounts();
    const accountIds = accounts.map((account) => account.id);
    const visibility = yield* cache.readProviderAccountVisibility(accountIds);
    return toVisibilitySettings(accountIds, visibility);
  });

  const setAccountVisibility: SettingsServiceShape['setAccountVisibility'] = Effect.fn(
    'SettingsService.setAccountVisibility',
  )(function* (enabledAccountIds) {
    const accounts = yield* tokenStore.listAccounts();
    const accountIds = accounts.map((account) => account.id);
    const knownAccountIds = new Set(accountIds);
    const unknownAccountId = enabledAccountIds.find((accountId) => !knownAccountIds.has(accountId));
    if (unknownAccountId) {
      throw new Error('Account visibility includes an unknown provider account.');
    }
    const filteredEnabledAccountIds = enabledAccountIds.filter((accountId) =>
      knownAccountIds.has(accountId),
    );

    yield* cache.setProviderAccountVisibility(accountIds, filteredEnabledAccountIds);

    const visibility = yield* cache.readProviderAccountVisibility(accountIds);
    return toVisibilitySettings(accountIds, visibility);
  });

  const getDiffDataSettings: SettingsServiceShape['getDiffDataSettings'] = Effect.fn(
    'SettingsService.getDiffDataSettings',
  )(function* () {
    const persisted = yield* appSettings.read<DiffDataSettings>(DIFF_DATA_SETTINGS_KEY);
    return parseDiffDataSettings(persisted);
  });

  const setDiffDataSettings: SettingsServiceShape['setDiffDataSettings'] = Effect.fn(
    'SettingsService.setDiffDataSettings',
  )(function* (settings) {
    const validated = validateDiffDataSettings(settings);
    yield* appSettings.write(DIFF_DATA_SETTINGS_KEY, validated);
    return validated;
  });

  const getThemePreference: SettingsServiceShape['getThemePreference'] = Effect.fn(
    'SettingsService.getThemePreference',
  )(function* () {
    const persisted = yield* appSettings.read<ThemePreferenceSettings>(THEME_PREFERENCE_KEY);
    return parseThemePreferenceSettings(persisted);
  });

  const setThemePreference: SettingsServiceShape['setThemePreference'] = Effect.fn(
    'SettingsService.setThemePreference',
  )(function* (settings) {
    const validated = validateThemePreferenceSettings(settings);
    yield* appSettings.write(THEME_PREFERENCE_KEY, validated);
    return validated;
  });

  const getCodeAppearanceSettings: SettingsServiceShape['getCodeAppearanceSettings'] = Effect.fn(
    'SettingsService.getCodeAppearanceSettings',
  )(function* () {
    const persisted = yield* appSettings.read<CodeAppearanceSettings>(CODE_APPEARANCE_SETTINGS_KEY);
    return parseCodeAppearanceSettings(persisted);
  });

  const setCodeAppearanceSettings: SettingsServiceShape['setCodeAppearanceSettings'] = Effect.fn(
    'SettingsService.setCodeAppearanceSettings',
  )(function* (settings) {
    const validated = validateCodeAppearanceSettings(settings);
    yield* appSettings.write(CODE_APPEARANCE_SETTINGS_KEY, validated);
    return validated;
  });

  const getReviewEditorSettings: SettingsServiceShape['getReviewEditorSettings'] = Effect.fn(
    'SettingsService.getReviewEditorSettings',
  )(function* () {
    const persisted = yield* appSettings.read<ReviewEditorSettings>(REVIEW_EDITOR_SETTINGS_KEY);
    return parseReviewEditorSettings(persisted);
  });

  const setReviewEditorSettings: SettingsServiceShape['setReviewEditorSettings'] = Effect.fn(
    'SettingsService.setReviewEditorSettings',
  )(function* (settings) {
    const validated = validateReviewEditorSettings(settings);
    yield* appSettings.write(REVIEW_EDITOR_SETTINGS_KEY, validated);
    return validated;
  });

  const getAppearanceBackground: SettingsServiceShape['getAppearanceBackground'] = Effect.fn(
    'SettingsService.getAppearanceBackground',
  )(function* () {
    const persisted =
      yield* appSettings.read<PersistedAppearanceBackgroundSettings>(APPEARANCE_BACKGROUND_KEY);
    return yield* readBackgroundDataUrl(fileSystem, parsePersistedBackground(persisted));
  });

  const setAppearanceBackground: SettingsServiceShape['setAppearanceBackground'] = Effect.fn(
    'SettingsService.setAppearanceBackground',
  )(function* (input) {
    yield* appSettings.write(APPEARANCE_BACKGROUND_KEY, input);
    return yield* getAppearanceBackground();
  });

  const setCustomBackgroundFromPath: SettingsServiceShape['setCustomBackgroundFromPath'] =
    Effect.fn('SettingsService.setCustomBackgroundFromPath')(function* (filePath) {
      const extension = getBackgroundExtension(filePath);
      if (!extension) {
        throw new Error('Background image must be a PNG, JPG, GIF, WebP, or AVIF file.');
      }

      const sourceStats = yield* fileSystem
        .stat(filePath)
        .pipe(Effect.mapError((cause) => new Cause.UnknownException(cause)));
      if (sourceStats.type !== 'File') {
        throw new Error('Background image must be a file.');
      }
      if (Number(sourceStats.size) > MAX_BACKGROUND_FILE_SIZE) {
        throw new Error('Background image must be 15 MB or smaller.');
      }

      const backgroundDirectory = path.join(config.userDataPath, 'appearance');
      const destinationPath = path.join(backgroundDirectory, `background.${extension}`);
      yield* fileSystem.makeDirectory(backgroundDirectory, { recursive: true }).pipe(
        Effect.flatMap(() =>
          path.resolve(filePath) === path.resolve(destinationPath)
            ? Effect.void
            : fileSystem.copyFile(filePath, destinationPath),
        ),
        Effect.mapError((cause) => new Cause.UnknownException(cause)),
      );

      const persisted: PersistedAppearanceBackgroundSettings = {
        kind: 'customFile',
        filePath: destinationPath,
        fileName: path.basename(filePath),
        mimeType: backgroundMimeTypes[extension],
      };

      yield* appSettings.write(APPEARANCE_BACKGROUND_KEY, persisted);
      return yield* readBackgroundDataUrl(fileSystem, persisted);
    });

  return {
    getAccountVisibility,
    setAccountVisibility,
    getDiffDataSettings,
    setDiffDataSettings,
    getThemePreference,
    setThemePreference,
    getCodeAppearanceSettings,
    setCodeAppearanceSettings,
    getReviewEditorSettings,
    setReviewEditorSettings,
    getAppearanceBackground,
    setAppearanceBackground,
    setCustomBackgroundFromPath,
  } satisfies SettingsServiceShape;
});

const SettingsServiceLive = Layer.effect(SettingsService, makeSettingsService);

export {
  parseCodeAppearanceSettings,
  SettingsService,
  SettingsServiceLive,
  validateCodeAppearanceSettings,
};
