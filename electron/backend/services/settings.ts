import { FileSystem } from "@effect/platform";
import path from "node:path";
import { app } from "electron";
import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { AuthTokenStore } from "../auth/token-store";
import type {
  AccountVisibilitySettings,
  AppearanceBackgroundInput,
  AppearanceBackgroundSettings,
  DiffDataSettings,
} from "../../shared/types";

type SettingsServiceShape = {
  getAccountVisibility(): Effect.Effect<AccountVisibilitySettings, Error>;
  setAccountVisibility(
    enabledAccountIds: string[],
  ): Effect.Effect<AccountVisibilitySettings, Error>;
  getDiffDataSettings(): Effect.Effect<DiffDataSettings, Error>;
  setDiffDataSettings(
    settings: DiffDataSettings,
  ): Effect.Effect<DiffDataSettings, Error>;
  getAppearanceBackground(): Effect.Effect<AppearanceBackgroundSettings, Error>;
  setAppearanceBackground(
    input: AppearanceBackgroundInput,
  ): Effect.Effect<AppearanceBackgroundSettings, Error>;
  setCustomBackgroundFromPath(
    filePath: string,
  ): Effect.Effect<AppearanceBackgroundSettings, Error>;
};

class SettingsService extends Effect.Tag("SettingsService")<
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

const APPEARANCE_BACKGROUND_KEY = "appearance.background";
const DIFF_DATA_SETTINGS_KEY = "diff_data_settings";
const MAX_BACKGROUND_FILE_SIZE = 15 * 1024 * 1024;

type PersistedAppearanceBackgroundSettings =
  | { kind: "default" }
  | { kind: "solid"; color: string }
  | {
      kind: "customFile";
      filePath: string;
      fileName: string;
      mimeType: string;
    };

const backgroundMimeTypes = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

function getBackgroundExtension(filePath: string) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return extension in backgroundMimeTypes
    ? (extension as keyof typeof backgroundMimeTypes)
    : null;
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
    return { kind: "default" };
  }

  try {
    const parsed =
      typeof value === "string"
        ? (JSON.parse(value) as Record<string, unknown>)
        : (value as Record<string, unknown>);
    if (parsed.kind === "default") {
      return { kind: "default" };
    }
    if (
      parsed.kind === "solid" &&
      typeof parsed.color === "string" &&
      isHexColor(parsed.color)
    ) {
      return { kind: "solid", color: parsed.color };
    }
    if (
      parsed.kind === "customFile" &&
      typeof parsed.filePath === "string" &&
      typeof parsed.fileName === "string" &&
      typeof parsed.mimeType === "string" &&
      isBackgroundMimeType(parsed.mimeType)
    ) {
      return {
        kind: "customFile",
        filePath: parsed.filePath,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
      };
    }
  } catch {
    // Fall through to the default background.
  }

  return { kind: "default" };
}

function parseDiffDataSettings(value: unknown): DiffDataSettings {
  if (
    value &&
    typeof value === "object" &&
    "mode" in value &&
    (value.mode === "provider-api" || value.mode === "git")
  ) {
    return { mode: value.mode };
  }

  return { mode: "provider-api" };
}

function validateDiffDataSettings(settings: DiffDataSettings): DiffDataSettings {
  if (settings.mode !== "provider-api" && settings.mode !== "git") {
    throw new Error("Unsupported diff loading mode.");
  }

  return { mode: settings.mode };
}

function readBackgroundDataUrl(
  fileSystem: FileSystem.FileSystem,
  background: PersistedAppearanceBackgroundSettings,
): Effect.Effect<AppearanceBackgroundSettings, Error> {
  if (background.kind !== "customFile") {
    return Effect.succeed(background);
  }

  return Effect.gen(function* () {
    const dataUrl = yield* fileSystem.readFile(background.filePath).pipe(
      Effect.map(
        (data) =>
          `data:${background.mimeType};base64,${Buffer.from(data).toString("base64")}`,
      ),
      Effect.catchAll(() => Effect.succeed(null)),
    );

    return {
      kind: "customFile",
      fileName: background.fileName,
      mimeType: background.mimeType,
      dataUrl,
    };
  });
}

