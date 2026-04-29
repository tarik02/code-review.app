import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from '@effect/platform';
import { Effect, ParseResult, Schema } from 'effect';
import { ProviderError } from '../errors.ts';
import { parseOwnerRepo } from '../repo-id.ts';
import { createRepoIdentity } from '../repo-id.ts';
import { getValidAccessToken, updateViewerLogin } from '../auth/provider-auth.ts';
import type {
  PullRequestQualityFinding,
  PullRequestQualityReport,
  PullRequestApprovalState,
  ProviderAuthStatus,
  PrChangedFile,
  PullRequestSummary,
  RepoSummary,
  ReviewComment,
  ReviewThread,
} from '@code-review-app/shared';
import type { ForgeProvider, PullRequestQualityReportInput, ReviewThreadInput } from './types.ts';
import type { RepoIdentity } from '../repo-id.ts';
import { AuthTokenStore, type StoredAuthToken } from '../auth/token-store.ts';

type GitHubRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT';
  accept?: string;
  body?: unknown;
};

type GraphQlResponse<T> = {
  data?: T | null;
  errors?: ReadonlyArray<{ message: string }> | null;
};

type UserContext = {
  accountId: string;
  login: string;
  owners: string[];
  fetchedAt: number;
};

const API_REQUEST_TIMEOUT = '30 seconds';
const USER_CONTEXT_TTL_MS = 60 * 60 * 1000;

const NullableString = Schema.NullOr(Schema.String);
const OptionalNullableString = Schema.optional(Schema.NullOr(Schema.String));
const OptionalNullableNumber = Schema.optional(Schema.NullOr(Schema.Number));

const GhActorSchema = Schema.Struct({
  login: Schema.String,
  avatarUrl: OptionalNullableString,
  avatar_url: OptionalNullableString,
  url: OptionalNullableString,
  html_url: OptionalNullableString,
});

const GhSearchRepoSchema = Schema.Struct({
  name: Schema.String,
  full_name: Schema.String,
  description: NullableString,
  private: Schema.NullOr(Schema.Boolean),
  owner: Schema.optional(Schema.NullOr(GhActorSchema)),
});

const GhRestRepoSchema = Schema.Struct({
  name: Schema.String,
  full_name: Schema.String,
  description: NullableString,
  private: Schema.NullOr(Schema.Boolean),
  owner: Schema.optional(Schema.NullOr(GhActorSchema)),
});

const GhGraphqlRepoSchema = Schema.Struct({
  name: Schema.String,
  nameWithOwner: Schema.String,
  description: NullableString,
  isPrivate: Schema.NullOr(Schema.Boolean),
  owner: Schema.optional(Schema.NullOr(GhActorSchema)),
});

const GhRestUserSchema = Schema.Struct({
  login: Schema.String,
});

const GhSearchResponseSchema = Schema.Struct({
  items: Schema.Array(GhSearchRepoSchema),
});

const GhChangedFileSchema = Schema.Struct({
  filename: Schema.String,
  previous_filename: OptionalNullableString,
  status: Schema.String,
  changes: OptionalNullableNumber,
});

const GhPullRequestReviewSchema = Schema.Struct({
  id: Schema.Number,
  state: Schema.String,
  submitted_at: OptionalNullableString,
  html_url: OptionalNullableString,
  user: Schema.optional(Schema.NullOr(GhActorSchema)),
});

const GhCheckRunOutputSchema = Schema.Struct({
  title: OptionalNullableString,
  summary: OptionalNullableString,
  text: OptionalNullableString,
  annotations_count: OptionalNullableNumber,
});

const GhCheckRunSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  status: Schema.String,
  conclusion: OptionalNullableString,
  details_url: OptionalNullableString,
  html_url: OptionalNullableString,
  app: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        name: Schema.String,
      }),
    ),
  ),
  output: Schema.optional(Schema.NullOr(GhCheckRunOutputSchema)),
});

const GhCheckRunsResponseSchema = Schema.Struct({
  total_count: OptionalNullableNumber,
  check_runs: Schema.Array(GhCheckRunSchema),
});

const GhCheckRunAnnotationSchema = Schema.Struct({
  path: Schema.String,
  start_line: Schema.Number,
  end_line: OptionalNullableNumber,
  annotation_level: Schema.String,
  message: Schema.String,
  title: OptionalNullableString,
  raw_details: OptionalNullableString,
});

type GhChangedFile = typeof GhChangedFileSchema.Type;
type GhCheckRun = typeof GhCheckRunSchema.Type;
type GhCheckRunAnnotation = typeof GhCheckRunAnnotationSchema.Type;
type GhPullRequestReview = typeof GhPullRequestReviewSchema.Type;

