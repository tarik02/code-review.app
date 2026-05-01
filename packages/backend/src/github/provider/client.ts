import { HttpClientRequest } from '@effect/platform';
import { Effect } from 'effect';
import { Buffer } from 'node:buffer';
import type {
  OverviewPullRequestSummary,
  PendingReviewComment,
  PullRequest,
  PullRequestApprovalState,
  PullRequestListItem,
  PullRequestSummary,
  PullRequestSearchState,
  PullRequestQualityFinding,
  PullRequestQualityReport,
  ProviderAuthStatus,
  NamespaceSummary,
  RepoSummary,
  ReviewComment,
  ReviewThread,
} from '@code-review-app/shared';
import { getErrorMessage } from '../../errors.ts';
import {
  createRepoIdentity,
  hostNameFromHost,
  normalizeHost,
  normalizePath,
  type ProviderRepoIdentity,
  parseOwnerRepo,
} from '../../repo-id.ts';
import type {
  ForgeProviderEffectContract,
  PullRequestQualityReportInput,
  ReviewThreadInput,
} from '../../providers/types.ts';
import { GitHubApiClient } from '../client/client.ts';
import { type GitHubClientError, isGitHubClientError } from '../client/errors.ts';
import {
  GitHubProviderClientFailure,
  type GitHubProviderError,
  GitHubProviderInvalidRepoInput,
  GitHubProviderMutationFailed,
  GitHubProviderNoApprovalToRemove,
  GitHubProviderNotAuthenticated,
  GitHubProviderPullRequestNotFound,
  GitHubProviderRepoHostMismatch,
  GitHubProviderUnsupportedOperation,
  GitHubProviderViewerLoginUnavailable,
} from './errors.ts';
import {
  type GhCheckRun,
  type GhCheckRunAnnotation,
  type GhGraphqlRepo,
  type GhPullRequest,
  type GhPullRequestReview,
  type GhRestPullRequest,
  type GhRestRepo,
  type GhSearchRepo,
  GraphQlConversationCommentSchema,
  GraphQlReviewCommentSchema,
} from '../client/schemas.ts';
import { initialRepoAffiliations } from '../client/routes.ts';
import { firstGraphQlErrorMessage, toChangedFile } from './schemas.ts';
import { prepareGitHubProviderImageUrl } from './images.ts';

type UserContext = {
  accountId: string;
  login: string;
  owners: string[];
  fetchedAt: number;
};

const USER_CONTEXT_TTL_MS = 60 * 60 * 1000;

let userContext: UserContext | null = null;

function parseOwnerRepoEffect(value: string) {
  return Effect.try({
    try: () => parseOwnerRepo(value),
    catch: (cause) =>
      new GitHubProviderInvalidRepoInput({
        message: typeof cause === 'string' ? cause : `Enter a repo as owner/name`,
        input: value,
        cause,
      }),
  });
}

function parseGitHubRepoInput(host: string, input: string): [string, string] {
  if (!input.trim()) {
    throw new GitHubProviderInvalidRepoInput({
      message: 'Repo is required',
      input,
      cause: { input },
    });
  }

  try {
    const url = new URL(input);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      const inputHost = normalizeHost(url.origin);
      const segments = url.pathname.split('/').filter(Boolean);
      const owner = segments[0] ?? '';
      const name = (segments[1] ?? '').replace(/\.git$/, '');
      if (!owner || !name) {
        throw new GitHubProviderInvalidRepoInput({
          message: 'Enter a repo as owner/name',
          input,
          cause: { input, owner, name },
        });
      }

      return [inputHost, `${owner}/${name}`];
    }
  } catch (error) {
    if (error instanceof GitHubProviderInvalidRepoInput) {
      throw error;
    }
  }

  const path = normalizePath(input.replace(/\.git$/, ''));
  if (path.split('/').length !== 2) {
    throw new GitHubProviderInvalidRepoInput({
      message: 'Enter a repo as owner/name',
      input,
      cause: { input, path },
    });
  }

  return [normalizeHost(host), path];
}

