import { HttpClient } from "@effect/platform";
import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { ValidationError } from "../errors";
import { createRepoIdentityFromParts } from "../repo-id";
import { providerFor } from "../providers/registry";
import { AuthTokenStore } from "../auth/token-store";
import type { PullRequestSummary, RepoIdentity } from "../../shared/types";

type TrackedPullRequestServiceShape = {
  list(repo: RepoIdentity): Effect.Effect<PullRequestSummary[], Error>;
  track(
    repo: RepoIdentity,
    pullRequest: PullRequestSummary,
  ): Effect.Effect<PullRequestSummary, Error>;
  remove(repo: RepoIdentity, number: number): Effect.Effect<void, Error>;
  refresh(repo: RepoIdentity): Effect.Effect<PullRequestSummary[], Error>;
};

class TrackedPullRequestService extends Effect.Tag("TrackedPullRequestService")<
  TrackedPullRequestService,
  TrackedPullRequestServiceShape
>() {}

function requireRepo(repo: RepoIdentity) {
  if (!repo.providerId.trim() || !repo.repoKey.trim()) {
    throw new ValidationError("Repo is required");
  }
  return repo;
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
  )(function* (repo) {
    return yield* cache.readTrackedPullRequests(requireRepo(repo));
  });

  const track: TrackedPullRequestServiceShape["track"] = Effect.fn(
    "TrackedPullRequestService.track",
  )(function* (repo, pullRequest) {
        yield* cache.trackPullRequest(requireRepo(repo), pullRequest);
        return pullRequest;
  });

  const remove: TrackedPullRequestServiceShape["remove"] = Effect.fn(
    "TrackedPullRequestService.remove",
  )(function* (repo, number) {
    yield* cache.removeTrackedPullRequest(requireRepo(repo), number);
  });

  const refresh: TrackedPullRequestServiceShape["refresh"] = Effect.fn(
    "TrackedPullRequestService.refresh",
  )(function* (repoInput) {
        const repoIdentity = requireRepo(repoInput);
        const repo = createRepoIdentityFromParts(repoIdentity.providerId, repoIdentity.repoKey);
        const tracked = yield* cache.readTrackedPullRequests(repoIdentity);
        if (tracked.length === 0) return [];

        const provider = providerFor(repo.provider);
        const openPullRequests = yield* provideProviderDeps(provider.listPullRequests(repo));
        const openByNumber = new Map(
          openPullRequests.map((pullRequest) => [pullRequest.number, pullRequest]),
        );

        for (const pullRequest of tracked) {
          const openPullRequest = openByNumber.get(pullRequest.number);
          if (openPullRequest) {
            yield* cache.trackPullRequest(repoIdentity, openPullRequest);
            continue;
          }

          if (pullRequest.state === "OPEN") {
            const verified = yield* provideProviderDeps(
              provider.getPullRequest(repo, pullRequest.number),
            ).pipe(Effect.catchAll(() => Effect.succeed(null)));
            if (verified) {
              yield* cache.trackPullRequest(repoIdentity, verified);
            }
          }
        }

        yield* cache.updateRepoAccessTimestamp(repoIdentity);
        return yield* cache.readTrackedPullRequests(repoIdentity);
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
