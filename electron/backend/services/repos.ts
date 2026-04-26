import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { providerFor } from "../providers/registry";
import { getStoredAuthToken, listProviderAccounts } from "../auth/token-store";
import type {
  ProviderProfile,
  ProviderAccount,
  ProviderAuthStatus,
  RepoSummary,
} from "../../shared/types";

type RepoServiceShape = {
  listProviderAccounts(): Effect.Effect<ProviderAccount[], Error>;
  getProviderStatuses(): Effect.Effect<Record<string, ProviderAuthStatus>, Error>;
  getProviderProfile(accountId: string): Effect.Effect<ProviderProfile, Error>;
  listInitialRepos(
    accountId: string,
    limit?: number,
  ): Effect.Effect<RepoSummary[], Error>;
  searchRepos(
    accountId: string,
    query: string,
    limit?: number,
  ): Effect.Effect<RepoSummary[], Error>;
  validateRepo(
    accountId: string,
    repo: string,
  ): Effect.Effect<RepoSummary, Error>;
  listSavedRepos(): Effect.Effect<RepoSummary[], Error, CacheService>;
  saveRepo(repo: RepoSummary): Effect.Effect<RepoSummary, Error, CacheService>;
};

class RepoService extends Effect.Tag("RepoService")<RepoService, RepoServiceShape>() {
  static Live = Layer.succeed(this, createRepoService());
}

function createRepoService(): RepoServiceShape {
  return {
    listProviderAccounts: () => Effect.promise(() => listProviderAccounts()),

    getProviderStatuses: () =>
      Effect.gen(function* () {
        const accounts = yield* Effect.promise(() => listProviderAccounts());
        const statuses: Record<string, ProviderAuthStatus> = {};
        for (const account of accounts) {
          statuses[account.id] = yield* providerFor(account.provider).authStatus(account.id);
        }
        return statuses;
      }),

    getProviderProfile: (accountId) =>
      Effect.gen(function* () {
        const account = yield* Effect.promise(() => getStoredAuthToken(accountId));
        if (!account) throw new Error("Provider account is not signed in.");
        const login = yield* providerFor(account.provider).viewerLogin(accountId);
        return { accountId, login };
      }),

    listInitialRepos: (accountId, limit = 5) =>
      Effect.gen(function* () {
        const account = yield* Effect.promise(() => getStoredAuthToken(accountId));
        if (!account) return [];
        return yield* providerFor(account.provider).listInitialRepos(accountId, limit);
      }),

    searchRepos: (accountId, query, limit = 20) =>
      Effect.gen(function* () {
        const account = yield* Effect.promise(() => getStoredAuthToken(accountId));
        if (!account) return [];
        return yield* providerFor(account.provider).searchRepos(accountId, query, limit);
      }),

    validateRepo: (accountId, repo) =>
      Effect.gen(function* () {
        const account = yield* Effect.promise(() => getStoredAuthToken(accountId));
        if (!account) throw new Error("Provider account is not signed in.");
        return yield* providerFor(account.provider).validateRepo(accountId, repo);
      }),

    listSavedRepos: () =>
      Effect.gen(function* () {
        const cache = yield* CacheService;
        return yield* cache.listSavedRepos();
      }),

    saveRepo: (repo) =>
      Effect.gen(function* () {
        const cache = yield* CacheService;
        yield* cache.saveRepo(repo);
        return repo;
      }),
  };
}

export { RepoService };
