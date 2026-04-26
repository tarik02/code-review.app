import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { listProviderAccounts } from "../auth/token-store";
import type { AccountVisibilitySettings } from "../../shared/types";

type SettingsServiceShape = {
  getAccountVisibility(): Effect.Effect<
    AccountVisibilitySettings,
    Error,
    CacheService
  >;
  setAccountVisibility(
    enabledAccountIds: string[],
  ): Effect.Effect<AccountVisibilitySettings, Error, CacheService>;
};

class SettingsService extends Effect.Tag("SettingsService")<
  SettingsService,
  SettingsServiceShape
>() {
  static Live = Layer.succeed(this, createSettingsService());
}

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

function createSettingsService(): SettingsServiceShape {
  return {
    getAccountVisibility: () =>
      Effect.gen(function* () {
        const cache = yield* CacheService;
        const accounts = yield* Effect.promise(() => listProviderAccounts());
        const accountIds = accounts.map((account) => account.id);
        const visibility = yield* cache.readProviderAccountVisibility(accountIds);
        return toVisibilitySettings(accountIds, visibility);
      }),

    setAccountVisibility: (enabledAccountIds) =>
      Effect.gen(function* () {
        const cache = yield* CacheService;
        const accounts = yield* Effect.promise(() => listProviderAccounts());
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
      }),
  };
}

export { SettingsService };