function toChangedFile(item: GhChangedFile): PrChangedFile {
  const filename = item.filename.trim();
  const previousFilename = item.previous_filename?.trim() || filename;

  if (item.status === 'added') {
    return {
      path: filename,
      oldPath: '',
      newPath: filename,
      changeType: 'new',
    };
  }

  if (item.status === 'removed') {
    return {
      path: filename,
      oldPath: filename,
      newPath: '',
      changeType: 'deleted',
    };
  }

  if (item.status === 'renamed') {
    return {
      path: filename,
      oldPath: previousFilename,
      newPath: filename,
      changeType: item.changes === 0 ? 'rename-pure' : 'rename-changed',
    };
  }

  return {
    path: filename,
    oldPath: filename,
    newPath: filename,
    changeType: 'change',
  };
}

const GhPullRequestFields = {
  number: Schema.Number,
  title: Schema.String,
  state: Schema.String,
  isDraft: Schema.Boolean,
  mergeStateStatus: OptionalNullableString,
  mergeable: OptionalNullableString,
  additions: OptionalNullableNumber,
  deletions: OptionalNullableNumber,
  author: Schema.optional(Schema.NullOr(GhActorSchema)),
  updatedAt: Schema.String,
  url: Schema.String,
  headRefOid: Schema.String,
  baseRefOid: OptionalNullableString,
  mergedAt: OptionalNullableString,
};

const GhPullRequestSchema = Schema.Struct(GhPullRequestFields);

const GhOverviewPullRequestSchema = Schema.Struct({
  ...GhPullRequestFields,
  repository: Schema.optional(Schema.NullOr(GhGraphqlRepoSchema)),
});

const PullRequestNodeIdQueryDataSchema = Schema.Struct({
  repository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              id: Schema.String,
            }),
          ),
        ),
      }),
    ),
  ),
});

const GraphQlReviewCommentSchema = Schema.Struct({
  id: Schema.String,
  databaseId: OptionalNullableNumber,
  body: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  url: Schema.String,
  path: Schema.String,
  authorAssociation: OptionalNullableString,
  author: Schema.optional(Schema.NullOr(GhActorSchema)),
  replyTo: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
      }),
    ),
  ),
});

const GraphQlConversationCommentSchema = Schema.Struct({
  id: Schema.String,
  databaseId: OptionalNullableNumber,
  body: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  url: Schema.String,
  authorAssociation: OptionalNullableString,
  author: Schema.optional(Schema.NullOr(GhActorSchema)),
});

const GraphQlReviewThreadSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  line: OptionalNullableNumber,
  originalLine: OptionalNullableNumber,
  startLine: OptionalNullableNumber,
  originalStartLine: OptionalNullableNumber,
  diffSide: Schema.String,
  startDiffSide: OptionalNullableString,
  subjectType: Schema.String,
  comments: Schema.Struct({
    nodes: Schema.Array(GraphQlReviewCommentSchema),
  }),
});

const ReviewThreadsQueryDataSchema = Schema.Struct({
  repository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              reviewThreads: Schema.Struct({
                nodes: Schema.Array(GraphQlReviewThreadSchema),
              }),
              comments: Schema.Struct({
                nodes: Schema.Array(GraphQlConversationCommentSchema),
              }),
            }),
          ),
        ),
      }),
    ),
  ),
});

const SearchPullRequestsQueryDataSchema = Schema.Struct({
  search: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nodes: Schema.optional(
          Schema.NullOr(Schema.Array(Schema.NullOr(GhOverviewPullRequestSchema))),
        ),
      }),
    ),
  ),
});

const ListPullRequestsQueryDataSchema = Schema.Struct({
  repository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        pullRequests: Schema.Struct({
          nodes: Schema.Array(GhPullRequestSchema),
        }),
      }),
    ),
  ),
});

const GetPullRequestQueryDataSchema = Schema.Struct({
  repository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.optional(Schema.NullOr(GhPullRequestSchema)),
      }),
    ),
  ),
});

const GitHubGraphQlErrorSchema = Schema.Struct({
  message: Schema.String,
});

const GitHubErrorBodySchema = Schema.Struct({
  message: Schema.optional(Schema.String),
});

type GhSearchRepo = typeof GhSearchRepoSchema.Type;
type GhRestRepo = typeof GhRestRepoSchema.Type;
type GhGraphqlRepo = typeof GhGraphqlRepoSchema.Type;
type GhPullRequest = typeof GhPullRequestSchema.Type;
let userContext: UserContext | null = null;

function graphQlResponseSchema<A, I, R>(dataSchema: Schema.Schema<A, I, R>) {
  return Schema.Struct({
    data: Schema.optional(Schema.NullOr(dataSchema)),
    errors: Schema.optional(Schema.NullOr(Schema.Array(GitHubGraphQlErrorSchema))),
  });
}

