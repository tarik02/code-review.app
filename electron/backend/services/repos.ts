import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { normalizeHost, parseProviderKind } from "../repo-id";
import { providerFor } from "../providers/registry";
import type {
  CliStatus,
  ForgeProviderKind,
  RepoSummary,
} from "../../shared/types";

type RepoServiceShape = {
  getCliStatuses(gitlabHost?: string): Effect.Effect<Record<string, CliStatus>, Error>;
  listInitialRepos(
    provider?: ForgeProviderKind,
    host?: string,
    limit?: number,
  ): Effect.Effect<RepoSummary[], Error>;
  searchRepos(
    provider: ForgeProviderKind | undefined,
    host: string | undefined,
    query: string,
    limit?: number,
  ): Effect.Effect<RepoSummary[], Error>;
  validateRepo(
    provider: ForgeProviderKind | undefined,
    host: string | undefined,
    repo: string,
  ): Effect.Effect<RepoSummary, Error>;
  listSavedRepos(): Effect.Effect<RepoSummary[], Error, CacheService>;
  saveRepo(repo: RepoSummary): Effect.Effect<RepoSummary, Error, CacheService>;
};

class RepoService extends Effect.Tag("RepoService")<RepoService, RepoServiceShape>() {
  static Live = Layer.succeed(this, createRepoService());
}

function defaultHost(provider: ForgeProviderKind, host?: string) {
  return normalizeHost(host ?? (provider === "github" ? "github.com" : "gitlab.com"));
}

function normalizeProvider(provider?: ForgeProviderKind) {
  return parseProviderKind(provider ?? "github");
}

function createRepoService(): RepoServiceShape {
  return {
    getCliStatuses: (gitlabHost) =>
      Effect.gen(function* () {
        const host = normalizeHost(gitlabHost ?? "gitlab.com");
        const githubStatus = yield* providerFor("github").cliStatus("github.com");
        const gitlabStatus = yield* providerFor("gitlab").cliStatus(host);
        return {
          "github:github.com": githubStatus,
          [`gitlab:${host}`]: gitlabStatus,
        };
      }),

    listInitialRepos: (providerInput, hostInput, limit = 5) =>
      Effect.gen(function* () {
        const provider = normalizeProvider(providerInput);
        const host = defaultHost(provider, hostInput);
        return yield* providerFor(provider).listInitialRepos(host, limit);
      }),

    searchRepos: (providerInput, hostInput, query, limit = 20) =>
      Effect.gen(function* () {
        const provider = normalizeProvider(providerInput);
        const host = defaultHost(provider, hostInput);
        return yield* providerFor(provider).searchRepos(host, query, limit);
      }),

    validateRepo: (providerInput, hostInput, repo) =>
      Effect.gen(function* () {
        const provider = normalizeProvider(providerInput);
        const host = defaultHost(provider, hostInput);
        return yield* providerFor(provider).validateRepo(host, repo);
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
