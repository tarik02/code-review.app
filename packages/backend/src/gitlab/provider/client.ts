import { HttpClientRequest } from '@effect/platform';
import { Effect } from 'effect';
import { Buffer } from 'node:buffer';
import type {
  OverviewPullRequestSummary,
  PendingReviewComment,
  PullRequest,
  PullRequestApprovalState,
  PullRequestListItem,
  PullRequestSearchState,
  PullRequestQualityFinding,
  PullRequestQualityReport,
  ProviderAuthStatus,
  NamespaceSummary,
  PullRequestSummary,
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
} from '../../repo-id.ts';
import type {
  ForgeProviderEffectContract,
  PullRequestDiscoveryFilters,
  PullRequestQualityReportInput,
  PullRequestRefs,
  ReviewThreadInput,
} from '../../providers/types.ts';
import { GitLabApiClient } from '../client/client.ts';
import { type GitLabClientError, isGitLabClientError } from '../client/errors.ts';
import type { CreateGitLabDraftNoteInput } from '../client/client.ts';
import {
  GitLabProviderClientFailure,
  type GitLabProviderError,
  GitLabProviderInvalidRepoInput,
  GitLabProviderMissingDiffVersion,
  GitLabProviderNotAuthenticated,
  GitLabProviderRepoHostMismatch,
  GitLabProviderUnsupportedOperation,
} from './errors.ts';
import {
  GitLabApprovedByEntrySchema,
  type GitLabDiscussion,
  type GitLabGroup,
  type GitLabMergeRequest,
  type GitLabMrVersion,
  type GitLabNote,
  type GitLabPosition,
  type GitLabProject,
} from '../client/schemas.ts';
import { mergeRequestWebUrl, OVERVIEW_MERGE_REQUEST_SCOPES, toChangedFile } from './schemas.ts';
import { prepareGitLabProviderImageUrl } from './images.ts';

function isNotAuthenticatedMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('not logged') ||
    normalized.includes('not authenticated') ||
    normalized.includes('authenticate') ||
    normalized.includes('401') ||
    normalized.includes('unauthorized')
  );
}

function basicAuthHeader(username: string, password: string) {
  return `AUTHORIZATION: basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function parseGitLabRepoInput(host: string, input: string): [string, string] {
  if (!input.trim()) {
    throw new GitLabProviderInvalidRepoInput({
      message: 'Repo is required',
      input,
      cause: { input },
    });
  }

  try {
    const url = new URL(input);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      const inputHost = normalizeHost(url.origin);
      const path = normalizePath(url.pathname.replace(/\.git$/, ''));
      if (!path) {
        throw new GitLabProviderInvalidRepoInput({
          message: 'GitLab project path is required',
          input,
          cause: { input, path },
        });
      }
      return [inputHost, path];
    }
  } catch (error) {
    if (error instanceof GitLabProviderInvalidRepoInput) {
      throw error;
    }
  }

  const path = normalizePath(input.replace(/\.git$/, ''));
  if (path.split('/').length < 2) {
    throw new GitLabProviderInvalidRepoInput({
      message: 'Enter a GitLab project as namespace/project',
      input,
      cause: { input, path },
    });
  }

  return [normalizeHost(host), path];
}

function repoSummaryFromProject(
  accountId: string,
  host: string,
  label: string,
  project: GitLabProject,
): RepoSummary {
  return {
    ...createRepoIdentity('gitlab', host, accountId, project.path_with_namespace),
    provider: 'gitlab',
    host,
    providerAccountId: accountId,
    providerAccountLabel: label,
    name: project.name,
    nameWithOwner: project.path_with_namespace,
    description: project.description,
    isPrivate: project.visibility == null ? null : project.visibility.toLowerCase() !== 'public',
    avatarUrl: prepareGitLabProviderImageUrl(accountId, project.avatar_url, {
      path: project.path_with_namespace,
      type: 'project',
    }),
  } satisfies RepoSummary;
}

function namespaceSummaryFromGroup(
  accountId: string,
  host: string,
  label: string,
  group: GitLabGroup,
) {
  return {
    provider: 'gitlab',
    host,
    providerAccountId: accountId,
    providerAccountLabel: label,
    path: group.full_path,
    name: group.name || group.path || group.full_path,
    kind: 'group',
    avatarUrl: prepareGitLabProviderImageUrl(accountId, group.avatar_url, {
      path: group.full_path,
      type: 'group',
    }),
    webUrl: group.web_url ?? `https://${host}/${group.full_path}`,
  } satisfies NamespaceSummary;
}

function labelForToken(token: { viewerLogin: string | null; host: string }) {
  return token.viewerLogin ? `${token.viewerLogin} @ ${token.host}` : token.host;
}

function mapState(state: string) {
  if (state === 'opened') return 'OPEN';
  if (state === 'closed') return 'CLOSED';
  if (state === 'merged') return 'MERGED';
  return state;
}

function parseChangeCount(value?: string | null) {
  if (!value) return null;
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) ? count : null;
}

function refsFromVersion(version: GitLabMrVersion): PullRequestRefs {
  return {
    baseSha: version.base_commit_sha,
    headSha: version.head_commit_sha,
  };
}

function mergeRequestKey(mergeRequest: GitLabMergeRequest) {
  return typeof mergeRequest.project_id === 'number'
    ? `${mergeRequest.project_id}:${mergeRequest.iid}`
    : mergeRequest.web_url;
}

function toPullRequestSummary(mr: GitLabMergeRequest): PullRequestSummary {
  const diffRefs = mr.diff_refs;
  return {
    number: mr.iid,
    title: mr.title,
    state: mapState(mr.state),
    isDraft: Boolean(mr.draft) || Boolean(mr.work_in_progress),
    mergeStateStatus: (mr.detailed_merge_status ?? mr.merge_status ?? 'UNKNOWN').toUpperCase(),
    mergeable: 'UNKNOWN',
    additions: null,
    deletions: null,
    changeCount: parseChangeCount(mr.changes_count),
    authorLogin: mr.author?.username ?? 'unknown',
    updatedAt: mr.updated_at,
    headSha: mr.sha ?? diffRefs?.head_sha ?? '',
    baseSha: diffRefs?.base_sha ?? diffRefs?.start_sha ?? null,
    body: mr.description ?? null,
    url: mr.web_url,
  };
}