function toProviderError(error: unknown) {
  return error instanceof ProviderError
    ? error
    : new ProviderError(error instanceof Error ? error.message : String(error));
}

function storedToken(
  accountId: string,
): Effect.Effect<StoredAuthToken | null, ProviderError, AuthTokenStore> {
  return Effect.gen(function* () {
    const tokenStore = yield* AuthTokenStore;
    return yield* tokenStore.get(accountId).pipe(Effect.mapError(toProviderError));
  });
}

function requireStoredToken(
  accountId: string,
): Effect.Effect<StoredAuthToken, ProviderError, AuthTokenStore> {
  return Effect.gen(function* () {
    const token = yield* storedToken(accountId);
    if (!token) return yield* Effect.fail(new ProviderError('GitHub is not signed in.'));
    return token;
  });
}

function validAccessToken(
  accountId: string,
): Effect.Effect<string, ProviderError, AuthTokenStore | HttpClient.HttpClient> {
  return getValidAccessToken(accountId).pipe(Effect.mapError(toProviderError));
}

function saveViewerLogin(
  accountId: string,
  login: string,
): Effect.Effect<void, ProviderError, AuthTokenStore> {
  return updateViewerLogin(accountId, login).pipe(Effect.mapError(toProviderError));
}

function parseOwnerRepoEffect(value: string): Effect.Effect<[string, string], ProviderError> {
  return Effect.try({
    try: () => parseOwnerRepo(value),
    catch: toProviderError,
  });
}

function encodePath(path: string) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
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

function parseGitHubErrorBody(text: string) {
  if (!text) return '';
  try {
    const parsed = Schema.decodeUnknownSync(GitHubErrorBodySchema)(JSON.parse(text));
    return parsed.message ?? text;
  } catch {
    return text;
  }
}

function parseErrorMessage(error: ParseResult.ParseError) {
  return Effect.map(
    ParseResult.TreeFormatter.formatError(error),
    (message) => new ProviderError(message),
  );
}

function responseErrorMessage(error: HttpClientError.ResponseError) {
  return Effect.gen(function* () {
    const body = yield* error.response.text.pipe(Effect.catchAll(() => Effect.succeed('')));
    return parseGitHubErrorBody(body) || `Provider API returned HTTP ${error.response.status}`;
  });
}

function mapHttpError(error: unknown) {
  if (error instanceof ProviderError) return Effect.succeed(error);
  if (error instanceof ParseResult.ParseError) return parseErrorMessage(error);
  if (error instanceof HttpClientError.ResponseError) {
    return Effect.map(
      responseErrorMessage(error),
      (message) => new ProviderError(message, { cause: error }),
    );
  }
  if (HttpClientError.isHttpClientError(error)) {
    return Effect.succeed(new ProviderError(error.message, { cause: error }));
  }
  return Effect.succeed(toProviderError(error));
}

function graphqlErrors<T>(response: GraphQlResponse<T>): Effect.Effect<void, ProviderError> {
  if (!response.errors?.length) return Effect.void;
  const message = response.errors.map((error) => error.message).join('\n');
  return Effect.fail(new ProviderError(message || 'GitHub returned an unknown GraphQL error'));
}

function githubApiBase(host: string) {
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

function githubGraphqlUrl(host: string) {
  return host === 'github.com' ? 'https://api.github.com/graphql' : `https://${host}/api/graphql`;
}

function githubApiUrl(host: string, pathOrUrl: string) {
  return pathOrUrl.startsWith('http') ? pathOrUrl : `${githubApiBase(host)}${pathOrUrl}`;
}

function requestFor(url: string, token: string, options: GitHubRequestOptions = {}) {
  const request =
    options.method === 'POST'
      ? HttpClientRequest.post(url)
      : options.method === 'PUT'
        ? HttpClientRequest.put(url)
        : HttpClientRequest.get(url);

  return request.pipe(
    HttpClientRequest.accept(options.accept ?? 'application/json'),
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.setHeader('User-Agent', 'code-review.app'),
    HttpClientRequest.setHeader('X-GitHub-Api-Version', '2022-11-28'),
  );
}

function githubResponse(
  accountId: string,
  host: string,
  pathOrUrl: string,
  options?: GitHubRequestOptions,
) {
  const url = githubApiUrl(host, pathOrUrl);
  return Effect.gen(function* () {
    const token = yield* validAccessToken(accountId);
    const client = yield* HttpClient.HttpClient;
    let request = requestFor(url, token, options);
    if (options?.body !== undefined) {
      request = yield* request.pipe(
        HttpClientRequest.setHeader('Content-Type', 'application/json'),
        HttpClientRequest.bodyJson(options.body),
        Effect.mapError(toProviderError),
      );
    }
    return yield* client.execute(request).pipe(
      Effect.timeoutFail({
        duration: API_REQUEST_TIMEOUT,
        onTimeout: () => new ProviderError(`Provider API request timed out after 30s: ${url}`),
      }),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    );
  }).pipe(
    Effect.catchAll((error) =>
      Effect.flatMap(mapHttpError(error), (providerError) => Effect.fail(providerError)),
    ),
  );
}

function githubJson<A, I, R>(
  accountId: string,
  host: string,
  path: string,
  schema: Schema.Schema<A, I, R>,
  options?: GitHubRequestOptions,
): Effect.Effect<A, ProviderError, AuthTokenStore | HttpClient.HttpClient | R> {
  return githubResponse(accountId, host, path, options).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
    Effect.catchAll((error) =>
      Effect.flatMap(mapHttpError(error), (providerError) => Effect.fail(providerError)),
    ),
  );
}