function encodePath(path: string) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function basicAuthHeader(username: string, password: string) {
  return `AUTHORIZATION: basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function isNotAuthenticatedMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('not logged') ||
    normalized.includes('bad credentials') ||
    normalized.includes('401') ||
    normalized.includes('unauthorized') ||
    normalized.includes('authenticate') ||
    (normalized.includes('github.com') && normalized.includes('login'))
  );
}

const mapProviderError =
  (operation: string) =>
  (error: GitHubProviderError | GitHubClientError): GitHubProviderError =>
    isGitHubClientError(error)
      ? new GitHubProviderClientFailure({
          message: error.message,
          operation,
          cause: error,
        })
      : error;

const providerEffect = <Args extends ReadonlyArray<unknown>, Success>(
  name: string,
  operation: string,
  effect: (...args: Args) => Generator<any, Success, any>,
): ((...args: Args) => Effect.Effect<Success, GitHubProviderError, GitHubApiClient>) =>
  Effect.fn(name)((...args: Args) =>
    (
      Effect.gen(function* () {
        return yield* effect(...args);
      }) as Effect.Effect<Success, GitHubClientError | GitHubProviderError, GitHubApiClient>
    ).pipe(
      Effect.mapError((error: GitHubClientError | GitHubProviderError) =>
        mapProviderError(operation)(error),
      ),
    ),
  );

function toGitHubReviewComment(
  comment: typeof GraphQlReviewCommentSchema.Type | typeof GraphQlConversationCommentSchema.Type,
): ReviewComment {
  return {
    id: comment.id,
    databaseId: comment.databaseId ?? null,
    authorLogin: comment.author?.login ?? 'unknown',
    authorAvatarUrl: comment.author?.avatarUrl ?? comment.author?.avatar_url ?? null,
    authorAssociation: comment.authorAssociation ?? null,
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    url: comment.url,
    replyToId: 'replyTo' in comment ? (comment.replyTo?.id ?? null) : null,
  };
}

function repoSummaryFromSearch(
  accountId: string,
  host: string,
  label: string,
  repo: GhSearchRepo,
): RepoSummary {
  return {
    ...createRepoIdentity('github', host, accountId, repo.full_name),
    provider: 'github',
    host,
    providerAccountId: accountId,
    providerAccountLabel: label,
    name: repo.name,
    nameWithOwner: repo.full_name,
    description: repo.description,
    isPrivate: repo.private,
    avatarUrl: prepareGitHubProviderImageUrl(repo.owner?.avatarUrl ?? repo.owner?.avatar_url, {
      host,
      nameWithOwner: repo.full_name,
    }),
  };
}

function repoSummaryFromRest(
  accountId: string,
  host: string,
  label: string,
  repo: GhRestRepo,
): RepoSummary {
  return {
    ...createRepoIdentity('github', host, accountId, repo.full_name),
    provider: 'github',
    host,
    providerAccountId: accountId,
    providerAccountLabel: label,
    name: repo.name,
    nameWithOwner: repo.full_name,
    description: repo.description,
    isPrivate: repo.private,
    avatarUrl: prepareGitHubProviderImageUrl(repo.owner?.avatarUrl ?? repo.owner?.avatar_url, {
      host,
      nameWithOwner: repo.full_name,
    }),
  };
}

function repoSummaryFromGraphql(
  accountId: string,
  host: string,
  label: string,
  repo: GhGraphqlRepo,
): RepoSummary {
  return {
    ...createRepoIdentity('github', host, accountId, repo.nameWithOwner),
    provider: 'github',
    host,
    providerAccountId: accountId,
    providerAccountLabel: label,
    name: repo.name,
    nameWithOwner: repo.nameWithOwner,
    description: repo.description,
    isPrivate: repo.isPrivate,
    avatarUrl: prepareGitHubProviderImageUrl(repo.owner?.avatarUrl ?? repo.owner?.avatar_url, {
      host,
      nameWithOwner: repo.nameWithOwner,
    }),
  };
}

function labelForToken(token: { viewerLogin: string | null; host: string }) {
  return token.viewerLogin ? `${token.viewerLogin} @ ${token.host}` : token.host;
}

const PULL_REQUEST_SEARCH_SCOPE_QUALIFIERS = ['author', 'assignee', 'review-requested'] as const;

function buildPullRequestSearchQuery(query: string, states: PullRequestSearchState, scope: string) {
  const qualifiers = ['is:pr', 'archived:false', 'in:title', scope, 'sort:updated-desc'];
  if (states !== 'all') {
    qualifiers.push('is:open');
  }

  const trimmedQuery = query.trim();
  return trimmedQuery ? `${qualifiers.join(' ')} ${trimmedQuery}` : qualifiers.join(' ');
}

function parseGitHubPullRequestUrl(input: string, expectedHost: string) {
  try {
    const url = new URL(input);
    if (url.hostname.toLowerCase() !== hostNameFromHost(expectedHost)) {
      return null;
    }

    const [owner, name, kind, numberValue] = url.pathname.split('/').filter(Boolean);
    if (!owner || !name || kind !== 'pull') {
      return null;
    }

    const number = Number.parseInt(numberValue ?? '', 10);
    if (!Number.isSafeInteger(number) || number < 0) {
      return null;
    }

    return { owner, name, number };
  } catch {
    return null;
  }
}

function dedupePullRequestSearchEntries(entries: ReadonlyArray<OverviewPullRequestSummary>) {
  const deduped = new Map<string, OverviewPullRequestSummary>();
  for (const entry of entries) {
    deduped.set(`${entry.repo.nameWithOwner}#${entry.pullRequest.number}`, entry);
  }

  return [...deduped.values()].sort(
    (left, right) =>
      Date.parse(right.pullRequest.updatedAt) - Date.parse(left.pullRequest.updatedAt),
  );
}

function filterSearchPullRequestsByState(
  entries: OverviewPullRequestSummary[],
  states: PullRequestSearchState,
) {
  if (states !== 'open') {
    return entries;
  }

  return entries.filter(
    (entry) => entry.pullRequest.state === 'OPEN' && !entry.pullRequest.isDraft,
  );
}

function toPullRequestSummary(pullRequest: GhPullRequest) {
  const merged = pullRequest.mergedAt != null;
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    state: merged ? 'MERGED' : pullRequest.state,
    isDraft: pullRequest.isDraft,
    mergeStateStatus: pullRequest.mergeStateStatus ?? 'UNKNOWN',
    mergeable: pullRequest.mergeable ?? 'UNKNOWN',
    additions: pullRequest.additions ?? null,
    deletions: pullRequest.deletions ?? null,
    changeCount: null,
    authorLogin: pullRequest.author?.login ?? 'unknown',
    updatedAt: pullRequest.updatedAt,
    headSha: pullRequest.headRefOid,
    baseSha: pullRequest.baseRefOid ?? null,
  };
}

function withGitHubReviewCapabilities(
  pullRequest: PullRequestSummary,
  viewerLogin: string | null,
): PullRequest {
  const isOwnPullRequest =
    viewerLogin != null && viewerLogin.length > 0 && pullRequest.authorLogin === viewerLogin;

  return {
    ...pullRequest,
    canApprove: !isOwnPullRequest,
    canRequestChanges: !isOwnPullRequest,
  };
}

function toPullRequestSummaryFromRest(pullRequest: GhRestPullRequest) {
  const merged = pullRequest.merged_at != null;
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    state: merged ? 'MERGED' : pullRequest.state.toUpperCase(),
    isDraft: pullRequest.draft ?? false,
    mergeStateStatus: 'UNKNOWN',
    mergeable: 'UNKNOWN',
    additions: pullRequest.additions ?? null,
    deletions: pullRequest.deletions ?? null,
    changeCount: null,
    authorLogin: pullRequest.user?.login ?? 'unknown',
    updatedAt: pullRequest.updated_at,
    headSha: pullRequest.head.sha,
    baseSha: pullRequest.base.sha,
  };
}

function toOverviewPullRequestSummary(
  repo: OverviewPullRequestSummary['repo'],
  pullRequest: PullRequestListItem,
): OverviewPullRequestSummary {
  return {
    repo,
    pullRequest,
  };
}

function toApprovalActor(review: GhPullRequestReview) {
  return {
    login: review.user?.login ?? 'unknown',
    name: review.user?.login ?? 'unknown',
    avatarUrl: review.user?.avatarUrl ?? review.user?.avatar_url ?? null,
    url: review.user?.html_url ?? review.user?.url ?? null,
    approvedAt: review.submitted_at ?? null,
  } satisfies PullRequestApprovalState['approvedBy'][number];
}

