import { matchesPullRequestSearchState } from '../lib/pull-request-search';
import { repoIdentityKey } from '../lib/repo-identity';
import type {
  NamespaceSummary,
  OverviewPullRequestSummary,
  PullRequestSearchState,
  RepoSummary,
} from '../types/forge';

type BrowseNamespaceItem = {
  accountId: string;
  kind: NamespaceSummary['kind'] | 'namespace';
  namespacePath: string;
  providerAccountLabel: string;
  repoCount: number;
};

function buildRepoNamespacePrefixes(nameWithOwner: string) {
  const segments = nameWithOwner.split('/').filter(Boolean);
  if (segments.length < 2) {
    return [];
  }

  const prefixes: string[] = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    prefixes.push(segments.slice(0, index + 1).join('/'));
  }

  return prefixes;
}

function repoMatchesNamespaceFilter(
  repo: Pick<RepoSummary, 'nameWithOwner'>,
  namespacePath: string | null,
) {
  if (!namespacePath) {
    return true;
  }

  return repo.nameWithOwner === namespacePath || repo.nameWithOwner.startsWith(`${namespacePath}/`);
}

function selectBrowseRepos(args: {
  enabledAccountIds: ReadonlySet<string>;
  localPullRequestEntries: OverviewPullRequestSummary[];
  remoteRepos: RepoSummary[];
  savedRepos: RepoSummary[];
  trackedRepos: RepoSummary[];
}) {
  const reposByIdentity = new Map<string, RepoSummary>();

  for (const repo of [
    ...args.trackedRepos,
    ...args.savedRepos,
    ...args.remoteRepos,
    ...args.localPullRequestEntries.map((entry) => entry.repo),
  ]) {
    if (!args.enabledAccountIds.has(repo.providerAccountId)) {
      continue;
    }

    const key = repoIdentityKey(repo);
    if (!reposByIdentity.has(key)) {
      reposByIdentity.set(key, repo);
    }
  }

  return [...reposByIdentity.values()];
}

function selectRepoAccountIdByKey(args: {
  localPullRequestEntries: OverviewPullRequestSummary[];
  pullRequestEntries: OverviewPullRequestSummary[];
  repos: RepoSummary[];
}) {
  const entries = new Map<string, string>();
  for (const repo of [
    ...args.repos,
    ...args.localPullRequestEntries.map((entry) => entry.repo),
    ...args.pullRequestEntries.map((entry) => entry.repo),
  ]) {
    entries.set(repo.repoKey, repo.providerAccountId);
  }
  return Object.fromEntries(entries);
}

function selectBrowseNamespaceItems(args: {
  namespaces: NamespaceSummary[];
  profileFilterAccountId: string | null;
  repos: RepoSummary[];
}) {
  const entries = new Map<string, BrowseNamespaceItem>();

  for (const namespace of args.namespaces) {
    if (
      args.profileFilterAccountId &&
      namespace.providerAccountId !== args.profileFilterAccountId
    ) {
      continue;
    }

    const key = `${namespace.providerAccountId}:${namespace.path}`;
    entries.set(key, {
      accountId: namespace.providerAccountId,
      namespacePath: namespace.path,
      kind: namespace.kind,
      providerAccountLabel: namespace.providerAccountLabel,
      repoCount: 0,
    });
  }

  for (const repo of args.repos) {
    if (args.profileFilterAccountId && repo.providerAccountId !== args.profileFilterAccountId) {
      continue;
    }

    for (const namespacePath of buildRepoNamespacePrefixes(repo.nameWithOwner)) {
      const key = `${repo.providerAccountId}:${namespacePath}`;
      const existing = entries.get(key);
      if (existing) {
        existing.repoCount += 1;
        continue;
      }

      entries.set(key, {
        accountId: repo.providerAccountId,
        namespacePath,
        kind: 'namespace',
        providerAccountLabel: repo.providerAccountLabel,
        repoCount: 1,
      });
    }
  }

  return [...entries.values()].sort((left, right) =>
    left.namespacePath.localeCompare(right.namespacePath),
  );
}

function selectFilteredBrowseRepos(args: {
  namespaceFilterPath: string | null;
  profileFilterAccountId: string | null;
  repoFilterKey: string | null;
  repos: RepoSummary[];
}) {
  return args.repos.filter(
    (repo) =>
      (!args.profileFilterAccountId || repo.providerAccountId === args.profileFilterAccountId) &&
      (!args.repoFilterKey || repo.repoKey === args.repoFilterKey) &&
      repoMatchesNamespaceFilter(repo, args.namespaceFilterPath),
  );
}

function selectBrowsePullRequestEntries(args: {
  hasGlobalPullRequestSearch: boolean;
  hasScopedPullRequestSource: boolean;
  localPullRequestEntries: OverviewPullRequestSummary[];
  remotePullRequestEntries: OverviewPullRequestSummary[];
}) {
  if (args.hasScopedPullRequestSource || args.hasGlobalPullRequestSearch) {
    return args.remotePullRequestEntries;
  }

  return args.localPullRequestEntries;
}

function selectFilteredBrowsePullRequests(args: {
  enabledAccountIds: ReadonlySet<string>;
  namespaceFilterPath: string | null;
  profileFilterAccountId: string | null;
  pullRequestEntries: OverviewPullRequestSummary[];
  pullRequestState: PullRequestSearchState;
  repoFilterKey: string | null;
}) {
  return args.pullRequestEntries.filter(
    (entry) =>
      args.enabledAccountIds.has(entry.repo.providerAccountId) &&
      (!args.profileFilterAccountId ||
        entry.repo.providerAccountId === args.profileFilterAccountId) &&
      (!args.repoFilterKey || entry.repo.repoKey === args.repoFilterKey) &&
      repoMatchesNamespaceFilter(entry.repo, args.namespaceFilterPath) &&
      matchesPullRequestSearchState(entry.pullRequest, args.pullRequestState),
  );
}

export {
  buildRepoNamespacePrefixes,
  repoMatchesNamespaceFilter,
  selectBrowseNamespaceItems,
  selectBrowsePullRequestEntries,
  selectBrowseRepos,
  selectFilteredBrowsePullRequests,
  selectFilteredBrowseRepos,
  selectRepoAccountIdByKey,
};
export type { BrowseNamespaceItem };