function githubText(
  accountId: string,
  host: string,
  path: string,
  accept: string,
): Effect.Effect<string, ProviderError, AuthTokenStore | HttpClient.HttpClient> {
  return githubResponse(accountId, host, path, { accept }).pipe(
    Effect.flatMap((response) => response.text),
    Effect.catchAll((error) =>
      Effect.flatMap(mapHttpError(error), (providerError) => Effect.fail(providerError)),
    ),
  );
}

function githubGraphql<A, I, R>(
  accountId: string,
  host: string,
  query: string,
  variables: Record<string, string | number | boolean | null>,
  schema: Schema.Schema<A, I, R>,
): Effect.Effect<GraphQlResponse<A>, ProviderError, AuthTokenStore | HttpClient.HttpClient | R> {
  return Effect.gen(function* () {
    const response = yield* githubJson(
      accountId,
      host,
      githubGraphqlUrl(host),
      graphQlResponseSchema(schema),
      {
        method: 'POST',
        body: { query, variables },
      },
    );
    yield* graphqlErrors(response);
    return response;
  });
}

function ensureUserContext(
  accountId: string,
  host: string,
): Effect.Effect<string[], ProviderError, AuthTokenStore | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    if (
      userContext &&
      userContext.accountId === accountId &&
      Date.now() - userContext.fetchedAt < USER_CONTEXT_TTL_MS
    ) {
      return userContext.owners;
    }

    const user = yield* githubJson(accountId, host, '/user', GhRestUserSchema);
    const owners = [user.login];

    const orgs = yield* githubJson(
      accountId,
      host,
      '/user/orgs?per_page=100',
      Schema.Array(GhRestUserSchema),
    ).pipe(Effect.catchAll(() => Effect.succeed([])));
    for (const org of orgs) {
      if (org.login.trim().length > 0) owners.push(org.login);
    }

    yield* saveViewerLogin(accountId, user.login);
    userContext = { accountId, login: user.login, owners, fetchedAt: Date.now() };
    return owners;
  });
}

function githubViewerLogin(
  accountId: string,
): Effect.Effect<string, ProviderError, AuthTokenStore | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const token = yield* requireStoredToken(accountId);
    yield* ensureUserContext(accountId, token.host);
    const login = userContext?.login;
    if (!login) {
      return yield* Effect.fail(new ProviderError('Unable to determine GitHub viewer login'));
    }
    return login;
  });
}