function latestReviewsByLogin(reviews: GhPullRequestReview[]) {
  const latestByLogin = new Map<string, GhPullRequestReview>();

  for (const review of reviews) {
    const login = review.user?.login?.trim();
    const submittedAt = review.submitted_at;
    if (!login || !submittedAt) {
      continue;
    }

    const previous = latestByLogin.get(login);
    if (!previous) {
      latestByLogin.set(login, review);
      continue;
    }

    const previousSubmittedAt = previous.submitted_at;
    if (!previousSubmittedAt || Date.parse(submittedAt) >= Date.parse(previousSubmittedAt)) {
      latestByLogin.set(login, review);
    }
  }

  return latestByLogin;
}

function unixTimestampSeconds(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Math.floor(Date.now() / 1000) : Math.floor(parsed / 1000);
}

function githubQualitySeverity(level: string): PullRequestQualityFinding['severity'] {
  switch (level.toLowerCase()) {
    case 'failure':
      return 'major';
    case 'warning':
      return 'warning';
    case 'notice':
      return 'info';
    default:
      return 'unknown';
  }
}

function githubQualityStatus(checkRuns: GhCheckRun[]) {
  if (checkRuns.some((checkRun) => checkRun.status !== 'completed')) {
    return 'pending' as const;
  }

  const conclusions = checkRuns
    .map((checkRun) => checkRun.conclusion?.toLowerCase() ?? '')
    .filter((conclusion) => conclusion.length > 0);

  if (
    conclusions.some((conclusion) =>
      ['action_required', 'failure', 'startup_failure', 'timed_out'].includes(conclusion),
    )
  ) {
    return 'failed' as const;
  }

  if (
    conclusions.some((conclusion) =>
      ['cancelled', 'neutral', 'skipped', 'stale'].includes(conclusion),
    )
  ) {
    return 'warning' as const;
  }

  return 'ok' as const;
}

function githubCheckRunStatusCounts(checkRuns: GhCheckRun[]) {
  const statusCounts: Record<string, number> = {};

  for (const checkRun of checkRuns) {
    const key = (checkRun.conclusion ?? checkRun.status).toLowerCase();
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }

  return statusCounts;
}

function githubCheckRunSourceName(checkRun: GhCheckRun) {
  const appName = checkRun.app?.name?.trim();
  return appName && appName !== checkRun.name ? `${appName} · ${checkRun.name}` : checkRun.name;
}

function toGitHubQualityFinding(
  checkRun: GhCheckRun,
  annotation: GhCheckRunAnnotation,
  index: number,
): PullRequestQualityFinding {
  const title = annotation.title?.trim() || annotation.message.trim();
  const message =
    annotation.raw_details?.trim() ||
    (annotation.title?.trim() ? annotation.message.trim() : undefined);

  return {
    id: `${checkRun.id}:${index}:${annotation.path}:${annotation.start_line}`,
    sourceType: 'github-check',
    sourceName: githubCheckRunSourceName(checkRun),
    severity: githubQualitySeverity(annotation.annotation_level),
    status: 'unknown',
    title,
    message,
    path: annotation.path,
    line: annotation.start_line,
    endLine: annotation.end_line ?? null,
    anchorState: annotation.path.trim() ? 'inline' : 'unmapped',
    externalUrl: checkRun.details_url ?? checkRun.html_url ?? undefined,
    rawCategory: annotation.annotation_level,
  };
}

