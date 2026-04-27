import { HttpClient } from "@effect/platform";
import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { ValidationError } from "../errors";
import { parseRepoId } from "../repo-id";
import { providerFor } from "../providers/registry";
import { AuthTokenStore } from "../auth/token-store";
import type { PullRequestSummary } from "../../shared/types";

type TrackedPullRequestServiceShape = {
  list(repoId: string): Effect.Effect<PullRequestSummary[], Error>;
  track(
    repoId: string,
    pullRequest: PullRequestSummary,
  ): Effect.Effect<PullRequestSummary, Error>;
  remove(repoId: string, number: number): Effect.Effect<void, Error>;
  refresh(repoId: string): Effect.Effect<PullRequestSummary[], Error>;
};

class TrackedPullRequestService extends Effect.Tag("TrackedPullRequestService")<
  TrackedPullRequestService,
  TrackedPullRequestServiceShape
>() {}

function requireRepoId(repoId: string) {
  const trimmed = repoId.trim();
  if (!trimmed) throw new ValidationError("Repo is required");
  return trimmed;
}

const makeTrackedPullRequestService = Effect.gen(function* () {
  const cache = yield* CacheService;
  const tokenStore = yield* AuthTokenStore;
  const httpClient = yield* HttpClient.HttpClient;

  const provideProviderDeps = <A, E>(
    effect: Effect.Effect<A, E, AuthTokenStore | HttpClient.HttpClient>,
  ) =>
    effect.pipe(
      Effect.provideService(AuthTokenStore, tokenStore),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );

  const list: TrackedPullRequestServiceShape["list"] = Effect.fn(
    "TrackedPullRequestService.list",
  )(function* (repoId) {
    return yield* cache.readTrackedPullRequests(requireRepoId(repoId));
  });

  const track: TrackedPullRequestServiceShape["track"] = Effect.fn(
    "TrackedPullRequestService.track",
  )(function* (repoId, pullRequest) {
        yield* cache.trackPullRequest(requireRepoId(repoId), pullRequest);
        return pullRequest;
  });

  const remove: TrackedPullRequestServiceShape["remove"] = Effect.fn(
    "TrackedPullRequestService.remove",
  )(function* (repoId, number) {
    yield* cache.removeTrackedPullRequest(requireRepoId(repoId), number);
  });

  const refresh: TrackedPullRequestServiceShape["refresh"] = Effect.fn(
    "TrackedPullRequestService.refresh",
  )(function* (repoId) {
        const trimmedRepoId = requireRepoId(repoId);
        const repo = parseRepoId(trimmedRepoId);
        const tracked = yield* cache.readTrackedPullRequests(trimmedRepoId);
        if (tracked.length === 0) return [];

        const provider = providerFor(repo.provider);
        const openPullRequests = yield* provideProviderDeps(provider.listPullRequests(repo));
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
            const verified = yield* provideProviderDeps(
              provider.getPullRequest(repo, pullRequest.number),
            ).pipe(Effect.catchAll(() => Effect.succeed(null)));
            if (verified) {
              yield* cache.trackPullRequest(trimmedRepoId, verified);
            }
          }
        }

        yield* cache.updateRepoAccessTimestamp(trimmedRepoId);
        return yield* cache.readTrackedPullRequests(trimmedRepoId);
  });

  return {
    list,
    track,
    remove,
    refresh,
  } satisfies TrackedPullRequestServiceShape;
});

const TrackedPullRequestServiceLive = Layer.effect(
  TrackedPullRequestService,
  makeTrackedPullRequestService,
);

export { TrackedPullRequestService, TrackedPullRequestServiceLive };