function getPullRequestNodeId(
  repo: RepoIdentity,
  number: number,
): Effect.Effect<string, ProviderError, AuthTokenStore | HttpClient.HttpClient> {
  const query = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
    }
  }
}
`;

  return Effect.gen(function* () {
    const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
    const response = yield* githubGraphql(
      repo.accountId,
      repo.host,
      query,
      {
        owner,
        name,
        number,
      },
      PullRequestNodeIdQueryDataSchema,
    );

    const id = response.data?.repository?.pullRequest?.id?.trim();
    if (!id) {
      return yield* Effect.fail(new ProviderError('Pull request not found'));
    }
    return id;
  });
}

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
    avatarUrl: repo.owner?.avatarUrl ?? repo.owner?.avatar_url ?? null,
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
    avatarUrl: repo.owner?.avatarUrl ?? repo.owner?.avatar_url ?? null,
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
    avatarUrl: repo.owner?.avatarUrl ?? repo.owner?.avatar_url ?? null,
  };
}

function labelForToken(token: { viewerLogin: string | null; host: string }) {
  return token.viewerLogin ? `${token.viewerLogin} @ ${token.host}` : token.host;
}

function toPullRequestSummary(pullRequest: GhPullRequest): PullRequestSummary {
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
    url: pullRequest.url,
    headSha: pullRequest.headRefOid,
    baseSha: pullRequest.baseRefOid ?? null,
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

class GitHubProvider implements ForgeProvider {
  authStatus(accountId: string): ReturnType<ForgeProvider['authStatus']> {
    const viewerLogin = this.viewerLogin.bind(this);
    return Effect.gen(function* () {
      const token = yield* storedToken(accountId);
      if (!token) {
        return {
          status: 'not_authenticated',
          message: 'Sign in with GitHub to load repositories.',
        } satisfies ProviderAuthStatus;
      }
      yield* viewerLogin(accountId);
      return { status: 'ready', message: null } satisfies ProviderAuthStatus;
    }).pipe(
      Effect.catchAll((error) => {
        const message = error instanceof Error ? error.message : String(error);
        const status: ProviderAuthStatus = isNotAuthenticatedMessage(message)
          ? {
              status: 'not_authenticated',
              message: 'Sign in with GitHub again.',
            }
          : {
              status: 'unknown_error',
              message,
            };
        return Effect.succeed(status);
      }),
    ) as ReturnType<ForgeProvider['authStatus']>;
  }

  viewerLogin(accountId: string) {
    return githubViewerLogin(accountId);
  }
  listInitialRepos(accountId: string, limit: number) {
    return Effect.gen(function* () {
      const token = yield* requireStoredToken(accountId);
      const label = labelForToken(token);
      const repos = yield* githubJson(
        accountId,
        token.host,
        `/user/repos?per_page=${limit}&sort=updated&affiliation=owner,collaborator,organization_member`,
        Schema.Array(GhRestRepoSchema),
      );
      return repos.map((repo) => repoSummaryFromRest(accountId, token.host, label, repo));
    });
  }

  searchRepos(accountId: string, query: string, limit: number) {
    const listInitialRepos = this.listInitialRepos.bind(this);
    return Effect.gen(function* () {
      const token = yield* requireStoredToken(accountId);
      const label = labelForToken(token);
      const trimmedQuery = query.trim();
      if (trimmedQuery.length === 0) {
        return yield* listInitialRepos(accountId, limit);
      }

      const owners = yield* ensureUserContext(accountId, token.host);
      const repos: GhSearchRepo[] = [];
      for (const owner of owners) {
        const qualifier = owner === userContext?.login ? 'user' : 'org';
        const response = yield* githubJson(
          accountId,
          token.host,
          `/search/repositories?q=${encodeURIComponent(`${trimmedQuery} in:name ${qualifier}:${owner}`)}&per_page=${limit}`,
          GhSearchResponseSchema,
        );
        repos.push(...response.items);
        if (repos.length >= limit) break;
      }
      const seen = new Set<string>();
      return repos.flatMap((repo) => {
        if (seen.has(repo.full_name) || seen.size >= limit) return [];
        seen.add(repo.full_name);
        return [repoSummaryFromSearch(accountId, token.host, label, repo)];
      });
    });
  }

  validateRepo(accountId: string, input: string) {
    return Effect.gen(function* () {
      const token = yield* requireStoredToken(accountId);
      const label = labelForToken(token);
      const repo = input.trim();
      if (repo.split('/').length !== 2 || repo.startsWith('/') || repo.endsWith('/')) {
        return yield* Effect.fail(new ProviderError('Enter a repo as owner/name'));
      }
      const [owner, name] = yield* parseOwnerRepoEffect(repo);
      const details = yield* githubJson(
        accountId,
        token.host,
        `/repos/${owner}/${name}`,
        GhRestRepoSchema,
      );
      return repoSummaryFromRest(accountId, token.host, label, details);
    });
  }

  listOverviewPullRequests(accountId: string) {
    return Effect.gen(function* () {
      const token = yield* requireStoredToken(accountId);
      const label = labelForToken(token);
      yield* ensureUserContext(accountId, token.host);
      const login = userContext?.login;
      if (!login) {
        return yield* Effect.fail(new ProviderError('Unable to determine GitHub viewer login'));
      }

      const query = `
