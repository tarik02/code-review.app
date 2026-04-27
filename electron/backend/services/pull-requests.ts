import { HttpClient } from "@effect/platform";
import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { ValidationError } from "../errors";
import { parseRepoId } from "../repo-id";
import { providerFor } from "../providers/registry";
import { DiffDataService } from "./diff-data";
import { AuthTokenStore } from "../auth/token-store";
import type {
  OverviewPullRequestSummary,
  PrFileChangeType,
  PrFileContents,
  PrPatch,
  PullRequestSummary,
} from "../../shared/types";

type PullRequestServiceShape = {
  listCached(repoId: string): Effect.Effect<PullRequestSummary[], Error>;
  listOverview(
    accountId: string,
  ): Effect.Effect<OverviewPullRequestSummary[], Error>;
  list(
    repoId: string,
  ): Effect.Effect<PullRequestSummary[], Error>;
  get(
    repoId: string,
    number: number,
  ): Effect.Effect<PullRequestSummary, Error>;
  getPatch(
    repoId: string,
    number: number,
    headSha: string,
  ): Effect.Effect<PrPatch, Error>;
  listChangedFiles(
    repoId: string,
    number: number,
    headSha: string,
  ): Effect.Effect<string[], Error>;
  getFileContents(input: {
    repoId: string;
    number: number;
    oldPath: string;
    newPath: string;
    baseSha: string | null;
    headSha: string;
    changeType: PrFileChangeType;
  }): Effect.Effect<PrFileContents, Error>;
};

class PullRequestService extends Effect.Tag("PullRequestService")<
  PullRequestService,
  PullRequestServiceShape
>() {}

function requireRepoId(repoId: string) {
  const trimmed = repoId.trim();
  if (!trimmed) throw new ValidationError("Repo is required");
  return trimmed;
}

const makePullRequestService = Effect.gen(function* () {
  const cache = yield* CacheService;
  const tokenStore = yield* AuthTokenStore;
  const diffData = yield* DiffDataService;
  const httpClient = yield* HttpClient.HttpClient;

  const provideProviderDeps = <A, E>(
    effect: Effect.Effect<A, E, AuthTokenStore | HttpClient.HttpClient>,
  ) =>
    effect.pipe(
      Effect.provideService(AuthTokenStore, tokenStore),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );

  const listCached: PullRequestServiceShape["listCached"] = Effect.fn(
    "PullRequestService.listCached",
  )(function* (repoId) {
    return yield* cache.readCachedPullRequests(requireRepoId(repoId));
  });

  const listOverview: PullRequestServiceShape["listOverview"] = Effect.fn(
    "PullRequestService.listOverview",
  )(function* (accountId) {
        const trimmedAccountId = accountId.trim();
        if (!trimmedAccountId) throw new ValidationError("Account is required");
        const account = yield* tokenStore.get(trimmedAccountId);
        if (!account) throw new ValidationError("Provider account is not signed in.");
        console.info(
          `[pull-requests] loading overview for ${account.provider} account ${trimmedAccountId}`,
        );
        return yield* provideProviderDeps(
          providerFor(account.provider).listOverviewPullRequests(trimmedAccountId),
        );
  });

  const list: PullRequestServiceShape["list"] = Effect.fn(
    "PullRequestService.list",
  )(function* (repoId) {
        const trimmedRepoId = requireRepoId(repoId);
        const repo = parseRepoId(trimmedRepoId);
        const pullRequests = yield* provideProviderDeps(
          providerFor(repo.provider).listPullRequests(repo),
        );
        yield* cache.writePullRequestsCache(trimmedRepoId, pullRequests);
        yield* cache.updateRepoAccessTimestamp(trimmedRepoId);
        return pullRequests;
  });

  const get: PullRequestServiceShape["get"] = Effect.fn(
    "PullRequestService.get",
  )(function* (repoId, number) {
        const repo = parseRepoId(requireRepoId(repoId));
        return yield* provideProviderDeps(
          providerFor(repo.provider).getPullRequest(repo, number),
        );
  });

  const getPatch: PullRequestServiceShape["getPatch"] = Effect.fn(
    "PullRequestService.getPatch",
  )(function* (repoId, number, headSha) {
    return yield* diffData.getPatch(repoId, number, headSha);
  });

  const listChangedFiles: PullRequestServiceShape["listChangedFiles"] = Effect.fn(
    "PullRequestService.listChangedFiles",
  )(function* (repoId, number, headSha) {
    return yield* diffData.getChangedFiles(repoId, number, headSha);
  });

  const getFileContents: PullRequestServiceShape["getFileContents"] = Effect.fn(
    "PullRequestService.getFileContents",
  )(function* (input) {
    return yield* diffData.getFileContents(input);
  });

  return {
    listCached,
    listOverview,
    list,
    get,
    getPatch,
    listChangedFiles,
    getFileContents,
  } satisfies PullRequestServiceShape;
});

const PullRequestServiceLive = Layer.effect(
  PullRequestService,
  makePullRequestService,
);

export { PullRequestService, PullRequestServiceLive };
