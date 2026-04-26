import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { ValidationError } from "../errors";
import { parseRepoId } from "../repo-id";
import { providerFor } from "../providers/registry";
import type { PullRequestSummary } from "../../shared/types";

type TrackedPullRequestServiceShape = {
  list(repoId: string): Effect.Effect<PullRequestSummary[], Error, CacheService>;
  track(
    repoId: string,
    pullRequest: PullRequestSummary,
  ): Effect.Effect<PullRequestSummary, Error, CacheService>;
  remove(repoId: string, number: number): Effect.Effect<void, Error, CacheService>;
  refresh(repoId: string): Effect.Effect<PullRequestSummary[], Error, CacheService>;
};

class TrackedPullRequestService extends Effect.Tag("TrackedPullRequestService")<
  TrackedPullRequestService,
  TrackedPullRequestServiceShape
>() {
  static Live = Layer.succeed(this, createTrackedPullRequestService());
}

function requireRepoId(repoId: string) {
  const trimmed = repoId.trim();
  if (!trimmed) throw new ValidationError("Repo is required");
  return trimmed;
}

function createTrackedPullRequestService(): TrackedPullRequestServiceShape {
  return {
    list: (repoId) =>
      Effect.gen(function* () {
        const cache = yield* CacheService;
        return yield* cache.readTrackedPullRequests(requireRepoId(repoId));
      }),

    track: (repoId, pullRequest) =>
      Effect.gen(function* () {
        const cache = yield* CacheService;
        yield* cache.trackPullRequest(requireRepoId(repoId), pullRequest);
        return pullRequest;
      }),

    remove: (repoId, number) =>
      Effect.gen(function* () {
        const cache = yield* CacheService;
        yield* cache.removeTrackedPullRequest(requireRepoId(repoId), number);
      }),

    refresh: (repoId) =>
      Effect.gen(function* () {
        const trimmedRepoId = requireRepoId(repoId);
        const repo = parseRepoId(trimmedRepoId);
        const cache = yield* CacheService;
        const tracked = yield* cache.readTrackedPullRequests(trimmedRepoId);
        if (tracked.length === 0) return [];

        const provider = providerFor(repo.provider);
        const openPullRequests = yield* provider.listPullRequests(repo);
        const openByNumber = new Map(
          openPullRequests.map((pullRequest) => [pullRequest.number, pullRequest]),
        );

        for (const pullRequest of tracked) {
          const openPullRequest = openByNumber.get(pullRequest.number);
          if (openPullRequest) {
            yield* cache.trackPullRequest(trimmedRepoId, openPullRequest);
            continue;
          }

          if (pullRequest.state === "OPEN") {
            const verified = yield* provider.getPullRequest(repo, pullRequest.number).pipe(
              Effect.catchAll(() => Effect.succeed(null)),
            );
            if (verified) {
              yield* cache.trackPullRequest(trimmedRepoId, verified);
            }
          }
        }

        yield* cache.updateRepoAccessTimestamp(trimmedRepoId);
        return yield* cache.readTrackedPullRequests(trimmedRepoId);
      }),
  };
}

export { TrackedPullRequestService };