query($query: String!, $first: Int!) {
  search(type: ISSUE, query: $query, first: $first) {
    nodes {
      ... on PullRequest {
        number
        title
        state
        isDraft
        mergeStateStatus
        mergeable
        additions
        deletions
        author { login }
        updatedAt
        url
        headRefOid
        baseRefOid
        repository {
          name
          nameWithOwner
          description
          isPrivate
          owner {
            login
            avatarUrl
          }
        }
      }
    }
  }
}
`;
      const searchQuery = `is:pr is:open archived:false involves:${login} sort:updated-desc`;
      console.info(`[github] loading overview pull requests from ${token.host} for ${login}`);
      const response = yield* githubGraphql(
        accountId,
        token.host,
        query,
        { query: searchQuery, first: 100 },
        SearchPullRequestsQueryDataSchema,
      );
      const entries = (response.data?.search?.nodes ?? []).flatMap((pullRequest) => {
        const repo = pullRequest?.repository;
        if (!pullRequest || !repo) return [];
        return [
          {
            repo: repoSummaryFromGraphql(accountId, token.host, label, repo),
            pullRequest: toPullRequestSummary(pullRequest),
          },
        ];
      });

      console.info(`[github] loaded ${entries.length} overview pull requests from ${token.host}`);
      return entries;
    });
  }

  listPullRequests(repo: RepoIdentity) {
    return Effect.gen(function* () {
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const query = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number
        title
        state
        isDraft
        mergeStateStatus
        mergeable
        additions
        deletions
        author { login }
        updatedAt
        url
        headRefOid
        baseRefOid
      }
    }
  }
}
`;
      const response = yield* githubGraphql(
        repo.accountId,
        repo.host,
        query,
        { owner, name },
        ListPullRequestsQueryDataSchema,
      );
      return (response.data?.repository?.pullRequests.nodes ?? []).map(toPullRequestSummary);
    });
  }

  getPullRequest(repo: RepoIdentity, number: number) {
    return Effect.gen(function* () {
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const query = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      title
      state
      isDraft
      mergeStateStatus
      mergeable
      additions
      deletions
      author { login }
      updatedAt
      url
      headRefOid
      baseRefOid
      mergedAt
    }
  }
}
`;
      const response = yield* githubGraphql(
        repo.accountId,
        repo.host,
        query,
        { owner, name, number },
        GetPullRequestQueryDataSchema,
      );
      const pullRequest = response.data?.repository?.pullRequest;
      if (!pullRequest) {
        return yield* Effect.fail(new ProviderError(`Pull request #${number} not found`));
      }
      return toPullRequestSummary(pullRequest);
    });
  }

  getPullRequestApprovalState(
    repo: RepoIdentity,
    number: number,
  ): ReturnType<ForgeProvider['getPullRequestApprovalState']> {
    return Effect.gen(function* () {
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const viewerLogin = yield* githubViewerLogin(repo.accountId);
      const reviews: GhPullRequestReview[] = [];
      let page = 1;

      while (true) {
        const pageReviews = yield* githubJson(
          repo.accountId,
          repo.host,
          `/repos/${owner}/${name}/pulls/${number}/reviews?per_page=100&page=${page}`,
          Schema.Array(GhPullRequestReviewSchema),
        );

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
        .sort((left, right) => {
          const leftApprovedAt = left.submitted_at ?? '';
          const rightApprovedAt = right.submitted_at ?? '';
          return Date.parse(rightApprovedAt) - Date.parse(leftApprovedAt);
        })
        .map(toApprovalActor);

      return {
        provider: 'github',
        approvedBy,
        viewerApproved: approvedBy.some((approval) => approval.login === viewerLogin),
        viewerRemoveStrategy: 'dismiss',
        approvalsRequired: null,
        approvalsLeft: null,
      } satisfies PullRequestApprovalState;
    });
  }

  approvePullRequest(
    repo: RepoIdentity,
    number: number,
    headSha: string,
  ): ReturnType<ForgeProvider['approvePullRequest']> {
    return Effect.gen(function* () {
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const trimmedHeadSha = headSha.trim();
      if (!trimmedHeadSha) {
        return yield* Effect.fail(new ProviderError('Head SHA is required'));
      }

      yield* githubJson(
        repo.accountId,
        repo.host,
        `/repos/${owner}/${name}/pulls/${number}/reviews`,
        Schema.Unknown,
        {
          method: 'POST',
          body: {
            commit_id: trimmedHeadSha,
            event: 'APPROVE',
          },
        },
      );
    }).pipe(Effect.asVoid);
  }

  removePullRequestApproval(
    repo: RepoIdentity,
    number: number,
  ): ReturnType<ForgeProvider['removePullRequestApproval']> {
    return Effect.gen(function* () {
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const viewerLogin = yield* githubViewerLogin(repo.accountId);
      const reviews: GhPullRequestReview[] = [];
      let page = 1;

      while (true) {
        const pageReviews = yield* githubJson(
          repo.accountId,
          repo.host,
          `/repos/${owner}/${name}/pulls/${number}/reviews?per_page=100&page=${page}`,
          Schema.Array(GhPullRequestReviewSchema),
        );

        if (pageReviews.length === 0) {
          break;
        }

        reviews.push(...pageReviews);
        if (pageReviews.length < 100) {
          break;
        }

        page += 1;
      }

      const latestViewerReview = latestReviewsByLogin(reviews).get(viewerLogin);
      if (!latestViewerReview || latestViewerReview.state.toUpperCase() !== 'APPROVED') {
        return yield* Effect.fail(new ProviderError('No viewer approval to remove.'));
      }

      yield* githubJson(
        repo.accountId,
        repo.host,
        `/repos/${owner}/${name}/pulls/${number}/reviews/${latestViewerReview.id}/dismissals`,
        Schema.Unknown,
        {
          method: 'PUT',
          body: {
            event: 'DISMISS',
            message: 'Approval removed from desktop review app.',
          },
        },
      );
    }).pipe(Effect.asVoid);
  }

  fetchChangedFiles(repo: RepoIdentity, number: number) {
    return Effect.gen(function* () {
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const seen = new Set<string>();
      const files: PrChangedFile[] = [];
      let page = 1;
      let shouldContinue = true;
      while (shouldContinue) {
        const items = yield* githubJson(
          repo.accountId,
          repo.host,
          `/repos/${owner}/${name}/pulls/${number}/files?per_page=100&page=${page}`,
          Schema.Array(GhChangedFileSchema),
        );
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
    });
  }

  fetchPatch(repo: RepoIdentity, number: number) {
    return Effect.gen(function* () {
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      return yield* githubText(
        repo.accountId,
        repo.host,
        `/repos/${owner}/${name}/pulls/${number}`,
        'application/vnd.github.diff',
      );
    });
  }

  fetchPullRequestRefs(repo: RepoIdentity, number: number) {
    console.info('[github] fetching pull request refs', {
      repo: repo.path,
      number,
    });
    return this.getPullRequest(repo, number).pipe(
      Effect.map((pullRequest) => {
        console.info('[github] fetched pull request refs', {
          repo: repo.path,
          number,
          baseSha: pullRequest.baseSha,
          headSha: pullRequest.headSha,
        });
        return {
          baseSha: pullRequest.baseSha,
          headSha: pullRequest.headSha,
        };
      }),
    );
  }

  fetchFileContent(repo: RepoIdentity, path: string, ref: string) {
    return Effect.gen(function* () {
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      console.info('[github] fetching file content', {
        repo: repo.path,
        path,
        ref,
      });
      const content = yield* githubText(
        repo.accountId,
        repo.host,
        `/repos/${owner}/${name}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
        'application/vnd.github.raw',
      );
      console.info('[github] fetched file content', {
        repo: repo.path,
        path,
        ref,
        length: content.length,
      });
      return content;
    });
  }

  getPullRequestQualityReport(input: PullRequestQualityReportInput) {
    return Effect.gen(function* () {
      const { repo, number, headSha } = input;
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const checkRuns: GhCheckRun[] = [];
      let page = 1;

      while (true) {
        const response = yield* githubJson(
          repo.accountId,
          repo.host,
          `/repos/${owner}/${name}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=100&page=${page}`,
          GhCheckRunsResponseSchema,
        );
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
          const annotations = yield* githubJson(
            repo.accountId,
            repo.host,
            `/repos/${owner}/${name}/check-runs/${checkRun.id}/annotations?per_page=100&page=${annotationPage}`,
            Schema.Array(GhCheckRunAnnotationSchema),
          ).pipe(
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
    });
  }

  gitRemote(repo: RepoIdentity) {
    return Effect.gen(function* () {
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const token = yield* validAccessToken(repo.accountId);
      return {
        url: `https://${repo.host}/${owner}/${name}.git`,
        auth: {
          envConfig: [
            {
              key: `http.https://${repo.host}/.extraHeader`,
              value: `Authorization: Bearer ${token}`,
            },
          ],
        },
      };
    });
  }

  listReviewThreads(repo: RepoIdentity, number: number) {
    return Effect.gen(function* () {
      const [owner, name] = yield* parseOwnerRepoEffect(repo.path);
      const query = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          path
          isResolved
          isOutdated
          line
          originalLine
          startLine
          originalStartLine
          diffSide
          startDiffSide
          subjectType
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              createdAt
              updatedAt
              url
              path
              authorAssociation
              author {
                login
                avatarUrl(size: 64)
              }
              replyTo {
                id
              }
            }
          }
        }
      }
      comments(first: 100) {
        nodes {
          id
          databaseId
          body
          createdAt
          updatedAt
          url
          authorAssociation
          author {
            login
            avatarUrl(size: 64)
          }
        }
      }
    }
  }
}
`;
      const response = yield* githubGraphql(
        repo.accountId,
        repo.host,
        query,
        {
          owner,
          name,
          number,
        },
        ReviewThreadsQueryDataSchema,
      );

      const pullRequest = response.data?.repository?.pullRequest;
      const reviewThreads = (pullRequest?.reviewThreads.nodes ?? []).flatMap(
        (thread): ReviewThread[] => {
          if (thread.comments.nodes.length === 0) return [];
          const comments: ReviewComment[] = thread.comments.nodes.map(toGitHubReviewComment);
          return [
            {
              id: thread.id,
              provider: 'github',
              path: thread.path,
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
    });
  }

  createReviewThread(repo: RepoIdentity, number: number, input: ReviewThreadInput) {
    return Effect.gen(function* () {
      const body = input.body.trim();
      if (!body) return yield* Effect.fail(new ProviderError('Comment body is required'));
      const targetPath = input.path.trim();
      if (input.subjectType !== 'global' && !targetPath) {
        return yield* Effect.fail(new ProviderError('File path is required'));
      }
      if (input.subjectType === 'line' && input.line == null) {
        return yield* Effect.fail(new ProviderError('Line comments require a target line'));
      }

      const pullRequestId = yield* getPullRequestNodeId(repo, number);
      if (input.subjectType === 'global') {
        const query = `