function withGitLabReviewCapabilities(pullRequest: PullRequestSummary): PullRequest {
  return {
    ...pullRequest,
    canApprove: true,
    canRequestChanges: true,
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

function toApprovalActor(accountId: string, approval: typeof GitLabApprovedByEntrySchema.Type) {
  return {
    login: approval.user.username,
    name: approval.user.name,
    avatarUrl: prepareGitLabProviderImageUrl(accountId, approval.user.avatar_url),
    url: approval.user.web_url ?? null,
    approvedAt: approval.approved_at ?? null,
  } satisfies PullRequestApprovalState['approvedBy'][number];
}

function toGitLabSearchState(states: PullRequestSearchState) {
  return states === 'all' ? 'all' : 'opened';
}

function toGitLabDiscoveryStates(statuses: ReadonlyArray<string>) {
  const states: Array<'opened' | 'closed' | 'merged'> = [];
  if (statuses.includes('open') || statuses.includes('draft')) states.push('opened');
  if (statuses.includes('closed')) states.push('closed');
  if (statuses.includes('merged')) states.push('merged');
  return states.length > 0 ? states : ['opened' as const];
}

function toGitLabDiscoveryOrderBy(sortBy: PullRequestDiscoveryFilters['sortBy']) {
  return sortBy === 'created_desc' || sortBy === 'created_asc' ? 'created_at' : 'updated_at';
}

function toGitLabDiscoverySortDirection(sortBy: PullRequestDiscoveryFilters['sortBy']) {
  return sortBy === 'updated_asc' || sortBy === 'created_asc' ? 'asc' : 'desc';
}

function parseGitLabMergeRequestUrl(input: string, expectedHost: string) {
  try {
    const url = new URL(input);
    if (url.hostname.toLowerCase() !== hostNameFromHost(expectedHost)) {
      return null;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    const markerIndex = segments.findIndex((segment) => segment === 'merge_requests');
    if (markerIndex <= 0) {
      return null;
    }

    const number = Number.parseInt(segments[markerIndex + 1] ?? '', 10);
    if (!Number.isSafeInteger(number) || number < 0) {
      return null;
    }

    const repoSegments =
      segments[markerIndex - 1] === '-'
        ? segments.slice(0, markerIndex - 1)
        : segments.slice(0, markerIndex);
    const projectPath = repoSegments.join('/');
    return projectPath ? { projectPath, number } : null;
  } catch {
    return null;
  }
}

function repoSummaryFromMergeRequestUrl(
  accountId: string,
  host: string,
  label: string,
  mergeRequest: GitLabMergeRequest,
): RepoSummary | null {
  try {
    const url = new URL(mergeRequest.web_url);
    const path = normalizePath(
      url.pathname.replace(/\/-\/merge_requests\/\d+$/, '').replace(/\/merge_requests\/\d+$/, ''),
    );
    if (!path) {
      return null;
    }

    const segments = path.split('/');
    const name = segments.at(-1) ?? path;

    return {
      ...createRepoIdentity('gitlab', host, accountId, path),
      provider: 'gitlab',
      host,
      providerAccountId: accountId,
      providerAccountLabel: label,
      name,
      nameWithOwner: path,
      description: null,
      isPrivate: null,
      avatarUrl: null,
    } satisfies RepoSummary;
  } catch {
    return null;
  }
}

function filterSearchMergeRequests(
  mergeRequests: ReadonlyArray<GitLabMergeRequest>,
  states: PullRequestSearchState,
) {
  if (states !== 'open') {
    return mergeRequests;
  }

  return mergeRequests.filter((mergeRequest) =>
    matchesSearchMergeRequestState(mergeRequest, states),
  );
}

function matchesSearchMergeRequestState(
  mergeRequest: GitLabMergeRequest,
  states: PullRequestSearchState,
) {
  return (
    states !== 'open' ||
    (!(mergeRequest.draft ?? false) && !(mergeRequest.work_in_progress ?? false))
  );
}

function filterSearchMergeRequestsByTitle(
  mergeRequests: ReadonlyArray<GitLabMergeRequest>,
  query: string,
  limit: number,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return mergeRequests.slice(0, limit);
  }

  return mergeRequests
    .filter((mergeRequest) => mergeRequest.title.toLowerCase().includes(normalizedQuery))
    .slice(0, limit);
}

function dedupeMergeRequests(mergeRequests: ReadonlyArray<GitLabMergeRequest>) {
  const deduped = new Map<string, GitLabMergeRequest>();
  for (const mergeRequest of mergeRequests) {
    deduped.set(mergeRequestKey(mergeRequest), mergeRequest);
  }

  return [...deduped.values()];
}

function gitlabQualitySeverity(
  severity: string | null | undefined,
): PullRequestQualityFinding['severity'] {
  switch ((severity ?? '').toLowerCase()) {
    case 'info':
      return 'info';
    case 'minor':
      return 'minor';
    case 'major':
      return 'major';
    case 'critical':
      return 'critical';
    case 'warning':
      return 'warning';
    default:
      return 'unknown';
  }
}

function gitlabQualityAnchorState(path: string, line: number | null) {
  if (!path.trim()) return 'unmapped' as const;
  if (line == null) return 'file' as const;
  return 'inline' as const;
}

function toGitLabQualityFinding(input: {
  idPrefix: string;
  sourceName: string;
  path: string;
  externalUrl?: string | null;
  status: PullRequestQualityFinding['status'];
  severity: string | null | undefined;
  line: number | null;
  description: string;
  fingerprint?: string | null;
}): PullRequestQualityFinding {
  const anchorState = gitlabQualityAnchorState(input.path, input.line);
  return {
    id: `${input.idPrefix}:${input.path}:${input.line ?? 'file'}:${input.fingerprint ?? input.description}`,
    sourceType: 'gitlab-code-quality',
    sourceName: input.sourceName,
    severity: gitlabQualitySeverity(input.severity),
    status: input.status,
    title: input.description,
    path: input.path,
    line: input.line,
    anchorState,
    externalUrl: input.externalUrl ?? undefined,
    fingerprint: input.fingerprint ?? undefined,
    rawCategory: input.severity ?? undefined,
  };
}

function gitlabQualityPending(status: string | null | undefined) {
  return ['parsing', 'pending'].includes((status ?? '').toLowerCase());
}

function gitlabQualityUnavailable(status: string | null | undefined) {
  return ['failed', 'error', 'not_found'].includes((status ?? '').toLowerCase());
}

const EMPTY_STATUS_COUNTS: Record<string, number> = {};

function gitlabQualityReportUsable(input: {
  comparerStatus: string | null | undefined;
  reportStatus: string | null | undefined;
  hasReport: boolean;
}) {
  if (!input.hasReport) return false;
  if ((input.comparerStatus ?? '').toLowerCase() === 'parsed') return true;
  return (input.reportStatus ?? '').toLowerCase() === 'parsed';
}

function lineSide(position: GitLabPosition): 'LEFT' | 'RIGHT' | null {
  const end = position.line_range?.end;
  if (end?.type === 'old') return 'LEFT';
  if (end?.type === 'new') return 'RIGHT';
  if (position.old_line != null && position.new_line == null) return 'LEFT';
  if (position.new_line != null) return 'RIGHT';
  return null;
}

function lineFromPosition(position: GitLabPosition) {
  return (
    position.line_range?.end?.new_line ??
    position.line_range?.end?.old_line ??
    position.new_line ??
    position.old_line ??
    null
  );
}

function startLineFromPosition(position: GitLabPosition) {
  return position.line_range?.start?.new_line ?? position.line_range?.start?.old_line ?? null;
}

function startSideFromPosition(position: GitLabPosition): 'LEFT' | 'RIGHT' | null {
  const type = position.line_range?.start?.type;
  if (type === 'old') return 'LEFT';
  if (type === 'new') return 'RIGHT';
  return null;
}

function pathFromPosition(position: GitLabPosition | null | undefined) {
  return position?.new_path ?? position?.old_path ?? '';
}

function discussionToReviewThread(
  accountId: string,
  discussion: GitLabDiscussion,
): ReviewThread | null {
  const notes = discussion.notes ?? [];
  const rootNote = notes[0];
  if (!rootNote) return null;
  if (rootNote.system) {
    return isGitLabReviewSystemNote(rootNote)
      ? noteToGlobalReviewThread(accountId, rootNote)
      : null;
  }

  const position = rootNote.position ?? null;
  const rootId = String(rootNote.id);
  const comments: ReviewComment[] = notes.map((note) => {
    const id = String(note.id);
    return {
      id,
      databaseId: note.id,
      authorLogin: note.author?.username ?? 'unknown',
      authorName: null,
      authorAvatarUrl: prepareGitLabProviderImageUrl(accountId, note.author?.avatar_url),
      authorAssociation: null,
      body: note.body,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
      url: note.web_url ?? '',
      replyToId: id === rootId ? null : rootId,
    };
  });

  const subjectType = position
    ? position.position_type === 'file'
      ? 'file'
      : rootNote.type === 'DiffNote'
        ? 'line'
        : 'file'
    : 'global';

  return {
    id: discussion.id,
    provider: 'gitlab',
    path: subjectType === 'global' ? '' : pathFromPosition(position),
    canResolve: true,
    isResolved: Boolean(rootNote.resolved),
    isOutdated: false,
    line: position ? lineFromPosition(position) : null,
    startLine: position ? startLineFromPosition(position) : null,
    side: position ? lineSide(position) : null,
    startSide: position ? startSideFromPosition(position) : null,
    subjectType,
    comments,
  };
}

function noteToGlobalReviewThread(accountId: string, note: GitLabNote): ReviewThread {
  const body = note.body.trim().toLowerCase();
  const eventType =
    body === 'approved this merge request'
      ? 'approved'
      : body === 'requested changes'
        ? 'requested_changes'
        : body === 'left review comments'
          ? 'commented'
          : undefined;

  return {
    id: String(note.id),
    provider: 'gitlab',
    path: '',
    canResolve: false,
    isResolved: false,
    isOutdated: false,
    line: null,
    startLine: null,
    side: null,
    startSide: null,
    subjectType: 'global',
    eventType,
    comments: [
      {
        id: String(note.id),
        databaseId: note.id,
        authorLogin: note.author?.username ?? 'unknown',
        authorName: null,
        authorAvatarUrl: prepareGitLabProviderImageUrl(accountId, note.author?.avatar_url),
        authorAssociation: null,
        body: note.body,
        createdAt: note.created_at,
        updatedAt: note.updated_at,
        url: note.web_url ?? '',
        replyToId: null,
      },
    ],
  };
}

function isGitLabReviewSystemNote(note: GitLabNote) {
  if (!note.system) {
    return false;
  }

  const body = note.body.trim().toLowerCase();
  return (
    body === 'requested changes' ||
    body === 'left review comments' ||
    body === 'approved this merge request'
  );
}

function unixTimestampNow() {
  return Math.floor(Date.now() / 1000);
}

function toDiscussionFormData(input: CreateGitLabDraftNoteInput): Array<[string, string]> {
  const formData: Array<[string, string]> = [['body', input.note]];

  if (input.position) {
    formData.push(
      ['position[base_sha]', input.position.baseSha],
      ['position[head_sha]', input.position.headSha],
      ['position[start_sha]', input.position.startSha],
      ['position[old_path]', input.position.oldPath],
      ['position[new_path]', input.position.newPath],
      ['position[position_type]', input.position.positionType],
    );

    if (input.position.positionType === 'text') {
      if (input.position.oldLine != null) {
        formData.push(['position[old_line]', String(input.position.oldLine)]);
      }
      if (input.position.newLine != null) {
        formData.push(['position[new_line]', String(input.position.newLine)]);
      }
      if (input.position.lineRange) {
        const { start, end } = input.position.lineRange;
        if (start.type != null) {
          formData.push(['position[line_range][start][type]', start.type]);
        }
        if (end.type != null) {
          formData.push(['position[line_range][end][type]', end.type]);
        }
        if (start.oldLine != null) {
          formData.push(['position[line_range][start][old_line]', String(start.oldLine)]);
        }
        if (start.newLine != null) {
          formData.push(['position[line_range][start][new_line]', String(start.newLine)]);
        }
        if (start.lineCode) {
          formData.push(['position[line_range][start][line_code]', start.lineCode]);
        }
        if (end.oldLine != null) {
          formData.push(['position[line_range][end][old_line]', String(end.oldLine)]);
        }
        if (end.newLine != null) {
          formData.push(['position[line_range][end][new_line]', String(end.newLine)]);
        }
        if (end.lineCode) {
          formData.push(['position[line_range][end][line_code]', end.lineCode]);
        }
      }
    }
  }

  return formData;
}

const mapProviderError =
  (operation: string) =>
  (error: GitLabProviderError | GitLabClientError): GitLabProviderError =>
    isGitLabClientError(error)
      ? new GitLabProviderClientFailure({
          message: error.message,
          operation,
          cause: error,
        })
      : error;

const providerEffect = <Args extends ReadonlyArray<unknown>, Success>(
  name: string,
  operation: string,
  effect: (...args: Args) => Generator<any, Success, any>,
): ((...args: Args) => Effect.Effect<Success, GitLabProviderError, GitLabApiClient>) =>
  Effect.fn(name)((...args: Args) =>
    (
      Effect.gen(function* () {
        return yield* effect(...args);
      }) as Effect.Effect<Success, GitLabClientError | GitLabProviderError, GitLabApiClient>
    ).pipe(
      Effect.mapError((error: GitLabClientError | GitLabProviderError) =>
        mapProviderError(operation)(error),
      ),
    ),
  );

function makeGitLabProvider(): ForgeProviderEffectContract<GitLabApiClient, GitLabProviderError> {
  const authorizeRequest: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['authorizeRequest'] = providerEffect(
    'GitLabProvider.authorizeRequest',
    'authorizeRequest',
    function* () {
      const api = yield* GitLabApiClient;
      const token = yield* api.accessToken();
      return (request: HttpClientRequest.HttpClientRequest) =>
        request.pipe(
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.setHeader('User-Agent', 'code-review.app'),
        );
    },
  );

  const validateImageUrl: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['validateImageUrl'] = providerEffect(
    'GitLabProvider.validateImageUrl',
    'validateImageUrl',
    function* (url: string) {
      const api = yield* GitLabApiClient;
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

  const viewerLogin: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['viewerLogin'] = providerEffect('GitLabProvider.viewerLogin', 'viewerLogin', function* () {
    const api = yield* GitLabApiClient;
    const user = yield* api.user();
    return user.username;
  });

  const authStatus: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['authStatus'] = Effect.fn('GitLabProvider.authStatus')(function* () {
    const api = yield* GitLabApiClient;
    return yield* Effect.gen(function* () {
      const token = yield* api.storedToken();
      if (!token) {
        return {
          status: 'not_authenticated',
          message: 'Sign in with GitLab to load projects.',
        } satisfies ProviderAuthStatus;
      }

      yield* viewerLogin();
      return { status: 'ready', message: null } satisfies ProviderAuthStatus;
    }).pipe(
      Effect.catchAll((error) => {
        const message = error instanceof Error ? error.message : String(error);
        return Effect.logWarning('[gitlab] auth status check failed').pipe(
          Effect.annotateLogs({
            message,
            error: getErrorMessage(error),
          }),
          Effect.zipRight(
            Effect.succeed(
              isNotAuthenticatedMessage(message)
                ? ({
                    status: 'not_authenticated',
                    message: 'Sign in with GitLab again.',
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
    GitLabApiClient,
    GitLabProviderError
  >['listInitialRepos'] = providerEffect(
    'GitLabProvider.listInitialRepos',
    'listInitialRepos',
    function* (limit: number) {
      const api = yield* GitLabApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitLabProviderNotAuthenticated({
            message: 'GitLab is not signed in.',
            cause: { provider: 'gitlab', operation: 'listInitialRepos' },
          }),
        );
      }
      const label = labelForToken(token);
      const projects = yield* api.projects({
        membership: true,
        simple: true,
        perPage: limit,
      });
      return projects.map((project) =>
        repoSummaryFromProject(token.id, token.host, label, project),
      );
    },
  );

  const searchRepos: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['searchRepos'] = providerEffect(
    'GitLabProvider.searchRepos',
    'searchRepos',
    function* (query: string, limit: number) {
      const api = yield* GitLabApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitLabProviderNotAuthenticated({
            message: 'GitLab is not signed in.',
            cause: { provider: 'gitlab', operation: 'searchRepos' },
          }),
        );
      }
      const label = labelForToken(token);
      if (query.length === 0) return yield* listInitialRepos(limit);
      const projects = yield* api.projects({
        membership: true,
        search: query,
        simple: true,
        perPage: limit,
      });
      const groups = yield* api.groups({
        allAvailable: false,
        perPage: Math.min(limit, 5),
        search: query.trim() || undefined,
      });
      const groupProjectGroups = yield* Effect.forEach(
        groups,
        (group) =>
          api
            .groupProjects({
              group: group.full_path,
              includeSubgroups: true,
              simple: true,
              perPage: limit,
            })
            .pipe(
              Effect.catchAll((error) =>
                Effect.logWarning('[gitlab] group project search failed').pipe(
                  Effect.annotateLogs({
                    accountId: token.id,
                    host: token.host,
                    group: group.full_path,
                    query,
                    error: getErrorMessage(error),
                  }),
                  Effect.zipRight(Effect.succeed([] as ReadonlyArray<GitLabProject>)),
                ),
              ),
            ),
        { concurrency: 4 },
      );

      const projectsByPath = new Map<string, GitLabProject>();
      for (const project of [...projects, ...groupProjectGroups.flat()]) {
        projectsByPath.set(project.path_with_namespace, project);
      }

      return [...projectsByPath.values()]
        .slice(0, limit)
        .map((project) => repoSummaryFromProject(token.id, token.host, label, project));
    },
  );

  const listNamespaceRepos: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['listNamespaceRepos'] = providerEffect(
    'GitLabProvider.listNamespaceRepos',
    'listNamespaceRepos',
    function* (namespacePath: string, limit: number) {
      const api = yield* GitLabApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitLabProviderNotAuthenticated({
            message: 'GitLab is not signed in.',
            cause: { provider: 'gitlab', operation: 'listNamespaceRepos' },
          }),
        );
      }

      const label = labelForToken(token);
      const projects = yield* api
        .groupProjects({
          group: namespacePath,
          includeSubgroups: true,
          simple: true,
          perPage: limit,
        })
        .pipe(
          Effect.catchAll(() =>
            api
              .projects({
                membership: true,
                search: namespacePath,
                simple: true,
                perPage: limit,
              })
              .pipe(
                Effect.map((entries) =>
                  entries.filter(
                    (project) =>
                      project.path_with_namespace === namespacePath ||
                      project.path_with_namespace.startsWith(`${namespacePath}/`),
                  ),
                ),
              ),
          ),
        );
      return projects.map((project) =>
        repoSummaryFromProject(token.id, token.host, label, project),
      );
    },
  );

  const searchNamespaces: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['searchNamespaces'] = providerEffect(
    'GitLabProvider.searchNamespaces',
    'searchNamespaces',
    function* (query: string, limit: number) {
      const api = yield* GitLabApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitLabProviderNotAuthenticated({
            message: 'GitLab is not signed in.',
            cause: { provider: 'gitlab', operation: 'searchNamespaces' },
          }),
        );
      }

      const label = labelForToken(token);
      const groups = yield* api.groups({
        allAvailable: false,
        perPage: limit,
        search: query.trim() || undefined,
      });
      return groups.map((group) => namespaceSummaryFromGroup(token.id, token.host, label, group));
    },
  );

  const validateRepo: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['validateRepo'] = providerEffect(
    'GitLabProvider.validateRepo',
    'validateRepo',
    function* (input: string) {
      const api = yield* GitLabApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitLabProviderNotAuthenticated({
            message: 'GitLab is not signed in.',
            cause: { provider: 'gitlab', operation: 'validateRepo' },
          }),
        );
      }
      const label = labelForToken(token);
      const [validatedHost, projectPath] = parseGitLabRepoInput(token.host, input);
      if (validatedHost !== token.host) {
        return yield* Effect.fail(
          new GitLabProviderRepoHostMismatch({
            message: 'Project URL host must match the selected GitLab account.',
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

      const project = yield* api.project(projectPath);
      return repoSummaryFromProject(token.id, validatedHost, label, project);
    },
  );

  const listOverviewPullRequests: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['listOverviewPullRequests'] = providerEffect(
    'GitLabProvider.listOverviewPullRequests',
    'listOverviewPullRequests',
    function* () {
      const api = yield* GitLabApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitLabProviderNotAuthenticated({
            message: 'GitLab is not signed in.',
            cause: {
              provider: 'gitlab',
              operation: 'listOverviewPullRequests',
            },
          }),
        );
      }
      const label = labelForToken(token);

      const scopedResults = yield* Effect.forEach(
        OVERVIEW_MERGE_REQUEST_SCOPES,
        (scope) =>
          api.overviewMergeRequests({ scope }).pipe(
            Effect.map((mergeRequests) => ({
              scope,
              mergeRequests,
              error: null,
            })),
            Effect.catchAll((error) => Effect.succeed({ scope, mergeRequests: [], error })),
          ),
        { concurrency: 'unbounded' },
      );

      const mergeRequestsByKey = new Map<string, GitLabMergeRequest>();
      const errors: GitLabClientError[] = [];
      for (const result of scopedResults) {
        if (result.error) {
          errors.push(result.error);
          continue;
        }
        for (const mergeRequest of result.mergeRequests) {
          mergeRequestsByKey.set(mergeRequestKey(mergeRequest), mergeRequest);
        }
      }

      if (mergeRequestsByKey.size === 0 && errors.length === scopedResults.length) {
        return yield* Effect.fail(
          new GitLabProviderClientFailure({
            message: errors[0]?.message ?? 'Failed to load GitLab overview merge requests.',
            operation: 'overviewMergeRequests',
            cause: errors[0],
          }),
        );
      }

      const mergeRequests = [...mergeRequestsByKey.values()].sort(
        (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
      );
      const entries: OverviewPullRequestSummary[] = [];
      for (const mergeRequest of mergeRequests) {
        const repo = repoSummaryFromMergeRequestUrl(token.id, token.host, label, mergeRequest);
        if (!repo) continue;
        entries.push(toOverviewPullRequestSummary(repo, toPullRequestSummary(mergeRequest)));
      }

      return entries;
    },
  );

  const mergeRequestsToOverviewEntries = (
    mergeRequests: ReadonlyArray<GitLabMergeRequest>,
    filters: PullRequestDiscoveryFilters,
  ) =>
    Effect.gen(function* () {
      const api = yield* GitLabApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitLabProviderNotAuthenticated({
            message: 'GitLab is not signed in.',
            cause: { provider: 'gitlab', operation: 'mergeRequestsToOverviewEntries' },
          }),
        );
      }

      const label = labelForToken(token);
      const sorted = dedupeMergeRequests(mergeRequests).sort((left, right) => {
        const leftValue =
          filters.sortBy === 'created_desc' || filters.sortBy === 'created_asc'
            ? left.created_at
            : left.updated_at;
        const rightValue =
          filters.sortBy === 'created_desc' || filters.sortBy === 'created_asc'
            ? right.created_at
            : right.updated_at;
        return toGitLabDiscoverySortDirection(filters.sortBy) === 'asc'
          ? Date.parse(leftValue) - Date.parse(rightValue)
          : Date.parse(rightValue) - Date.parse(leftValue);
      });

      const entries: OverviewPullRequestSummary[] = [];
      for (const mergeRequest of sorted) {
        const repo = repoSummaryFromMergeRequestUrl(token.id, token.host, label, mergeRequest);
        if (!repo) continue;
        entries.push(toOverviewPullRequestSummary(repo, toPullRequestSummary(mergeRequest)));
        if (entries.length >= filters.limit) break;
      }
      return entries;
    });

  const listViewerPullRequests: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['listViewerPullRequests'] = providerEffect(
    'GitLabProvider.listViewerPullRequests',
    'listViewerPullRequests',
    function* (filters) {
      const api = yield* GitLabApiClient;
      const states = toGitLabDiscoveryStates(filters.statuses);
      const orderBy = toGitLabDiscoveryOrderBy(filters.sortBy);
      const sort = toGitLabDiscoverySortDirection(filters.sortBy);
      const mergeRequestGroups = yield* Effect.forEach(
        states,
        (state) =>
          Effect.forEach(
            OVERVIEW_MERGE_REQUEST_SCOPES,
            (scope) =>
              api
                .overviewMergeRequests({
                  scope,
                  state,
                  orderBy,
                  sort,
                  perPage: filters.limit,
                })
                .pipe(
                  Effect.catchAll((error) =>
                    Effect.logWarning('[gitlab] scoped pull request discovery failed').pipe(
                      Effect.annotateLogs({
                        scope,
                        state,
                        error: getErrorMessage(error),
                      }),
                      Effect.zipRight(Effect.succeed([] as ReadonlyArray<GitLabMergeRequest>)),
                    ),
                  ),
                ),
            { concurrency: 'unbounded' },
          ).pipe(Effect.map((groups) => groups.flat())),
        { concurrency: 'unbounded' },
      );
      return yield* mergeRequestsToOverviewEntries(mergeRequestGroups.flat(), filters);
    },
  );

  const listNamespacePullRequests: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['listNamespacePullRequests'] = providerEffect(
    'GitLabProvider.listNamespacePullRequests',
    'listNamespacePullRequests',
    function* (namespacePath, _namespaceKind, filters) {
      const api = yield* GitLabApiClient;
      const states = toGitLabDiscoveryStates(filters.statuses);
      const orderBy = toGitLabDiscoveryOrderBy(filters.sortBy);
      const sort = toGitLabDiscoverySortDirection(filters.sortBy);
      const mergeRequestGroups = yield* Effect.forEach(
        states,
        (state) =>
          api.groupMergeRequests({
            group: namespacePath,
            state,
            orderBy,
            sort,
            perPage: filters.limit,
          }),
        { concurrency: 'unbounded' },
      );
      return yield* mergeRequestsToOverviewEntries(mergeRequestGroups.flat(), filters);
    },
  );

  const listRepoPullRequests: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['listRepoPullRequests'] = providerEffect(
    'GitLabProvider.listRepoPullRequests',
    'listRepoPullRequests',
    function* (repo, filters) {
      const api = yield* GitLabApiClient;
      const states = toGitLabDiscoveryStates(filters.statuses);
      const orderBy = toGitLabDiscoveryOrderBy(filters.sortBy);
      const sort = toGitLabDiscoverySortDirection(filters.sortBy);
      const mergeRequestGroups = yield* Effect.forEach(
        states,
        (state) =>
          api.projectMergeRequests({
            project: repo.repoKey,
            state,
            orderBy,
            sort,
            perPage: filters.limit,
          }),
        { concurrency: 'unbounded' },
      );
      return dedupeMergeRequests(mergeRequestGroups.flat())
        .sort((left, right) => {
          const leftValue =
            filters.sortBy === 'created_desc' || filters.sortBy === 'created_asc'
              ? left.created_at
              : left.updated_at;
          const rightValue =
            filters.sortBy === 'created_desc' || filters.sortBy === 'created_asc'
              ? right.created_at
              : right.updated_at;
          return sort === 'asc'
            ? Date.parse(leftValue) - Date.parse(rightValue)
            : Date.parse(rightValue) - Date.parse(leftValue);
        })
        .slice(0, filters.limit)
        .map((mergeRequest) =>
          toOverviewPullRequestSummary(repo, toPullRequestSummary(mergeRequest)),
        );
    },
  );

  const listPullRequests: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['listPullRequests'] = providerEffect(
    'GitLabProvider.listPullRequests',
    'listPullRequests',
    function* (repo: ProviderRepoIdentity) {
      const api = yield* GitLabApiClient;
      const mergeRequests = yield* api.projectMergeRequests({
        project: repo.path,
        state: 'opened',
        orderBy: 'updated_at',
        sort: 'desc',
        perPage: 100,
      });
      return mergeRequests.map(toPullRequestSummary);
    },
  );

  const searchPullRequests: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['searchPullRequests'] = providerEffect(
    'GitLabProvider.searchPullRequests',
    'searchPullRequests',
    function* (query, limit, states) {
      const api = yield* GitLabApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitLabProviderNotAuthenticated({
            message: 'GitLab is not signed in.',
            cause: { provider: 'gitlab', operation: 'searchPullRequests' },
          }),
        );
      }

      const label = labelForToken(token);
      const trimmedQuery = query.trim();
      const directMergeRequest = parseGitLabMergeRequestUrl(trimmedQuery, token.host);
      if (directMergeRequest) {
        const project = yield* api.project(directMergeRequest.projectPath);
        const mergeRequest = yield* api.mergeRequest(
          directMergeRequest.projectPath,
          directMergeRequest.number,
        );
        return [
          {
            repo: repoSummaryFromProject(token.id, token.host, label, project),
            pullRequest: toPullRequestSummary(mergeRequest),
          } satisfies OverviewPullRequestSummary,
        ];
      }

      const searchState = toGitLabSearchState(states);
      const scopedMergeRequestGroups = yield* Effect.forEach(
        OVERVIEW_MERGE_REQUEST_SCOPES,
        (scope) =>
          api
            .overviewMergeRequests({
              scope,
              state: searchState,
              perPage: limit,
              search: trimmedQuery || undefined,
              in: trimmedQuery ? 'title' : undefined,
            })
            .pipe(
              Effect.catchAll((error) =>
                Effect.logWarning('[gitlab] scoped merge request search failed').pipe(
                  Effect.annotateLogs({
                    accountId: token.id,
                    host: token.host,
                    scope,
                    query: trimmedQuery,
                    error: getErrorMessage(error),
                  }),
                  Effect.zipRight(Effect.succeed([] as ReadonlyArray<GitLabMergeRequest>)),
                ),
              ),
            ),
        { concurrency: 'unbounded' },
      );
      const mergeRequests = dedupeMergeRequests(scopedMergeRequestGroups.flat()).sort(
        (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
      );

      return filterSearchMergeRequestsByTitle(
        filterSearchMergeRequests(mergeRequests, states),
        trimmedQuery,
        limit,
      ).flatMap((mergeRequest) => {
        const repo = repoSummaryFromMergeRequestUrl(token.id, token.host, label, mergeRequest);
        if (!repo) {
          return [];
        }

        return [toOverviewPullRequestSummary(repo, toPullRequestSummary(mergeRequest))];
      });
    },
  );

  const getPullRequest: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['getPullRequest'] = providerEffect(
    'GitLabProvider.getPullRequest',
    'getPullRequest',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitLabApiClient;
      const mergeRequest = yield* api.mergeRequest(repo.path, number);
      return withGitLabReviewCapabilities(toPullRequestSummary(mergeRequest));
    },
  );

  const getPullRequestApprovalState: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['getPullRequestApprovalState'] = providerEffect(
    'GitLabProvider.getPullRequestApprovalState',
    'getPullRequestApprovalState',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitLabApiClient;
      const approvalState = yield* api.mergeRequestApprovals(repo.path, number);
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitLabProviderNotAuthenticated({
            message: 'GitLab is not signed in.',
            cause: {
              provider: 'gitlab',
              operation: 'getPullRequestApprovalState',
            },
          }),
        );
      }
      const currentViewerLogin = yield* viewerLogin();
      const approvedBy = (approvalState.approved_by ?? [])
        .map((approval) => toApprovalActor(token.id, approval))
        .sort(
          (left, right) => Date.parse(right.approvedAt ?? '') - Date.parse(left.approvedAt ?? ''),
        );

      return {
        provider: 'gitlab',
        approvedBy,
        viewerApproved: approvedBy.some((approval) => approval.login === currentViewerLogin),
        viewerRemoveStrategy: 'unapprove',
        approvalsRequired: approvalState.approvals_required ?? null,
        approvalsLeft: approvalState.approvals_left ?? null,
      } satisfies PullRequestApprovalState;
    },
  );

  const approvePullRequest: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['approvePullRequest'] = providerEffect(
    'GitLabProvider.approvePullRequest',
    'approvePullRequest',
    function* (repo: ProviderRepoIdentity, number: number, headSha: string) {
      const api = yield* GitLabApiClient;
      yield* api.approveMergeRequest(repo.path, number, headSha);
    },
  );

  const removePullRequestApproval: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['removePullRequestApproval'] = providerEffect(
    'GitLabProvider.removePullRequestApproval',
    'removePullRequestApproval',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitLabApiClient;
      yield* api.unapproveMergeRequest(repo.path, number);
    },
  );

  const fetchChangedFiles: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['fetchChangedFiles'] = providerEffect(
    'GitLabProvider.fetchChangedFiles',
    'fetchChangedFiles',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitLabApiClient;
      const files: ReturnType<typeof toChangedFile>[] = [];
      const seen = new Set<string>();
      let page = 1;
      let shouldContinue = true;
      while (shouldContinue) {
        const diffs = yield* api.mergeRequestDiffs({
          project: repo.path,
          number,
          perPage: 100,
          page,
        });
        if (diffs.length === 0) {
          shouldContinue = false;
        } else {
          for (const diff of diffs) {
            const file = toChangedFile(diff);
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

  const fetchPatch: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['fetchPatch'] = providerEffect(
    'GitLabProvider.fetchPatch',
    'fetchPatch',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitLabApiClient;
      return yield* api.mergeRequestRawDiffs(repo.path, number);
    },
  );

  const fetchPullRequestRefs: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['fetchPullRequestRefs'] = providerEffect(
    'GitLabProvider.fetchPullRequestRefs',
    'fetchPullRequestRefs',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitLabApiClient;
      const versions = yield* api.mergeRequestVersions(repo.path, number);
      const version = versions[0];
      if (!version) {
        return yield* Effect.fail(
          new GitLabProviderMissingDiffVersion({
            message: 'GitLab merge request has no diff versions',
            number,
            cause: { repo: repo.path, number },
          }),
        );
      }
      return refsFromVersion(version);
    },
  );

  const fetchFileContent: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['fetchFileContent'] = providerEffect(
    'GitLabProvider.fetchFileContent',
    'fetchFileContent',
    function* (repo: ProviderRepoIdentity, path: string, ref: string) {
      const api = yield* GitLabApiClient;
      return yield* api.repositoryFileRaw({
        project: repo.path,
        path,
        ref,
      });
    },
  );

  const getPullRequestQualityReport: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['getPullRequestQualityReport'] = providerEffect(
    'GitLabProvider.getPullRequestQualityReport',
    'getPullRequestQualityReport',
    function* (input: PullRequestQualityReportInput) {
      const api = yield* GitLabApiClient;
      const { repo, number, headSha } = input;
      const graphqlResponse = yield* api
        .codeQualityReportsComparer(repo.path, String(number))
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      const graphqlResult =
        graphqlResponse?.data?.project?.mergeRequest?.codequalityReportsComparer ?? null;

      if (graphqlResult) {
        const comparerStatus = graphqlResult.status ?? null;
        const reportStatus = graphqlResult.report?.status ?? null;

        if (gitlabQualityPending(comparerStatus) || gitlabQualityPending(reportStatus)) {
          return {
            provider: 'gitlab',
            repoKey: repo.repoKey,
            number,
            headSha,
            status: 'pending',
            summary: {
              totalFindings: 0,
              inlineFindings: 0,
              fileOnlyFindings: 0,
              statusCounts: EMPTY_STATUS_COUNTS,
              providerLabel: 'GitLab code quality',
              detailsUrl: mergeRequestWebUrl(repo, number),
              notes: ['Code quality report is still processing.'],
            },
            findings: [],
            fetchedAt: new Date().toISOString(),
            sourceMetadata: {
              source: 'graphql',
              comparerStatus,
              reportStatus,
            },
          } satisfies PullRequestQualityReport;
        }

        if (
          gitlabQualityReportUsable({
            comparerStatus,
            reportStatus,
            hasReport: Boolean(graphqlResult.report),
          }) &&
          graphqlResult.report
        ) {
          const newErrors = graphqlResult.report.newErrors ?? [];
          const resolvedErrors = graphqlResult.report.resolvedErrors ?? [];
          const existingErrors = graphqlResult.report.existingErrors ?? [];
          const findings = newErrors.map((finding, index) =>
            toGitLabQualityFinding({
              idPrefix: `graphql:${index}`,
              sourceName: finding.engineName?.trim() || 'GitLab Code Quality',
              path: finding.filePath?.trim() ?? '',
              externalUrl: finding.webUrl,
              status: 'new',
              severity: finding.severity,
              line: finding.line ?? null,
              description: finding.description,
              fingerprint: finding.fingerprint,
            }),
          );

          return {
            provider: 'gitlab',
            repoKey: repo.repoKey,
            number,
            headSha,
            status: findings.length > 0 ? 'warning' : 'ok',
            summary: {
              totalFindings:
                graphqlResult.report.summary?.total ??
                newErrors.length + resolvedErrors.length + existingErrors.length,
              inlineFindings: findings.filter((finding) => finding.anchorState === 'inline').length,
              fileOnlyFindings: findings.filter((finding) => finding.anchorState === 'file').length,
              statusCounts: {
                new: newErrors.length,
                existing: existingErrors.length,
                resolved: resolvedErrors.length,
              },
              providerLabel: 'GitLab code quality',
              detailsUrl: mergeRequestWebUrl(repo, number),
              notes: gitlabQualityUnavailable(reportStatus)
                ? [`GitLab reported code quality status ${reportStatus}, but returned findings.`]
                : undefined,
            },
            findings,
            fetchedAt: new Date().toISOString(),
            sourceMetadata: {
              source: 'graphql',
              comparerStatus,
              reportStatus,
              resolvedCount: graphqlResult.report.summary?.resolved ?? resolvedErrors.length,
              existingCount: existingErrors.length,
            },
          } satisfies PullRequestQualityReport;
        }
      }

      return {
        provider: 'gitlab',
        repoKey: repo.repoKey,
        number,
        headSha,
        status: 'unavailable',
        summary: {
          totalFindings: 0,
          inlineFindings: 0,
          fileOnlyFindings: 0,
          statusCounts: EMPTY_STATUS_COUNTS,
          providerLabel: 'GitLab code quality',
          detailsUrl: mergeRequestWebUrl(repo, number),
          notes: [
            graphqlResponse
              ? 'GitLab GraphQL returned no usable code quality report for this merge request.'
              : 'GitLab GraphQL code quality query failed for this merge request.',
          ],
        },
        findings: [],
        fetchedAt: new Date().toISOString(),
        sourceMetadata: {
          source: 'graphql',
          comparerStatus: graphqlResult?.status ?? null,
          reportStatus: graphqlResult?.report?.status ?? null,
          graphqlAvailable: graphqlResponse !== null,
        },
      } satisfies PullRequestQualityReport;
    },
  );

  const gitRemote: ForgeProviderEffectContract<GitLabApiClient, GitLabProviderError>['gitRemote'] =
    providerEffect('GitLabProvider.gitRemote', 'gitRemote', function* (repo: ProviderRepoIdentity) {
      const api = yield* GitLabApiClient;
      const token = yield* api.accessToken();
      return {
        url: `${repo.host}/${repo.path}.git`,
        auth: {
          envConfig: [
            {
              key: `http.${repo.host}/.extraheader`,
              value: basicAuthHeader('oauth2', token),
            },
          ],
        },
      };
    });

  const listReviewThreads: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['listReviewThreads'] = providerEffect(
    'GitLabProvider.listReviewThreads',
    'listReviewThreads',
    function* (repo: ProviderRepoIdentity, number: number) {
      const api = yield* GitLabApiClient;
      const token = yield* api.storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitLabProviderNotAuthenticated({
            message: 'GitLab is not signed in.',
            cause: { provider: 'gitlab', operation: 'listReviewThreads' },
          }),
        );
      }
      const threads: ReviewThread[] = [];
      const discussionNoteIds = new Set<number>();
      let discussionsPage = 1;
      while (true) {
        const discussions = yield* api.mergeRequestDiscussions({
          project: repo.path,
          number,
          perPage: 100,
          page: discussionsPage,
        });
        if (discussions.length === 0) break;
        for (const discussion of discussions) {
          for (const note of discussion.notes ?? []) {
            discussionNoteIds.add(note.id);
          }
          const thread = discussionToReviewThread(token.id, discussion);
          if (thread) threads.push(thread);
        }
        discussionsPage += 1;
      }

      let notesPage = 1;
      while (true) {
        const notes = yield* api.mergeRequestNotes({
          project: repo.path,
          number,
          orderBy: 'created_at',
          sort: 'asc',
          perPage: 100,
          page: notesPage,
        });
        if (notes.length === 0) break;
        for (const note of notes) {
          if (discussionNoteIds.has(note.id)) continue;
          if (note.position != null) continue;
          if (note.type === 'DiffNote') continue;
          if (note.system && !isGitLabReviewSystemNote(note)) continue;
          threads.push(noteToGlobalReviewThread(token.id, note));
        }
        notesPage += 1;
      }

      return threads;
    },
  );

  const listPendingReview: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['listPendingReview'] = providerEffect(
    'GitLabProvider.listPendingReview',
    'listPendingReview',
    function* (repo: ProviderRepoIdentity, number: number, headSha: string) {
      const api = yield* GitLabApiClient;
      const draftNotes = yield* api.draftNotes(repo.path, number);
      const timestamp = unixTimestampNow();
      const comments = draftNotes.flatMap((draftNote) => {
        const body = draftNote.note?.trim() ?? '';
        if (!body) return [];
        const position = draftNote.position ?? null;
        const positionHeadSha = position?.head_sha?.trim() ?? '';
        if (positionHeadSha && positionHeadSha !== headSha) return [];
        const oldPath = position?.old_path?.trim() ?? '';
        const newPath = position?.new_path?.trim() ?? '';
        const path = newPath || oldPath;
        const line = position?.new_line ?? position?.old_line ?? null;
        const side =
          position?.old_line != null && position?.new_line == null
            ? 'LEFT'
            : position?.new_line != null
              ? 'RIGHT'
              : null;
        const subjectType =
          position?.position_type === 'file' ? 'file' : position != null ? 'line' : 'global';
        const kind =
          draftNote.discussion_id != null && position == null
            ? 'reply'
            : subjectType === 'global'
              ? 'global'
              : 'thread';
        return [
          {
            ...repo,
            id: String(draftNote.id),
            sessionId: 0,
            number,
            headSha,
            kind,
            providerCommentId: String(draftNote.id),
            providerThreadId: draftNote.discussion_id ?? null,
            replyToThreadId: draftNote.discussion_id ?? null,
            replyToCommentId: null,
            body,
            path,
            oldPath,
            newPath,
            line,
            side,
            startLine: null,
            startSide: null,
            subjectType,
            createdAt: timestamp,
            updatedAt: timestamp,
          } satisfies PendingReviewComment,
        ];
      });

      return {
        session:
          comments.length > 0
            ? {
                ...repo,
                id: 0,
                number,
                headSha,
                providerReviewId: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              }
            : null,
        comments,
      };
    },
  );

  const buildDraftLineForm = (
    version: GitLabMrVersion,
    input: {
      path: string;
      oldPath: string;
      newPath: string;
      line: number | null;
      side: string | null;
      oldLine: number | null;
      newLine: number | null;
      startLine: number | null;
      startSide: string | null;
      startOldLine: number | null;
      startNewLine: number | null;
      subjectType: 'file' | 'line' | 'global';
      body: string;
    },
  ): CreateGitLabDraftNoteInput => {
    const oldPath = input.oldPath || input.path;
    const newPath = input.newPath || input.path;

    if (input.subjectType === 'file') {
      return {
        note: input.body,
        position: {
          positionType: 'file',
          baseSha: version.base_commit_sha,
          headSha: version.head_commit_sha,
          startSha: version.start_commit_sha,
          oldPath,
          newPath,
        },
      };
    }

    return {
      note: input.body,
      position: {
        positionType: 'text',
        baseSha: version.base_commit_sha,
        headSha: version.head_commit_sha,
        startSha: version.start_commit_sha,
        oldPath,
        newPath,
        oldLine:
          input.oldLine ?? (input.line != null && input.side === 'LEFT' ? input.line : undefined),
        newLine:
          input.newLine ?? (input.line != null && input.side !== 'LEFT' ? input.line : undefined),
        lineRange:
          input.line != null
            ? {
                start: {
                  type:
                    (input.startOldLine ?? input.oldLine) != null &&
                    (input.startNewLine ?? input.newLine) != null
                      ? null
                      : (input.startSide ?? input.side) === 'LEFT'
                        ? 'old'
                        : 'new',
                  oldLine:
                    input.startOldLine ??
                    input.oldLine ??
                    ((input.startSide ?? input.side) === 'LEFT'
                      ? (input.startLine ?? input.line)
                      : undefined),
                  newLine:
                    input.startNewLine ??
                    input.newLine ??
                    ((input.startSide ?? input.side) !== 'LEFT'
                      ? (input.startLine ?? input.line)
                      : undefined),
                },
                end: {
                  type:
                    input.oldLine != null && input.newLine != null
                      ? null
                      : input.side === 'LEFT'
                        ? 'old'
                        : 'new',
                  oldLine: input.oldLine ?? (input.side === 'LEFT' ? input.line : undefined),
                  newLine: input.newLine ?? (input.side !== 'LEFT' ? input.line : undefined),
                },
              }
            : undefined,
      },
    };
  };

  const createReviewThread: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['createReviewThread'] = providerEffect(
    'GitLabProvider.createReviewThread',
    'createReviewThread',
    function* (repo: ProviderRepoIdentity, number: number, input: ReviewThreadInput) {
      const api = yield* GitLabApiClient;
      if (input.subjectType === 'global') {
        yield* api.createMergeRequestNote(repo.path, number, input.body);
        return;
      }

      const versions = yield* api.mergeRequestVersions(repo.path, number);
      const version = versions[0];
      if (!version) {
        return yield* Effect.fail(
          new GitLabProviderMissingDiffVersion({
            message: 'GitLab merge request has no diff versions',
            number,
            cause: { repo: repo.path, number },
          }),
        );
      }

      const draftNote = buildDraftLineForm(version, {
        body: input.body,
        path: input.path,
        oldPath: input.oldPath,
        newPath: input.newPath,
        line: input.line,
        side: input.side,
        oldLine: input.oldLine,
        newLine: input.newLine,
        startLine: input.startLine,
        startSide: input.startSide,
        startOldLine: input.startOldLine,
        startNewLine: input.startNewLine,
        subjectType: input.subjectType,
      });

      yield* api.createDiscussion(repo.path, number, toDiscussionFormData(draftNote));
    },
  );

  const ensurePendingReview: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['ensurePendingReview'] = providerEffect(
    'GitLabProvider.ensurePendingReview',
    'ensurePendingReview',
    function* () {
      return yield* Effect.succeed({ providerReviewId: null });
    },
  );

  const createPendingReviewThread: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['createPendingReviewThread'] = providerEffect(
    'GitLabProvider.createPendingReviewThread',
    'createPendingReviewThread',
    function* (
      repo: ProviderRepoIdentity,
      number: number,
      _session: unknown,
      input: ReviewThreadInput,
    ) {
      const api = yield* GitLabApiClient;
      if (input.subjectType === 'global') {
        return yield* Effect.fail(
          new GitLabProviderUnsupportedOperation({
            message: 'Use global draft note creation',
            cause: { subjectType: input.subjectType },
          }),
        );
      }

      const versions = yield* api.mergeRequestVersions(repo.path, number);
      const version = versions[0];
      if (!version) {
        return yield* Effect.fail(
          new GitLabProviderMissingDiffVersion({
            message: 'GitLab merge request has no diff versions',
            number,
            cause: { repo: repo.path, number },
          }),
        );
      }

      const draftNote = yield* api.createDraftNote(
        repo.path,
        number,
        buildDraftLineForm(version, {
          body: input.body,
          path: input.path,
          oldPath: input.oldPath,
          newPath: input.newPath,
          line: input.line,
          side: input.side,
          oldLine: input.oldLine,
          newLine: input.newLine,
          startLine: input.startLine,
          startSide: input.startSide,
          startOldLine: input.startOldLine,
          startNewLine: input.startNewLine,
          subjectType: input.subjectType,
        }),
      );

      return {
        providerCommentId: String(draftNote.id),
        providerThreadId: draftNote.discussion_id ?? null,
      };
    },
  );

  const createPendingReviewReply: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['createPendingReviewReply'] = providerEffect(
    'GitLabProvider.createPendingReviewReply',
    'createPendingReviewReply',
    function* (
      repo: ProviderRepoIdentity,
      number: number,
      _session: unknown,
      threadId: string,
      body: string,
    ) {
      const api = yield* GitLabApiClient;
      const draftNote = yield* api.createDraftNote(repo.path, number, {
        note: body,
        inReplyToDiscussionId: threadId,
      });
      return {
        providerCommentId: String(draftNote.id),
        providerThreadId: draftNote.discussion_id ?? threadId,
      };
    },
  );

  const createPendingGlobalComment: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['createPendingGlobalComment'] = providerEffect(
    'GitLabProvider.createPendingGlobalComment',
    'createPendingGlobalComment',
    function* (repo: ProviderRepoIdentity, number: number, _session: unknown, body: string) {
      const api = yield* GitLabApiClient;
      const draftNote = yield* api.createDraftNote(repo.path, number, { note: body });
      return {
        providerCommentId: String(draftNote.id),
        providerThreadId: draftNote.discussion_id ?? null,
      };
    },
  );

  const updatePendingReviewComment: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['updatePendingReviewComment'] = providerEffect(
    'GitLabProvider.updatePendingReviewComment',
    'updatePendingReviewComment',
    function* (
      repo: ProviderRepoIdentity,
      number: number,
      providerCommentId: string,
      body: string,
    ) {
      const api = yield* GitLabApiClient;
      const draftNote = yield* api.updateDraftNote(repo.path, number, providerCommentId, body);
      return {
        providerCommentId: String(draftNote.id),
        providerThreadId: draftNote.discussion_id ?? null,
      };
    },
  );

  const deletePendingReviewComment: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['deletePendingReviewComment'] = providerEffect(
    'GitLabProvider.deletePendingReviewComment',
    'deletePendingReviewComment',
    function* (repo: ProviderRepoIdentity, number: number, providerCommentId: string) {
      const api = yield* GitLabApiClient;
      yield* api.deleteDraftNote(repo.path, number, providerCommentId);
    },
  );

  const publishPendingReview: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['publishPendingReview'] = providerEffect(
    'GitLabProvider.publishPendingReview',
    'publishPendingReview',
    function* (
      repo: ProviderRepoIdentity,
      number: number,
      _session: unknown,
      input: {
        action?: 'approve' | 'request_changes' | 'comment';
        summary?: string | null;
      },
    ) {
      const api = yield* GitLabApiClient;
      const summary = input.summary?.trim() ?? '';
      const submitReviewCommand =
        input.action === 'approve'
          ? '/submit_review approve'
          : input.action === 'request_changes'
            ? '/submit_review requested_changes'
            : '/submit_review';

      if (summary) {
        yield* api.createDraftNote(repo.path, number, { note: summary });
      }

      yield* api.createMergeRequestNote(repo.path, number, submitReviewCommand);
    },
  );

  const discardPendingReview: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['discardPendingReview'] = providerEffect(
    'GitLabProvider.discardPendingReview',
    'discardPendingReview',
    function* (
      repo: ProviderRepoIdentity,
      number: number,
      _session: unknown,
      comments: PendingReviewComment[],
    ) {
      yield* Effect.forEach(
        comments.filter((comment) => comment.providerCommentId != null),
        (comment) => deletePendingReviewComment(repo, number, comment.providerCommentId ?? ''),
        { discard: true },
      );
    },
  );

  const replyToReviewThread: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['replyToReviewThread'] = providerEffect(
    'GitLabProvider.replyToReviewThread',
    'replyToReviewThread',
    function* (repo: ProviderRepoIdentity, number: number, threadId: string, body: string) {
      const api = yield* GitLabApiClient;
      yield* api.createDiscussionNote(repo.path, number, threadId, body);
    },
  );

  const setReviewThreadResolved: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['setReviewThreadResolved'] = providerEffect(
    'GitLabProvider.setReviewThreadResolved',
    'setReviewThreadResolved',
    function* (repo: ProviderRepoIdentity, number: number, threadId: string, isResolved: boolean) {
      const api = yield* GitLabApiClient;
      yield* api.updateDiscussion(repo.path, number, threadId, isResolved);
    },
  );

  const updateReviewComment: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['updateReviewComment'] = providerEffect(
    'GitLabProvider.updateReviewComment',
    'updateReviewComment',
    function* (
      repo: ProviderRepoIdentity,
      number: number,
      threadId: string,
      commentId: string,
      body: string,
      subjectType: ReviewThreadInput['subjectType'],
    ) {
      const api = yield* GitLabApiClient;
      if (subjectType === 'global') {
        yield* api.updateMergeRequestNote(repo.path, number, commentId, body);
        return;
      }

      yield* api.updateDiscussionNote(repo.path, number, threadId, commentId, body);
    },
  );

  const deleteReviewComment: ForgeProviderEffectContract<
    GitLabApiClient,
    GitLabProviderError
  >['deleteReviewComment'] = providerEffect(
    'GitLabProvider.deleteReviewComment',
    'deleteReviewComment',
    function* (
      repo: ProviderRepoIdentity,
      number: number,
      threadId: string,
      commentId: string,
      subjectType: ReviewThreadInput['subjectType'],
    ) {
      const api = yield* GitLabApiClient;
      if (subjectType === 'global') {
        yield* api.deleteMergeRequestNote(repo.path, number, commentId);
        return;
      }

      yield* api.deleteDiscussionNote(repo.path, number, threadId, commentId);
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
    listViewerPullRequests,
    listNamespacePullRequests,
    listRepoPullRequests,
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
  } satisfies ForgeProviderEffectContract<GitLabApiClient, GitLabProviderError>;
}

export { makeGitLabProvider };
