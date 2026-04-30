import { Effect, Layer } from 'effect';
import { CacheService } from '../cache.ts';
import { ForgeProviderRegistry } from '../providers/registry.ts';
import { AuthTokenStore } from '../auth/token-store.ts';
import type {
  ProviderProfile,
  ProviderAccount,
  ProviderAuthStatus,
  RepoSummary,
} from '@code-review-app/shared';

type RepoServiceShape = {
  listProviderAccounts(): Effect.Effect<ProviderAccount[], Error>;
  getProviderStatuses(): Effect.Effect<Record<string, ProviderAuthStatus>, Error>;
  getProviderProfile(accountId: string): Effect.Effect<ProviderProfile, Error>;
  listInitialRepos(accountId: string, limit?: number): Effect.Effect<RepoSummary[], Error>;
  searchRepos(
    accountId: string,
    query: string,
    limit?: number,
  ): Effect.Effect<RepoSummary[], Error>;
  validateRepo(accountId: string, repo: string): Effect.Effect<RepoSummary, Error>;
  listSavedRepos(): Effect.Effect<RepoSummary[], Error>;
  saveRepo(repo: RepoSummary): Effect.Effect<RepoSummary, Error>;
};

class RepoService extends Effect.Tag('RepoService')<RepoService, RepoServiceShape>() {}

const makeRepoService = Effect.gen(function* () {
  const tokenStore = yield* AuthTokenStore;
  const cache = yield* CacheService;
  const providers = yield* ForgeProviderRegistry;

  const listProviderAccounts: RepoServiceShape['listProviderAccounts'] = Effect.fn(
    'RepoService.listProviderAccounts',
  )(function* () {
    return yield* tokenStore.listAccounts();
  });

  const getProviderStatuses: RepoServiceShape['getProviderStatuses'] = Effect.fn(
    'RepoService.getProviderStatuses',
  )(function* () {
    const accounts = yield* tokenStore.listAccounts();
    const statuses: Record<string, ProviderAuthStatus> = {};
    for (const account of accounts) {
      const provider = yield* providers.forAccount(account.id);
      statuses[account.id] = yield* provider.authStatus();
    }
    return statuses;
  });

  const getProviderProfile: RepoServiceShape['getProviderProfile'] = Effect.fn(
    'RepoService.getProviderProfile',
  )(function* (accountId) {
    const account = yield* tokenStore.get(accountId);
    if (!account) throw new Error('Provider account is not signed in.');
    const cached = yield* cache
      .readProviderProfile(accountId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (cached) return cached;

    const provider = yield* providers.forAccount(accountId);
    const login = yield* provider.viewerLogin();
    const profile = { accountId, login };
    yield* cache.writeProviderProfile(profile);
    return profile;
  });

  const listInitialRepos: RepoServiceShape['listInitialRepos'] = Effect.fn(
    'RepoService.listInitialRepos',
  )(function* (accountId, limit = 5) {
    const provider = yield* providers.forAccount(accountId);
    return yield* provider.listInitialRepos(limit);
  });

  const searchRepos: RepoServiceShape['searchRepos'] = Effect.fn('RepoService.searchRepos')(
    function* (accountId, query, limit = 20) {
      const provider = yield* providers.forAccount(accountId);
      return yield* provider.searchRepos(query, limit);
    },
  );

  const validateRepo: RepoServiceShape['validateRepo'] = Effect.fn('RepoService.validateRepo')(
    function* (accountId, repo) {
      const provider = yield* providers.forAccount(accountId);
      return yield* provider.validateRepo(repo);
    },
  );

  const listSavedRepos: RepoServiceShape['listSavedRepos'] = Effect.fn(
    'RepoService.listSavedRepos',
  )(function* () {
    return yield* cache.listSavedRepos();
  });

  const saveRepo: RepoServiceShape['saveRepo'] = Effect.fn('RepoService.saveRepo')(
    function* (repo) {
      const account = yield* tokenStore.get(repo.providerAccountId);
      if (account?.viewerLogin) {
        yield* cache.writeProviderProfile({
          accountId: repo.providerAccountId,
          login: account.viewerLogin,
        });
      }
      yield* cache.saveRepo(repo);
      return repo;
    },
  );

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
