import { Effect, Layer } from 'effect';
import { CacheService } from '../cache.ts';
import { ValidationError } from '../errors.ts';
import { ForgeProviderRegistry } from '../providers/registry.ts';
import { AppSettingsService } from './app-settings.ts';
import { trackedPullRequestOrderEntrySchema } from '@code-review-app/shared';
import type {
  PullRequestSummary,
  RepoIdentity,
  RepoSummary,
  TrackedPullRequestOrderEntry,
} from '@code-review-app/shared';

const TRACKED_PULL_REQUEST_ORDER_KEY = 'tracked.pull_request_order';

type TrackedPullRequestServiceShape = {
  list(repo: RepoIdentity): Effect.Effect<PullRequestSummary[], Error>;
  listRepos(): Effect.Effect<RepoSummary[], Error>;
  getOrder(): Effect.Effect<TrackedPullRequestOrderEntry[], Error>;
  setOrder(
    entries: TrackedPullRequestOrderEntry[],
  ): Effect.Effect<TrackedPullRequestOrderEntry[], Error>;
  track(
    repo: RepoIdentity,
    pullRequest: PullRequestSummary,
  ): Effect.Effect<PullRequestSummary, Error>;
  remove(repo: RepoIdentity, number: number): Effect.Effect<void, Error>;
  refresh(repo: RepoIdentity): Effect.Effect<PullRequestSummary[], Error>;
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

function trackedPullRequestOrderEntryKey(entry: TrackedPullRequestOrderEntry) {
  return `${entry.providerId}:${entry.repoKey}#${entry.number}`;
}

function normalizeTrackedPullRequestOrder(
  entries: TrackedPullRequestOrderEntry[],
): TrackedPullRequestOrderEntry[] {
  const deduped = new Map<string, TrackedPullRequestOrderEntry>();

  for (const entry of entries) {
    const normalized = {
      providerId: entry.providerId.trim(),
      repoKey: entry.repoKey.trim(),
      number: entry.number,
    } satisfies TrackedPullRequestOrderEntry;

    if (!normalized.providerId || !normalized.repoKey) {
      continue;
    }

    const parsed = trackedPullRequestOrderEntrySchema.safeParse(normalized);
    if (!parsed.success) {
      continue;
    }

    const key = trackedPullRequestOrderEntryKey(parsed.data);
    if (!deduped.has(key)) {
      deduped.set(key, parsed.data);
    }
  }

  return [...deduped.values()];
}

const makeTrackedPullRequestService = Effect.gen(function* () {
  const cache = yield* CacheService;
  const appSettings = yield* AppSettingsService;
  const providers = yield* ForgeProviderRegistry;

  const resolveTrackedPullRequests = Effect.fn(
    'TrackedPullRequestService.resolveTrackedPullRequests',
  )(function* (repoInput: RepoIdentity) {
    const repoIdentity = requireRepo(repoInput);
    const { provider, repo } = yield* providers.forRepo(repoIdentity);
    const tracked = yield* cache.readTrackedPullRequests(repoIdentity);
    if (tracked.length === 0) {
      return [];
    }

    const openPullRequests = yield* provider.listPullRequests(repo);
    const openByNumber = new Map(
      openPullRequests.map((pullRequest) => [pullRequest.number, pullRequest]),
    );
    const resolvedTrackedPullRequests = yield* Effect.forEach(
      tracked,
      (trackedPullRequest) => {
        const openPullRequest = openByNumber.get(trackedPullRequest.number);
        if (openPullRequest) {
          return Effect.succeed(openPullRequest);
        }

        return provider
          .getPullRequest(repo, trackedPullRequest.number)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
      },
      { concurrency: 'unbounded' },
    );

    const currentPullRequests = resolvedTrackedPullRequests.filter(
      (pullRequest): pullRequest is PullRequestSummary => pullRequest !== null,
    );

    for (const pullRequest of currentPullRequests) {
      yield* cache.trackPullRequest(repoIdentity, pullRequest);
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
    const persisted =
      (yield* appSettings.read<TrackedPullRequestOrderEntry[]>(TRACKED_PULL_REQUEST_ORDER_KEY)) ??
      [];

    return normalizeTrackedPullRequestOrder(persisted);
  });

  const setOrder: TrackedPullRequestServiceShape['setOrder'] = Effect.fn(
    'TrackedPullRequestService.setOrder',
  )(function* (entries) {
    const normalized = normalizeTrackedPullRequestOrder(entries);
    yield* appSettings.write(TRACKED_PULL_REQUEST_ORDER_KEY, normalized);
    return normalized;
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
