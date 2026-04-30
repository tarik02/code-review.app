import { HttpClient } from '@effect/platform';
import { Effect, Layer } from 'effect';
import { ProviderError } from '../errors.ts';
import { AuthTokenStore } from '../auth/token-store.ts';
import { createProviderRepoIdentityFromParts, parseProviderId } from '../repo-id.ts';
import {
  GitHubApiClient,
  githubErrorToProviderError,
  makeGitHubApiClient,
  makeGitHubProvider,
} from '../github/index.ts';
import {
  GitLabApiClient,
  gitlabErrorToProviderError,
  makeGitLabApiClient,
  makeGitLabProvider,
} from '../gitlab/index.ts';
import type { ForgeProviderContract, ForgeProviderEffectContract } from './types.ts';

type AccountScopedForgeProvider = ForgeProviderContract;

type ForgeProviderRegistryShape = {
  forAccount(accountId: string): Effect.Effect<AccountScopedForgeProvider, ProviderError>;
  forRepo(repo: { providerId: string; repoKey: string }): Effect.Effect<
    {
      provider: AccountScopedForgeProvider;
      repo: ReturnType<typeof createProviderRepoIdentityFromParts>;
    },
    ProviderError
  >;
};

class ForgeProviderRegistry extends Effect.Tag('ForgeProviderRegistry')<
  ForgeProviderRegistry,
  ForgeProviderRegistryShape
>() {}

function bindProviderContract<TContract extends ForgeProviderEffectContract<any, any>, TError>(
  contract: TContract,
  serviceTag: any,
  service: Effect.Effect<any, ProviderError>,
  mapError: (error: TError) => ProviderError,
): ForgeProviderContract {
  const entries = Object.entries(contract).map(([key, value]) => [
    key,
    (...args: unknown[]) =>
      (value as (...args: unknown[]) => Effect.Effect<unknown, TError, any>)(...args).pipe(
        Effect.provideServiceEffect(serviceTag, service),
        Effect.mapError((error) => mapError(error as TError)),
      ),
  ]);

  return Object.fromEntries(entries) as ForgeProviderContract;
}

const makeForgeProviderRegistry = Effect.gen(function* () {
  const tokenStore = yield* AuthTokenStore;
  const httpClient = yield* HttpClient.HttpClient;

  const forAccount: ForgeProviderRegistryShape['forAccount'] = Effect.fn(
    'ForgeProviderRegistry.forAccount',
  )(function* (accountId) {
    const account = yield* tokenStore.get(accountId).pipe(
      Effect.mapError(
        (error) =>
          new ProviderError(error instanceof Error ? error.message : String(error), {
            cause: error,
          }),
      ),
    );
    if (!account) {
      return yield* Effect.fail(new ProviderError('Provider account is not signed in.'));
    }

    const provider =
      account.provider === 'github'
        ? bindProviderContract(
            makeGitHubProvider(),
            GitHubApiClient,
            makeGitHubApiClient(accountId).pipe(
              Effect.provideService(AuthTokenStore, tokenStore),
              Effect.provideService(HttpClient.HttpClient, httpClient),
            ),
            githubErrorToProviderError,
          )
        : bindProviderContract(
            makeGitLabProvider(),
            GitLabApiClient,
            makeGitLabApiClient(accountId).pipe(
              Effect.provideService(AuthTokenStore, tokenStore),
              Effect.provideService(HttpClient.HttpClient, httpClient),
            ),
            gitlabErrorToProviderError,
          );

    return provider;
  });

  const forRepo: ForgeProviderRegistryShape['forRepo'] = Effect.fn('ForgeProviderRegistry.forRepo')(
    function* (repo) {
      const providerInfo = parseProviderId(repo.providerId);
      return {
        provider: yield* forAccount(providerInfo.accountId),
        repo: createProviderRepoIdentityFromParts(repo.providerId, repo.repoKey),
      };
    },
  );

  return {
    forAccount,
    forRepo,
  } satisfies ForgeProviderRegistryShape;
});

const ForgeProviderRegistryLive = Layer.effect(ForgeProviderRegistry, makeForgeProviderRegistry);

export { ForgeProviderRegistry, ForgeProviderRegistryLive };
export type { AccountScopedForgeProvider, ForgeProviderRegistryShape };