mutation($pullRequestId: ID!, $body: String!) {
  addComment(input: { subjectId: $pullRequestId, body: $body }) {
    commentEdge {
      node {
        id
      }
    }
  }
}
`;

        yield* githubGraphql(
          repo.accountId,
          repo.host,
          query,
          {
            pullRequestId,
            body,
          },
          Schema.Unknown,
        );
        return;
      }

      const query = `
mutation(
  $pullRequestId: ID!,
  $body: String!,
  $path: String!,
  $line: Int,
  $side: DiffSide,
  $startLine: Int,
  $startSide: DiffSide,
  $subjectType: PullRequestReviewThreadSubjectType
) {
  addPullRequestReviewThread(
    input: {
      pullRequestId: $pullRequestId,
      body: $body,
      path: $path,
      line: $line,
      side: $side,
      startLine: $startLine,
      startSide: $startSide,
      subjectType: $subjectType
    }
  ) {
    thread { id }
  }
}
`;

      yield* githubGraphql(
        repo.accountId,
        repo.host,
        query,
        {
          pullRequestId,
          body,
          path: targetPath,
          line: input.line,
          side: input.side,
          startLine: input.startLine,
          startSide: input.startSide,
          subjectType: input.subjectType.toUpperCase(),
        },
        Schema.Unknown,
      );
    });
  }

  replyToReviewThread(repo: RepoIdentity, number: number, threadId: string, body: string) {
    return Effect.gen(function* () {
      const trimmedBody = body.trim();
      if (!threadId.trim()) return yield* Effect.fail(new ProviderError('Thread id is required'));
      if (!trimmedBody) return yield* Effect.fail(new ProviderError('Reply body is required'));
      const query = `