function makeGitHubProvider(): ForgeProviderEffectContract<GitHubApiClient, GitHubProviderError> {
  const authorizeRequest: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['authorizeRequest'] = providerEffect(
    'GitHubProvider.authorizeRequest',
    'authorizeRequest',
    function* () {
      const api = yield* GitHubApiClient;
      const token = yield* api.accessToken();
      return (request: HttpClientRequest.HttpClientRequest) =>
        request.pipe(
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.setHeader('User-Agent', 'code-review.app'),
        );
    },
  );

  const validateImageUrl: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['validateImageUrl'] = providerEffect(
    'GitHubProvider.validateImageUrl',
    'validateImageUrl',
    function* (url: string) {
      const api = yield* GitHubApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return false;
      }

      try {
        return new URL(url).hostname.toLowerCase() === hostNameFromHost(token.host);
      } catch {
        return false;
      }
    },
  );

  const ensureUserContext = providerEffect(
    'GitHubProvider.ensureUserContext',
    'ensureUserContext',
    function* () {
      const api = yield* GitHubApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitHubProviderNotAuthenticated({
            message: 'GitHub is not signed in.',
            cause: { provider: 'github', operation: 'ensureUserContext' },
          }),
        );
      }

      if (
        userContext &&
        userContext.accountId === token.id &&
        Date.now() - userContext.fetchedAt < USER_CONTEXT_TTL_MS
      ) {
        return userContext.owners;
      }

      const user = yield* api.user();
      const owners = [user.login];
      const orgs = yield* api
        .userOrgs({ perPage: 100 })
        .pipe(Effect.catchAll(() => Effect.succeed([])));
      for (const org of orgs) {
        if (org.login.trim().length > 0) {
          owners.push(org.login);
        }
      }

      userContext = {
        accountId: token.id,
        login: user.login,
        owners,
        fetchedAt: Date.now(),
      };

      return owners;
    },
  );

  const viewerLogin: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['viewerLogin'] = providerEffect('GitHubProvider.viewerLogin', 'viewerLogin', function* () {
    const api = yield* GitHubApiClient;
    const token = yield* api.storedToken();
    if (!token) {
      return yield* Effect.fail(
        new GitHubProviderNotAuthenticated({
          message: 'GitHub is not signed in.',
          cause: { provider: 'github', operation: 'viewerLogin' },
        }),
      );
    }

    yield* ensureUserContext();
    const login = userContext?.login;
    if (!login) {
      return yield* Effect.fail(
        new GitHubProviderViewerLoginUnavailable({
          message: 'Unable to determine GitHub viewer login',
          cause: { provider: 'github', operation: 'viewerLogin' },
        }),
      );
    }

    return login;
  });

  const authStatus: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['authStatus'] = Effect.fn('GitHubProvider.authStatus')(function* () {
    const api = yield* GitHubApiClient;
    return yield* Effect.gen(function* () {
      const token = yield* api.storedToken();
      if (!token) {
        return {
          status: 'not_authenticated',
          message: 'Sign in with GitHub to load repositories.',
        } satisfies ProviderAuthStatus;
      }

      yield* viewerLogin();
      return { status: 'ready', message: null } satisfies ProviderAuthStatus;
    }).pipe(
      Effect.catchAll((error) => {
        const message = error instanceof Error ? error.message : String(error);
        return Effect.logWarning('[github] auth status check failed').pipe(
          Effect.annotateLogs({
            message,
            error: getErrorMessage(error),
          }),
          Effect.zipRight(
            Effect.succeed(
              isNotAuthenticatedMessage(message)
                ? ({
                    status: 'not_authenticated',
                    message: 'Sign in with GitHub again.',
                  } satisfies ProviderAuthStatus)
                : ({
                    status: 'unknown_error',
                    message,
                  } satisfies ProviderAuthStatus),
            ),
          ),
        );
      }),
    );
  });

  const listInitialRepos: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['listInitialRepos'] = providerEffect(
    'GitHubProvider.listInitialRepos',
    'listInitialRepos',
    function* (limit: number) {
      const api = yield* GitHubApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitHubProviderNotAuthenticated({
            message: 'GitHub is not signed in.',
            cause: { provider: 'github', operation: 'listInitialRepos' },
          }),
        );
      }

      const label = labelForToken(token);
      const repos = yield* api.userRepos({
        perPage: limit,
        sort: 'updated',
        affiliation: initialRepoAffiliations,
      });

      return repos.map((repo) => repoSummaryFromRest(token.id, token.host, label, repo));
    },
  );

  const searchRepos: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['searchRepos'] = providerEffect(
    'GitHubProvider.searchRepos',
    'searchRepos',
    function* (query: string, limit: number) {
      const api = yield* GitHubApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitHubProviderNotAuthenticated({
            message: 'GitHub is not signed in.',
            cause: { provider: 'github', operation: 'searchRepos' },
          }),
        );
      }

      const label = labelForToken(token);
      if (query.length === 0) {
        return yield* listInitialRepos(limit);
      }

      const owners = yield* ensureUserContext();
      const repos: GhSearchRepo[] = [];
      const normalizedQuery = query.trim().toLowerCase();
      for (const owner of owners) {
        const qualifier = owner === userContext?.login ? 'user' : 'org';
        const ownerMatchesQuery = owner.toLowerCase() === normalizedQuery;
        const response = yield* api.searchRepositories({
          query: ownerMatchesQuery
            ? `${qualifier}:${owner}`
            : `${query} in:name ${qualifier}:${owner}`,
          perPage: limit,
        });
        repos.push(...response.items);
        if (repos.length >= limit) {
          break;
        }
      }

      const seen = new Set<string>();
      return repos.flatMap((repo) => {
        if (seen.has(repo.full_name) || seen.size >= limit) {
          return [];
        }

        seen.add(repo.full_name);
        return [repoSummaryFromSearch(token.id, token.host, label, repo)];
      });
    },
  );

  const listNamespaceRepos: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['listNamespaceRepos'] = providerEffect(
    'GitHubProvider.listNamespaceRepos',
    'listNamespaceRepos',
    function* (namespacePath: string, limit: number) {
      return yield* searchRepos(namespacePath, limit);
    },
  );

  const searchNamespaces: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['searchNamespaces'] = providerEffect(
    'GitHubProvider.searchNamespaces',
    'searchNamespaces',
    function* (query: string, limit: number) {
      const api = yield* GitHubApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitHubProviderNotAuthenticated({
            message: 'GitHub is not signed in.',
            cause: { provider: 'github', operation: 'searchNamespaces' },
          }),
        );
      }

      const label = labelForToken(token);
      yield* ensureUserContext();
      const login = userContext?.login;
      const owners = userContext?.owners ?? [];
      const normalizedQuery = query.trim().toLowerCase();

      return owners
        .filter((owner) => !normalizedQuery || owner.toLowerCase().includes(normalizedQuery))
        .slice(0, limit)
        .map(
          (owner) =>
            ({
              provider: 'github',
              host: token.host,
              providerAccountId: token.id,
              providerAccountLabel: label,
              path: owner,
              name: owner,
              kind: owner === login ? 'user' : 'organization',
              avatarUrl: null,
              webUrl: `https://${token.host}/${owner}`,
            }) satisfies NamespaceSummary,
        );
    },
  );

  const validateRepo: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['validateRepo'] = providerEffect(
    'GitHubProvider.validateRepo',
    'validateRepo',
    function* (input: string) {
      const api = yield* GitHubApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitHubProviderNotAuthenticated({
            message: 'GitHub is not signed in.',
            cause: { provider: 'github', operation: 'validateRepo' },
          }),
        );
      }

      const label = labelForToken(token);
      const [validatedHost, repo] = parseGitHubRepoInput(token.host, input);
      if (validatedHost !== token.host) {
        return yield* Effect.fail(
          new GitHubProviderRepoHostMismatch({
            message: 'Repo URL host must match the selected GitHub account.',
            expectedHost: token.host,
            actualHost: validatedHost,
            cause: {
              input,
              expectedHost: token.host,
              actualHost: validatedHost,
            },
          }),
        );
      }

      const [owner, name] = yield* parseOwnerRepoEffect(repo);
      const details = yield* api.repo(owner, name);
      return repoSummaryFromRest(token.id, token.host, label, details);
    },
  );

  const listOverviewPullRequests: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['listOverviewPullRequests'] = providerEffect(
    'GitHubProvider.listOverviewPullRequests',
    'listOverviewPullRequests',
    function* () {
      const api = yield* GitHubApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitHubProviderNotAuthenticated({
            message: 'GitHub is not signed in.',
            cause: {
              provider: 'github',
              operation: 'listOverviewPullRequests',
            },
          }),
        );
      }

      const label = labelForToken(token);
      yield* ensureUserContext();
      const login = userContext?.login;
      if (!login) {
        return yield* Effect.fail(
          new GitHubProviderViewerLoginUnavailable({
            message: 'Unable to determine GitHub viewer login',
            cause: {
              provider: 'github',
              operation: 'listOverviewPullRequests',
            },
          }),
        );
      }

      const response = yield* api.searchPullRequests(
        `is:pr is:open archived:false involves:${login} sort:updated-desc`,
        100,
      );

      return (response.data?.search?.nodes ?? []).flatMap((pullRequest) => {
        const repo = pullRequest?.repository;
        if (!pullRequest || !repo) {
          return [];
        }

        return [
          toOverviewPullRequestSummary(
            repoSummaryFromGraphql(token.id, token.host, label, repo),
            toPullRequestSummary(pullRequest),
          ),
        ];
      });
    },
  );

  const listPullRequests: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['listPullRequests'] = providerEffect(
    'GitHubProvider.listPullRequests',
    'listPullRequests',
    function* (repo: ProviderRepoIdentity) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const pullRequests = yield* api.repositoryOpenPullRequests(owner, name);
      return pullRequests.map((pullRequest) => toPullRequestSummaryFromRest(pullRequest));
    },
  );

  const searchPullRequests: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['searchPullRequests'] = providerEffect(
    'GitHubProvider.searchPullRequests',
    'searchPullRequests',
    function* (query, limit, states) {
      const api = yield* GitHubApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitHubProviderNotAuthenticated({
            message: 'GitHub is not signed in.',
            cause: { provider: 'github', operation: 'searchPullRequests' },
          }),
        );
      }

      const label = labelForToken(token);
      yield* ensureUserContext();
      const login = userContext?.login;
      if (!login) {
        return yield* Effect.fail(
          new GitHubProviderViewerLoginUnavailable({
            message: 'Unable to determine GitHub viewer login',
            cause: { provider: 'github', operation: 'searchPullRequests' },
          }),
        );
      }

      const directPullRequest = parseGitHubPullRequestUrl(query, token.host);
      if (directPullRequest) {
        const repo = yield* api.repo(directPullRequest.owner, directPullRequest.name);
        const response = yield* api.repositoryPullRequest(
          directPullRequest.owner,
          directPullRequest.name,
          directPullRequest.number,
        );
        const pullRequest = response.data?.repository?.pullRequest;
        if (!pullRequest) {
          return [];
        }

        return [
          toOverviewPullRequestSummary(
            repoSummaryFromRest(token.id, token.host, label, repo),
            toPullRequestSummary(pullRequest),
          ),
        ];
      }

      const scopedEntries = yield* Effect.forEach(
        PULL_REQUEST_SEARCH_SCOPE_QUALIFIERS,
        (qualifier) =>
          api
            .searchPullRequests(
              buildPullRequestSearchQuery(query, states, `${qualifier}:${login}`),
              limit,
            )
            .pipe(
              Effect.map((response) =>
                (response.data?.search?.nodes ?? []).flatMap((pullRequest) => {
                  const repo = pullRequest?.repository;
                  if (!pullRequest || !repo) {
                    return [];
                  }

                  return [
                    toOverviewPullRequestSummary(
                      repoSummaryFromGraphql(token.id, token.host, label, repo),
                      toPullRequestSummary(pullRequest),
                    ),
                  ];
                }),
              ),
            ),
        { concurrency: 'unbounded' },
      );

      return filterSearchPullRequestsByState(
        dedupePullRequestSearchEntries(scopedEntries.flat()),
        states,
      ).slice(0, limit);
    },
  );

  const getPullRequest: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['getPullRequest'] = providerEffect(
    'GitHubProvider.getPullRequest',
    'getPullRequest',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      yield* ensureUserContext();
      const login = userContext?.login ?? null;
      const response = yield* api.repositoryPullRequest(owner, name, number);
      const pullRequest = response.data?.repository?.pullRequest;
      if (!pullRequest) {
        return yield* Effect.fail(
          new GitHubProviderPullRequestNotFound({
            message: `Pull request #${number} not found`,
            number,
            cause: response,
          }),
        );
      }

      return withGitHubReviewCapabilities(toPullRequestSummary(pullRequest), login);
    },
  );

  const getPullRequestApprovalState: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['getPullRequestApprovalState'] = providerEffect(
    'GitHubProvider.getPullRequestApprovalState',
    'getPullRequestApprovalState',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const currentViewerLogin = yield* viewerLogin();
      const reviews: GhPullRequestReview[] = [];
      let page = 1;

      while (true) {
        const pageReviews = yield* api.pullRequestReviews({
          owner,
          name,
          number,
          perPage: 100,
          page,
        });
        if (pageReviews.length === 0) {
          break;
        }

        reviews.push(...pageReviews);
        if (pageReviews.length < 100) {
          break;
        }

        page += 1;
      }

      const latestByLogin = latestReviewsByLogin(reviews);
      const approvedBy = [...latestByLogin.values()]
        .filter((review) => review.state.toUpperCase() === 'APPROVED')
        .sort(
          (left, right) =>
            Date.parse(right.submitted_at ?? '') - Date.parse(left.submitted_at ?? ''),
        )
        .map(toApprovalActor);

      return {
        provider: 'github',
        approvedBy,
        viewerApproved: approvedBy.some((approval) => approval.login === currentViewerLogin),
        viewerRemoveStrategy: 'dismiss',
        approvalsRequired: null,
        approvalsLeft: null,
      } satisfies PullRequestApprovalState;
    },
  );

  const approvePullRequest: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['approvePullRequest'] = providerEffect(
    'GitHubProvider.approvePullRequest',
    'approvePullRequest',
    function* (repo: ProviderRepoIdentity, number: number, headSha: string) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      yield* api.createPullRequestReview({
        owner,
        name,
        number,
        commitId: headSha,
        event: 'APPROVE',
      });
    },
  );

  const removePullRequestApproval: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['removePullRequestApproval'] = providerEffect(
    'GitHubProvider.removePullRequestApproval',
    'removePullRequestApproval',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const currentViewerLogin = yield* viewerLogin();
      const reviews: GhPullRequestReview[] = [];
      let page = 1;

      while (true) {
        const pageReviews = yield* api.pullRequestReviews({
          owner,
          name,
          number,
          perPage: 100,
          page,
        });
        if (pageReviews.length === 0) {
          break;
        }

        reviews.push(...pageReviews);
        if (pageReviews.length < 100) {
          break;
        }

        page += 1;
      }

      const latestViewerReview = latestReviewsByLogin(reviews).get(currentViewerLogin);
      if (!latestViewerReview || latestViewerReview.state.toUpperCase() !== 'APPROVED') {
        return yield* Effect.fail(
          new GitHubProviderNoApprovalToRemove({
            message: 'No viewer approval to remove.',
            number,
            viewerLogin: currentViewerLogin,
            cause: { number, viewerLogin: currentViewerLogin },
          }),
        );
      }

      yield* api.dismissPullRequestReview({
        owner,
        name,
        number,
        reviewId: latestViewerReview.id,
        message: 'Approval removed from desktop review app.',
      });
    },
  );

  const fetchPatch: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['fetchPatch'] = providerEffect(
    'GitHubProvider.fetchPatch',
    'fetchPatch',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      return yield* api.pullRequestPatch(owner, name, number);
    },
  );

  const fetchChangedFiles: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['fetchChangedFiles'] = providerEffect(
    'GitHubProvider.fetchChangedFiles',
    'fetchChangedFiles',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const seen = new Set<string>();
      const files: ReturnType<typeof toChangedFile>[] = [];
      let page = 1;
      let shouldContinue = true;

      while (shouldContinue) {
        const items = yield* api.pullRequestFiles({
          owner,
          name,
          number,
          perPage: 100,
          page,
        });
        if (items.length === 0) {
          shouldContinue = false;
        } else {
          for (const item of items) {
            const file = toChangedFile(item);
            if (!seen.has(file.path)) {
              seen.add(file.path);
              files.push(file);
            }
          }

          page += 1;
        }
      }

      return files;
    },
  );

  const fetchPullRequestRefs: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['fetchPullRequestRefs'] = providerEffect(
    'GitHubProvider.fetchPullRequestRefs',
    'fetchPullRequestRefs',
    function* (repo: ProviderRepoIdentity, number: number) {
      const pullRequest = yield* getPullRequest(repo, number);
      return {
        baseSha: pullRequest.baseSha,
        headSha: pullRequest.headSha,
      };
    },
  );

  const fetchFileContent: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['fetchFileContent'] = providerEffect(
    'GitHubProvider.fetchFileContent',
    'fetchFileContent',
    function* (repo: ProviderRepoIdentity, path: string, ref: string) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      return yield* api.repoContent({
        owner,
        name,
        path: encodePath(path),
        ref,
      });
    },
  );

  const getPullRequestQualityReport: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['getPullRequestQualityReport'] = providerEffect(
    'GitHubProvider.getPullRequestQualityReport',
    'getPullRequestQualityReport',
    function* (input: PullRequestQualityReportInput) {
      const api = yield* GitHubApiClient;
      const { repo, number, headSha } = input;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const checkRuns: GhCheckRun[] = [];
      let page = 1;

      while (true) {
        const response = yield* api.commitCheckRuns({
          owner,
          name,
          headSha,
          perPage: 100,
          page,
        });
        if (response.check_runs.length === 0) {
          break;
        }

        checkRuns.push(...response.check_runs);
        if (response.check_runs.length < 100) {
          break;
        }

        page += 1;
      }

      const findings: PullRequestQualityFinding[] = [];
      const notes: string[] = [];
      const maxFindings = 500;

      for (const checkRun of checkRuns) {
        const expectedAnnotations = checkRun.output?.annotations_count ?? 0;
        if (expectedAnnotations <= 0 || findings.length >= maxFindings) {
          continue;
        }

        let annotationPage = 1;
        let shouldContinue = true;

        while (shouldContinue && findings.length < maxFindings) {
          const annotations = yield* api
            .checkRunAnnotations({
              owner,
              name,
              checkRunId: checkRun.id,
              perPage: 100,
              page: annotationPage,
            })
            .pipe(
              Effect.catchAll((error) => {
                notes.push(
                  `Could not load annotations for ${githubCheckRunSourceName(checkRun)}: ${error.message}`,
                );
                return Effect.succeed([]);
              }),
            );

          if (annotations.length === 0) {
            shouldContinue = false;
            continue;
          }

          const remainingCapacity = maxFindings - findings.length;
          findings.push(
            ...annotations
              .slice(0, remainingCapacity)
              .map((annotation, index) =>
                toGitHubQualityFinding(checkRun, annotation, (annotationPage - 1) * 100 + index),
              ),
          );

          shouldContinue = annotations.length === 100;
          annotationPage += 1;
        }
      }

      if (findings.length >= maxFindings) {
        notes.push(`Showing the first ${maxFindings} check annotations.`);
      }

      const statusCounts = githubCheckRunStatusCounts(checkRuns);
      const detailsUrl =
        checkRuns.find((checkRun) =>
          ['action_required', 'failure', 'startup_failure', 'timed_out'].includes(
            checkRun.conclusion?.toLowerCase() ?? '',
          ),
        )?.details_url ??
        checkRuns.find((checkRun) => checkRun.status !== 'completed')?.details_url ??
        checkRuns[0]?.details_url ??
        undefined;

      return {
        provider: 'github',
        repoKey: repo.repoKey,
        number,
        headSha,
        status: githubQualityStatus(checkRuns),
        summary: {
          totalFindings: findings.length,
          inlineFindings: findings.filter(
            (finding) => finding.anchorState === 'inline' && finding.line !== null,
          ).length,
          fileOnlyFindings: findings.filter((finding) => finding.anchorState === 'file').length,
          statusCounts,
          providerLabel: 'GitHub checks',
          detailsUrl,
          notes: notes.length > 0 ? notes : undefined,
        },
        findings,
        fetchedAt: new Date().toISOString(),
        sourceMetadata: {
          checkRunCount: checkRuns.length,
          headSha,
        },
      } satisfies PullRequestQualityReport;
    },
  );

  const gitRemote: ForgeProviderEffectContract<GitHubApiClient, GitHubProviderError>['gitRemote'] =
    providerEffect('GitHubProvider.gitRemote', 'gitRemote', function* (repo: ProviderRepoIdentity) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const token = yield* api.accessToken();
      return {
        url: `${repo.host}/${owner}/${name}.git`,
        auth: {
          envConfig: [
            {
              key: `http.${repo.host}/.extraheader`,
              value: basicAuthHeader('x-access-token', token),
            },
          ],
        },
      };
    });

  const listReviewThreads: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['listReviewThreads'] = providerEffect(
    'GitHubProvider.listReviewThreads',
    'listReviewThreads',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const response = yield* api.reviewThreads(owner, name, number);
      const pullRequest = response.data?.repository?.pullRequest;

      const reviewThreads = (pullRequest?.reviewThreads.nodes ?? []).flatMap(
        (thread): ReviewThread[] => {
          if (thread.comments.nodes.length === 0) {
            return [];
          }

          const comments = thread.comments.nodes.map(toGitHubReviewComment);
          return [
            {
              id: thread.id,
              provider: 'github',
              path: thread.path,
              canResolve: true,
              isResolved: thread.isResolved,
              isOutdated: thread.isOutdated,
              line: thread.line ?? thread.originalLine ?? null,
              startLine: thread.startLine ?? thread.originalStartLine ?? null,
              side: thread.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT',
              startSide:
                thread.startDiffSide === 'LEFT' || thread.startDiffSide === 'RIGHT'
                  ? thread.startDiffSide
                  : null,
              subjectType: thread.subjectType.toLowerCase() === 'file' ? 'file' : 'line',
              comments,
            },
          ];
        },
      );

      const globalThreads = (pullRequest?.comments.nodes ?? []).map(
        (comment): ReviewThread => ({
          id: comment.id,
          provider: 'github',
          path: '',
          canResolve: false,
          isResolved: false,
          isOutdated: false,
          line: null,
          startLine: null,
          side: null,
          startSide: null,
          subjectType: 'global',
          comments: [toGitHubReviewComment(comment)],
        }),
      );

      return [...reviewThreads, ...globalThreads];
    },
  );

  const listPendingReview: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['listPendingReview'] = providerEffect(
    'GitHubProvider.listPendingReview',
    'listPendingReview',
    function* (repo: ProviderRepoIdentity, number: number, headSha: string) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const currentViewerLogin = yield* viewerLogin();
      const reviews = yield* api.pullRequestReviews({
        owner,
        name,
        number,
      });
      const pendingReview = [...reviews]
        .reverse()
        .find(
          (review) =>
            review.state === 'PENDING' &&
            review.user?.login === currentViewerLogin &&
            (review.commit_id?.trim() ?? '') === headSha,
        );

      if (!pendingReview?.node_id) {
        return {
          session: null,
          comments: [],
        };
      }

      const reviewComments = yield* api.pullRequestReviewComments({
        owner,
        name,
        number,
        reviewId: pendingReview.id,
        perPage: 100,
      });

      const comments = reviewComments.map(
        (comment): PendingReviewComment => ({
          ...repo,
          id: comment.node_id,
          sessionId: pendingReview.id,
          number,
          headSha,
          kind: comment.in_reply_to_id != null ? 'reply' : 'thread',
          providerCommentId: comment.node_id,
          providerThreadId: null,
          replyToThreadId: null,
          replyToCommentId: comment.in_reply_to_id ?? null,
          body: comment.body,
          path: comment.path,
          oldPath: comment.path,
          newPath: comment.path,
          line: comment.line ?? null,
          side: comment.side === 'LEFT' ? 'LEFT' : comment.side === 'RIGHT' ? 'RIGHT' : null,
          startLine: comment.start_line ?? null,
          startSide:
            comment.start_side === 'LEFT' || comment.start_side === 'RIGHT'
              ? comment.start_side
              : null,
          subjectType: comment.line == null ? 'file' : 'line',
          createdAt: unixTimestampSeconds(comment.created_at),
          updatedAt: unixTimestampSeconds(comment.updated_at),
        }),
      );

      return {
        session: {
          ...repo,
          id: pendingReview.id,
          number,
          headSha,
          providerReviewId: pendingReview.node_id,
          createdAt: Math.floor(Date.now() / 1000),
          updatedAt: Math.floor(Date.now() / 1000),
        },
        comments,
      };
    },
  );

  const createReviewThread: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['createReviewThread'] = providerEffect(
    'GitHubProvider.createReviewThread',
    'createReviewThread',
    function* (repo: ProviderRepoIdentity, number: number, input: ReviewThreadInput) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const pullRequestId = yield* api.pullRequestNodeId(owner, name, number);

      if (input.subjectType === 'global') {
        yield* api.addComment({ pullRequestId, body: input.body });
        return;
      }

      yield* api.addPullRequestReviewThread({
        pullRequestId,
        body: input.body,
        path: input.path,
        line: input.line,
        side: input.side,
        startLine: input.startLine,
        startSide: input.startSide,
        subjectType: input.subjectType.toUpperCase(),
      });
    },
  );

  const ensurePendingReview: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['ensurePendingReview'] = providerEffect(
    'GitHubProvider.ensurePendingReview',
    'ensurePendingReview',
    function* (repo: ProviderRepoIdentity, number: number, headSha: string) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const pullRequestId = yield* api.pullRequestNodeId(owner, name, number);
      const response = yield* api.addPullRequestReview({
        pullRequestId,
        commitOID: headSha,
      });
      const providerReviewId = response.data?.addPullRequestReview?.pullRequestReview?.id ?? null;
      if (!providerReviewId) {
        const message = firstGraphQlErrorMessage(response);
        return yield* Effect.fail(
          new GitHubProviderMutationFailed({
            message: message ?? 'GitHub pending review was not created',
            cause: response.errors ?? response,
          }),
        );
      }

      return { providerReviewId };
    },
  );

  const createPendingReviewThread: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['createPendingReviewThread'] = providerEffect(
    'GitHubProvider.createPendingReviewThread',
    'createPendingReviewThread',
    function* (
      _repo: ProviderRepoIdentity,
      _number: number,
      session: { providerReviewId: string | null },
      input: ReviewThreadInput,
    ) {
      const api = yield* GitHubApiClient;
      if (input.subjectType === 'global') {
        return yield* Effect.fail(
          new GitHubProviderUnsupportedOperation({
            message: 'GitHub global comments cannot be pending',
            cause: { subjectType: input.subjectType },
          }),
        );
      }

      const response = yield* api.addPullRequestReviewThread({
        pullRequestReviewId: session.providerReviewId ?? '',
        body: input.body,
        path: input.path,
        line: input.line,
        side: input.side,
        startLine: input.startLine,
        startSide: input.startSide,
        subjectType: input.subjectType.toUpperCase(),
      });
      const thread = response.data?.addPullRequestReviewThread?.thread;
      const providerCommentId = thread?.comments.nodes.at(-1)?.id ?? null;
      if (!thread?.id || !providerCommentId) {
        const message = firstGraphQlErrorMessage(response);
        return yield* Effect.fail(
          new GitHubProviderMutationFailed({
            message: message ?? 'GitHub pending comment was not created',
            cause: response.errors ?? response,
          }),
        );
      }

      return {
        providerCommentId,
        providerThreadId: thread.id,
      };
    },
  );

  const createPendingReviewReply: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['createPendingReviewReply'] = providerEffect(
    'GitHubProvider.createPendingReviewReply',
    'createPendingReviewReply',
    function* (
      _repo: ProviderRepoIdentity,
      _number: number,
      session: { providerReviewId: string | null },
      threadId: string,
      body: string,
    ) {
      const api = yield* GitHubApiClient;
      const response = yield* api.addPullRequestReviewThreadReply({
        pullRequestReviewId: session.providerReviewId ?? '',
        pullRequestReviewThreadId: threadId,
        body,
      });
      const providerCommentId = response.data?.addPullRequestReviewThreadReply?.comment?.id ?? null;
      if (!providerCommentId) {
        const message = firstGraphQlErrorMessage(response);
        return yield* Effect.fail(
          new GitHubProviderMutationFailed({
            message: message ?? 'GitHub pending reply was not created',
            cause: response.errors ?? response,
          }),
        );
      }

      return {
        providerCommentId,
        providerThreadId: threadId,
      };
    },
  );

  const createPendingGlobalComment: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['createPendingGlobalComment'] = providerEffect(
    'GitHubProvider.createPendingGlobalComment',
    'createPendingGlobalComment',
    function* () {
      return yield* Effect.fail(
        new GitHubProviderUnsupportedOperation({
          message: 'GitHub global comments cannot be pending',
          cause: { subjectType: 'global' },
        }),
      );
    },
  );

  const updatePendingReviewComment: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['updatePendingReviewComment'] = providerEffect(
    'GitHubProvider.updatePendingReviewComment',
    'updatePendingReviewComment',
    function* (
      _repo: ProviderRepoIdentity,
      _number: number,
      providerCommentId: string,
      body: string,
    ) {
      const api = yield* GitHubApiClient;
      const response = yield* api.updatePullRequestReviewComment({
        id: providerCommentId,
        body,
      });
      return {
        providerCommentId:
          response.data?.updatePullRequestReviewComment?.pullRequestReviewComment?.id ??
          providerCommentId,
        providerThreadId: null,
      };
    },
  );

  const deletePendingReviewComment: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['deletePendingReviewComment'] = providerEffect(
    'GitHubProvider.deletePendingReviewComment',
    'deletePendingReviewComment',
    function* (_repo: ProviderRepoIdentity, _number: number, providerCommentId: string) {
      const api = yield* GitHubApiClient;
      yield* api.deletePullRequestReviewComment(providerCommentId);
    },
  );

  const publishPendingReview: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['publishPendingReview'] = providerEffect(
    'GitHubProvider.publishPendingReview',
    'publishPendingReview',
    function* (
      _repo: ProviderRepoIdentity,
      _number: number,
      session: { providerReviewId: string | null },
      input: {
        action?: 'approve' | 'request_changes' | 'comment';
        summary?: string | null;
      },
    ) {
      const api = yield* GitHubApiClient;
      const event =
        input.action === 'approve'
          ? 'APPROVE'
          : input.action === 'request_changes'
            ? 'REQUEST_CHANGES'
            : 'COMMENT';
      const body = input.summary ?? '';

      yield* api.submitPullRequestReview({
        pullRequestReviewId: session.providerReviewId ?? '',
        event,
        body: body.length > 0 ? body : null,
      });
    },
  );

  const discardPendingReview: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['discardPendingReview'] = providerEffect(
    'GitHubProvider.discardPendingReview',
    'discardPendingReview',
    function* (
      _repo: ProviderRepoIdentity,
      _number: number,
      session: { providerReviewId: string | null },
    ) {
      const api = yield* GitHubApiClient;
      const providerReviewId = session.providerReviewId;
      if (!providerReviewId) {
        return;
      }

      yield* api.deletePullRequestReview(providerReviewId);
    },
  );

  const replyToReviewThread: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['replyToReviewThread'] = providerEffect(
    'GitHubProvider.replyToReviewThread',
    'replyToReviewThread',
    function* (repo: ProviderRepoIdentity, number: number, threadId: string, body: string) {
      const api = yield* GitHubApiClient;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const pullRequestId = yield* api.pullRequestNodeId(owner, name, number);
      yield* api.addPullRequestReviewThreadReply({
        pullRequestId,
        pullRequestReviewThreadId: threadId,
        body,
      });
    },
  );

  const setReviewThreadResolved: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['setReviewThreadResolved'] = providerEffect(
    'GitHubProvider.setReviewThreadResolved',
    'setReviewThreadResolved',
    function* (
      _repo: ProviderRepoIdentity,
      _number: number,
      threadId: string,
      isResolved: boolean,
    ) {
      const api = yield* GitHubApiClient;
      if (isResolved) {
        yield* api.resolveReviewThread(threadId);
      } else {
        yield* api.unresolveReviewThread(threadId);
      }
    },
  );

  const updateReviewComment: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['updateReviewComment'] = providerEffect(
    'GitHubProvider.updateReviewComment',
    'updateReviewComment',
    function* (
      _repo: ProviderRepoIdentity,
      _number: number,
      _threadId: string,
      commentId: string,
      body: string,
      subjectType: ReviewThreadInput['subjectType'],
    ) {
      const api = yield* GitHubApiClient;
      if (subjectType === 'global') {
        yield* api.updateIssueComment(commentId, body);
        return;
      }

      yield* api.updatePullRequestReviewComment({
        id: commentId,
        body,
      });
    },
  );

  const deleteReviewComment: ForgeProviderEffectContract<
    GitHubApiClient,
    GitHubProviderError
  >['deleteReviewComment'] = providerEffect(
    'GitHubProvider.deleteReviewComment',
    'deleteReviewComment',
    function* (
      _repo: ProviderRepoIdentity,
      _number: number,
      _threadId: string,
      commentId: string,
      subjectType: ReviewThreadInput['subjectType'],
    ) {
      const api = yield* GitHubApiClient;
      if (subjectType === 'global') {
        yield* api.deleteIssueComment(commentId);
        return;
      }

      yield* api.deletePullRequestReviewComment(commentId);
    },
  );

  return {
    authorizeRequest,
    validateImageUrl,
    authStatus,
    viewerLogin,
    listInitialRepos,
    searchRepos,
    listNamespaceRepos,
    searchNamespaces,
    validateRepo,
    listOverviewPullRequests,
    searchPullRequests,
    listPullRequests,
    getPullRequest,
    getPullRequestApprovalState,
    approvePullRequest,
    removePullRequestApproval,
    fetchPatch,
    fetchChangedFiles,
    fetchPullRequestRefs,
    fetchFileContent,
    getPullRequestQualityReport,
    gitRemote,
    listReviewThreads,
    listPendingReview,
    createReviewThread,
    ensurePendingReview,
    createPendingReviewThread,
    createPendingReviewReply,
    createPendingGlobalComment,
    updatePendingReviewComment,
    deletePendingReviewComment,
    publishPendingReview,
    discardPendingReview,
    replyToReviewThread,
    setReviewThreadResolved,
    updateReviewComment,
    deleteReviewComment,
  } satisfies ForgeProviderEffectContract<GitHubApiClient, GitHubProviderError>;
}

export { makeGitHubProvider };
