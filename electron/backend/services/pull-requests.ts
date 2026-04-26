import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { ValidationError } from "../errors";
import { parseRepoId } from "../repo-id";
import { providerFor } from "../providers/registry";
import { DiffDataService } from "./diff-data";
import type { PrPatch, PullRequestSummary } from "../../shared/types";

type PullRequestServiceShape = {
  listCached(repoId: string): Effect.Effect<PullRequestSummary[], Error, CacheService>;
  list(repoId: string): Effect.Effect<PullRequestSummary[], Error, CacheService>;
  getPatch(
    repoId: string,
    number: number,
    headSha: string,
  ): Effect.Effect<PrPatch, Error, CacheService | DiffDataService>;
  listChangedFiles(
    repoId: string,
    number: number,
    headSha: string,
  ): Effect.Effect<string[], Error, CacheService | DiffDataService>;
};

class PullRequestService extends Effect.Tag("PullRequestService")<
  PullRequestService,
  PullRequestServiceShape
>() {
  static Live = Layer.succeed(this, createPullRequestService());
}

function requireRepoId(repoId: string) {
  const trimmed = repoId.trim();
  if (!trimmed) throw new ValidationError("Repo is required");
  return trimmed;
}

function createPullRequestService(): PullRequestServiceShape {
  return {
    listCached: (repoId) =>
      Effect.gen(function* () {
        const cache = yield* CacheService;
        return yield* cache.readCachedPullRequests(requireRepoId(repoId));
      }),

    list: (repoId) =>
      Effect.gen(function* () {
        const trimmedRepoId = requireRepoId(repoId);
        const repo = parseRepoId(trimmedRepoId);
        const cache = yield* CacheService;
        const pullRequests = yield* providerFor(repo.provider).listPullRequests(repo);
        yield* cache.writePullRequestsCache(trimmedRepoId, pullRequests);
        yield* cache.updateRepoAccessTimestamp(trimmedRepoId);
        return pullRequests;
      }),

    getPatch: (repoId, number, headSha) =>
      Effect.gen(function* () {
        const diffData = yield* DiffDataService;
        return yield* diffData.getPatch(repoId, number, headSha);
      }),

    listChangedFiles: (repoId, number, headSha) =>
      Effect.gen(function* () {
        const diffData = yield* DiffDataService;
        return yield* diffData.getChangedFiles(repoId, number, headSha);
      }),
  };
}

export { PullRequestService };
