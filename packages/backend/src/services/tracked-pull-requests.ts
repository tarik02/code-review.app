import { Effect, Layer } from 'effect';
import { CacheService } from '../cache.ts';
import { ValidationError } from '../errors.ts';
import { ForgeProviderRegistry } from '../providers/registry.ts';
import type {
  PullRequestListItem,
  RepoIdentity,
  RepoSummary,
  TrackedPullRequestOrderEntry,
} from '@code-review-app/shared';

type TrackedPullRequestServiceShape = {
  list(repo: RepoIdentity): Effect.Effect<PullRequestListItem[], Error>;
  listRepos(): Effect.Effect<RepoSummary[], Error>;
  getOrder(): Effect.Effect<TrackedPullRequestOrderEntry[], Error>;
  setOrder(
    entries: TrackedPullRequestOrderEntry[],
  ): Effect.Effect<TrackedPullRequestOrderEntry[], Error>;
  track(
    repo: RepoIdentity,
    pullRequest: PullRequestListItem,
  ): Effect.Effect<PullRequestListItem, Error>;
  remove(repo: RepoIdentity, number: number): Effect.Effect<void, Error>;
  refresh(repo: RepoIdentity): Effect.Effect<PullRequestListItem[], Error>;
};

class TrackedPullRequestService extends Effect.Tag('TrackedPullRequestService')<
  TrackedPullRequestService,
  TrackedPullRequestServiceShape
>() {}

function requireRepo(repo: RepoIdentity) {
  if (!repo.providerId.trim() || !repo.repoKey.trim()) {
    throw new ValidationError('Repo is required');
  }
  return repo;
}

const makeTrackedPullRequestService = Effect.gen(function* () {
  const cache = yield* CacheService;
  const providers = yield* ForgeProviderRegistry;

  const resolveTrackedPullRequests = Effect.fn(
    'TrackedPullRequestService.resolveTrackedPullRequests',
  )(function* (repoInput: RepoIdentity) {
    const repoIdentity = requireRepo(repoInput);
    const { provider, repo } = yield* providers.forRepo(repoIdentity);
    const trackedPullRequests = yield* cache.readTrackedPullRequests(repoIdentity);
    if (trackedPullRequests.length === 0) {
      return [];
    }

    const openPullRequests = yield* provider.listPullRequests(repo);
    const openByNumber = new Map(
      openPullRequests.map((pullRequest) => [pullRequest.number, pullRequest]),
    );
    const resolvedTrackedPullRequests = yield* Effect.forEach(
      trackedPullRequests,
      (trackedPullRequest) => {
        const openPullRequest = openByNumber.get(trackedPullRequest.number);
        if (openPullRequest) {
          return Effect.succeed(openPullRequest);
        }

        return provider.getPullRequest(repo, trackedPullRequest.number).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
          Effect.map((pullRequest) => pullRequest),
        );
      },
      { concurrency: 'unbounded' },
    );

    const currentPullRequests = resolvedTrackedPullRequests.filter(
      (pullRequest): pullRequest is PullRequestListItem => pullRequest !== null,
    );

    for (const pullRequest of currentPullRequests) {
      yield* cache.cachePullRequest(repoIdentity, pullRequest);
    }

    yield* cache.updateRepoAccessTimestamp(repoIdentity);
    return currentPullRequests;
  });

  const list: TrackedPullRequestServiceShape['list'] = Effect.fn('TrackedPullRequestService.list')(
    function* (repo) {
      return yield* resolveTrackedPullRequests(repo);
    },
  );

  const listRepos: TrackedPullRequestServiceShape['listRepos'] = Effect.fn(
    'TrackedPullRequestService.listRepos',
  )(function* () {
    return yield* cache.listTrackedRepos();
  });

  const getOrder: TrackedPullRequestServiceShape['getOrder'] = Effect.fn(
    'TrackedPullRequestService.getOrder',
  )(function* () {
    return yield* cache.readTrackedPullRequestOrder();
  });

  const setOrder: TrackedPullRequestServiceShape['setOrder'] = Effect.fn(
    'TrackedPullRequestService.setOrder',
  )(function* (entries) {
    return yield* cache.setTrackedPullRequestOrder(entries);
  });

  const track: TrackedPullRequestServiceShape['track'] = Effect.fn(
    'TrackedPullRequestService.track',
  )(function* (repo, pullRequest) {
    const repoIdentity = requireRepo(repo);
    yield* cache.ensureRepo(repoIdentity);
    yield* cache.trackPullRequest(repoIdentity, pullRequest);
    return pullRequest;
  });

  const remove: TrackedPullRequestServiceShape['remove'] = Effect.fn(
    'TrackedPullRequestService.remove',
  )(function* (repo, number) {
    yield* cache.removeTrackedPullRequest(requireRepo(repo), number);
  });

  const refresh: TrackedPullRequestServiceShape['refresh'] = Effect.fn(
    'TrackedPullRequestService.refresh',
  )(function* (repoInput) {
    return yield* resolveTrackedPullRequests(repoInput);
  });

  return {
    getOrder,
    list,
    listRepos,
    refresh,
    remove,
    setOrder,
    track,
  } satisfies TrackedPullRequestServiceShape;
});

const TrackedPullRequestServiceLive = Layer.effect(
  TrackedPullRequestService,
  makeTrackedPullRequestService,
);

export { TrackedPullRequestService, TrackedPullRequestServiceLive };