mutation($pullRequestId: ID!, $pullRequestReviewThreadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(
    input: {
      pullRequestId: $pullRequestId,
      pullRequestReviewThreadId: $pullRequestReviewThreadId,
      body: $body
    }
  ) {
    comment { id }
  }
}
`;
      const pullRequestId = yield* getPullRequestNodeId(repo, number);
      yield* githubGraphql(
        repo.accountId,
        repo.host,
        query,
        {
          pullRequestId,
          pullRequestReviewThreadId: threadId.trim(),
          body: trimmedBody,
        },
        Schema.Unknown,
      );
    });
  }

  updateReviewComment(
    repo: RepoIdentity,
    _number: number,
    threadId: string,
    commentId: string,
    body: string,
    subjectType: ReviewThreadInput['subjectType'],
  ) {
    return Effect.gen(function* () {
      const trimmedBody = body.trim();
      if (!commentId.trim()) return yield* Effect.fail(new ProviderError('Comment id is required'));
      if (!trimmedBody) return yield* Effect.fail(new ProviderError('Comment body is required'));
      if (subjectType !== 'global' && !threadId.trim()) {
        return yield* Effect.fail(new ProviderError('Thread id is required'));
      }

      if (subjectType === 'global') {
        const query = `
mutation($id: ID!, $body: String!) {
  updateIssueComment(input: { id: $id, body: $body }) {
    issueComment { id }
  }
}
`;
        yield* githubGraphql(
          repo.accountId,
          repo.host,
          query,
          {
            id: commentId.trim(),
            body: trimmedBody,
          },
          Schema.Unknown,
        );
        return;
      }

      const query = `
mutation($id: ID!, $body: String!) {
  updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) {
    pullRequestReviewComment { id }
  }
}
`;
      yield* githubGraphql(
        repo.accountId,
        repo.host,
        query,
        {
          id: commentId.trim(),
          body: trimmedBody,
        },
        Schema.Unknown,
      );
    });
  }
}

export { GitHubProvider };
