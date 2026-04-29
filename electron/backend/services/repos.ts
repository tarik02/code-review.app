import { HttpClient } from "@effect/platform";
import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { providerFor } from "../providers/registry";
import { AuthTokenStore } from "../auth/token-store";
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
  validateRepo(accountId: string, repo: string): Effect.Effect<RepoSummary, Error>;
  listSavedRepos(): Effect.Effect<RepoSummary[], Error>;
  saveRepo(repo: RepoSummary): Effect.Effect<RepoSummary, Error>;
};

class RepoService extends Effect.Tag("RepoService")<RepoService, RepoServiceShape>() {}

const makeRepoService = Effect.gen(function* () {
  const tokenStore = yield* AuthTokenStore;
  const cache = yield* CacheService;
  const httpClient = yield* HttpClient.HttpClient;

  const provideProviderDeps = <A, E>(
    effect: Effect.Effect<A, E, AuthTokenStore | HttpClient.HttpClient>,
  ) =>
    effect.pipe(
      Effect.provideService(AuthTokenStore, tokenStore),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );

  const listProviderAccounts: RepoServiceShape["listProviderAccounts"] = Effect.fn(
    "RepoService.listProviderAccounts",
  )(function* () {
    return yield* tokenStore.listAccounts();
  });

  const getProviderStatuses: RepoServiceShape["getProviderStatuses"] = Effect.fn(
    "RepoService.getProviderStatuses",
  )(function* () {
        const accounts = yield* tokenStore.listAccounts();
        const statuses: Record<string, ProviderAuthStatus> = {};
        for (const account of accounts) {
          statuses[account.id] = yield* provideProviderDeps(
            providerFor(account.provider).authStatus(account.id),
          );
        }
        return statuses;
  });

  const getProviderProfile: RepoServiceShape["getProviderProfile"] = Effect.fn(
    "RepoService.getProviderProfile",
  )(function* (accountId) {
        const account = yield* tokenStore.get(accountId);
        if (!account) throw new Error("Provider account is not signed in.");
        const cached = yield* cache
          .readProviderProfile(accountId)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (cached) return cached;

        const login = yield* provideProviderDeps(
          providerFor(account.provider).viewerLogin(accountId),
        );
        const profile = { accountId, login };
        yield* cache.writeProviderProfile(profile);
        return profile;
  });

  const listInitialRepos: RepoServiceShape["listInitialRepos"] = Effect.fn(
    "RepoService.listInitialRepos",
  )(function* (accountId, limit = 5) {
        const account = yield* tokenStore.get(accountId);
        if (!account) return [];
        return yield* provideProviderDeps(
          providerFor(account.provider).listInitialRepos(accountId, limit),
        );
  });

  const searchRepos: RepoServiceShape["searchRepos"] = Effect.fn(
    "RepoService.searchRepos",
  )(function* (accountId, query, limit = 20) {
        const account = yield* tokenStore.get(accountId);
        if (!account) return [];
        return yield* provideProviderDeps(
          providerFor(account.provider).searchRepos(accountId, query, limit),
        );
  });

  const validateRepo: RepoServiceShape["validateRepo"] = Effect.fn(
    "RepoService.validateRepo",
  )(function* (accountId, repo) {
        const account = yield* tokenStore.get(accountId);
        if (!account) throw new Error("Provider account is not signed in.");
        return yield* provideProviderDeps(
          providerFor(account.provider).validateRepo(accountId, repo),
        );
  });

  const listSavedRepos: RepoServiceShape["listSavedRepos"] = Effect.fn(
    "RepoService.listSavedRepos",
  )(function* () {
    return yield* cache.listSavedRepos();
  });

  const saveRepo: RepoServiceShape["saveRepo"] = Effect.fn(
    "RepoService.saveRepo",
  )(function* (repo) {
    const account = yield* tokenStore.get(repo.providerAccountId);
    if (account?.viewerLogin) {
      yield* cache.writeProviderProfile({
        accountId: repo.providerAccountId,
        login: account.viewerLogin,
      });
    }
    yield* cache.saveRepo(repo);
    return repo;
  });

  return {
    listProviderAccounts,
    getProviderStatuses,
    getProviderProfile,
    listInitialRepos,
    searchRepos,
    validateRepo,
    listSavedRepos,
    saveRepo,
  } satisfies RepoServiceShape;
});

const RepoServiceLive = Layer.effect(RepoService, makeRepoService);

export { RepoService, RepoServiceLive };