const makeSettingsService = Effect.gen(function* () {
  const tokenStore = yield* AuthTokenStore;
  const cache = yield* CacheService;
  const fileSystem = yield* FileSystem.FileSystem;

  const getAccountVisibility: SettingsServiceShape["getAccountVisibility"] = Effect.fn(
    "SettingsService.getAccountVisibility",
  )(function* () {
        const accounts = yield* tokenStore.listAccounts();
        const accountIds = accounts.map((account) => account.id);
        const visibility = yield* cache.readProviderAccountVisibility(accountIds);
        return toVisibilitySettings(accountIds, visibility);
  });

  const setAccountVisibility: SettingsServiceShape["setAccountVisibility"] = Effect.fn(
    "SettingsService.setAccountVisibility",
  )(function* (enabledAccountIds) {
        const accounts = yield* tokenStore.listAccounts();
        const accountIds = accounts.map((account) => account.id);
        const knownAccountIds = new Set(accountIds);
        const unknownAccountId = enabledAccountIds.find(
          (accountId) => !knownAccountIds.has(accountId),
        );
        if (unknownAccountId) {
          throw new Error("Account visibility includes an unknown provider account.");
        }
        const filteredEnabledAccountIds = enabledAccountIds.filter((accountId) =>
          knownAccountIds.has(accountId),
        );

        yield* cache.setProviderAccountVisibility(
          accountIds,
          filteredEnabledAccountIds,
        );

        const visibility = yield* cache.readProviderAccountVisibility(accountIds);
        return toVisibilitySettings(accountIds, visibility);
  });

  const getDiffDataSettings: SettingsServiceShape["getDiffDataSettings"] = Effect.fn(
    "SettingsService.getDiffDataSettings",
  )(function* () {
        const persisted = yield* cache.readAppSetting<DiffDataSettings>(
          DIFF_DATA_SETTINGS_KEY,
        );
        return parseDiffDataSettings(persisted);
  });

  const setDiffDataSettings: SettingsServiceShape["setDiffDataSettings"] = Effect.fn(
    "SettingsService.setDiffDataSettings",
  )(function* (settings) {
        const validated = validateDiffDataSettings(settings);
        yield* cache.writeAppSetting(DIFF_DATA_SETTINGS_KEY, validated);
        return validated;
  });

  const getAppearanceBackground: SettingsServiceShape["getAppearanceBackground"] = Effect.fn(
    "SettingsService.getAppearanceBackground",
  )(function* () {
        const persisted = yield* cache.readAppSetting<PersistedAppearanceBackgroundSettings>(
          APPEARANCE_BACKGROUND_KEY,
        );
        return yield* readBackgroundDataUrl(
          fileSystem,
          parsePersistedBackground(persisted),
        );
  });

  const setAppearanceBackground: SettingsServiceShape["setAppearanceBackground"] = Effect.fn(
    "SettingsService.setAppearanceBackground",
  )(function* (input) {
        yield* cache.writeAppSetting(APPEARANCE_BACKGROUND_KEY, input);
        return yield* getAppearanceBackground();
  });

  const setCustomBackgroundFromPath: SettingsServiceShape["setCustomBackgroundFromPath"] = Effect.fn(
    "SettingsService.setCustomBackgroundFromPath",
  )(function* (filePath) {
        const extension = getBackgroundExtension(filePath);
        if (!extension) {
          throw new Error("Background image must be a PNG, JPG, GIF, WebP, or AVIF file.");
        }

        const sourceStats = yield* fileSystem.stat(filePath).pipe(
          Effect.mapError((error) =>
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
        if (sourceStats.type !== "File") {
          throw new Error("Background image must be a file.");
        }
        if (Number(sourceStats.size) > MAX_BACKGROUND_FILE_SIZE) {
          throw new Error("Background image must be 15 MB or smaller.");
        }

        const backgroundDirectory = path.join(app.getPath("userData"), "appearance");
        const destinationPath = path.join(
          backgroundDirectory,
          `background.${extension}`,
        );
        yield* fileSystem
          .makeDirectory(backgroundDirectory, { recursive: true })
          .pipe(
            Effect.flatMap(() =>
              path.resolve(filePath) === path.resolve(destinationPath)
                ? Effect.void
                : fileSystem.copyFile(filePath, destinationPath),
            ),
            Effect.mapError((error) =>
              error instanceof Error ? error : new Error(String(error)),
            ),
          );

        const persisted: PersistedAppearanceBackgroundSettings = {
          kind: "customFile",
          filePath: destinationPath,
          fileName: path.basename(filePath),
          mimeType: backgroundMimeTypes[extension],
        };

        yield* cache.writeAppSetting(APPEARANCE_BACKGROUND_KEY, persisted);
        return yield* readBackgroundDataUrl(fileSystem, persisted);
  });

  return {
    getAccountVisibility,
    setAccountVisibility,
    getDiffDataSettings,
    setDiffDataSettings,
    getAppearanceBackground,
    setAppearanceBackground,
    setCustomBackgroundFromPath,
  } satisfies SettingsServiceShape;
});

const SettingsServiceLive = Layer.effect(SettingsService, makeSettingsService);

export { SettingsService, SettingsServiceLive };
