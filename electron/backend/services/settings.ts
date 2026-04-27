import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { AuthTokenStore } from "../auth/token-store";
import type { AccountVisibilitySettings } from "../../shared/types";

type SettingsServiceShape = {
  getAccountVisibility(): Effect.Effect<AccountVisibilitySettings, Error>;
  setAccountVisibility(
    enabledAccountIds: string[],
  ): Effect.Effect<AccountVisibilitySettings, Error>;
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

const makeSettingsService = Effect.gen(function* () {
  const tokenStore = yield* AuthTokenStore;
  const cache = yield* CacheService;

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

  return {
    getAccountVisibility,
    setAccountVisibility,
  } satisfies SettingsServiceShape;
});

const SettingsServiceLive = Layer.effect(SettingsService, makeSettingsService);

export { SettingsService, SettingsServiceLive };
