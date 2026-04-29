import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Effect, ParseResult, Schema } from "effect";
import { ProviderError } from "../errors.ts";
import { parseOwnerRepo } from "../repo-id.ts";
import { createRepoIdentity } from "../repo-id.ts";
import {
  getValidAccessToken,
  updateViewerLogin,
} from "../auth/provider-auth.ts";
import type {
  ProviderAuthStatus,
  PrChangedFile,
  PullRequestSummary,
  RepoSummary,
  ReviewComment,
  ReviewThread,
} from "@rudu/shared";
import type { ForgeProvider, ReviewThreadInput } from "./types.ts";
import type { RepoIdentity } from "../repo-id.ts";
import { AuthTokenStore, type StoredAuthToken } from "../auth/token-store.ts";

type GitHubRequestOptions = {
  method?: "GET" | "POST";
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

const API_REQUEST_TIMEOUT = "30 seconds";
const USER_CONTEXT_TTL_MS = 60 * 60 * 1000;

const NullableString = Schema.NullOr(Schema.String);
const OptionalNullableString = Schema.optional(Schema.NullOr(Schema.String));
const OptionalNullableNumber = Schema.optional(Schema.NullOr(Schema.Number));

const GhActorSchema = Schema.Struct({
  login: Schema.String,
  avatarUrl: OptionalNullableString,
  avatar_url: OptionalNullableString,
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

type GhChangedFile = typeof GhChangedFileSchema.Type;

function toChangedFile(item: GhChangedFile): PrChangedFile {
  const filename = item.filename.trim();
  const previousFilename = item.previous_filename?.trim() || filename;

  if (item.status === "added") {
    return {
      path: filename,
      oldPath: "",
      newPath: filename,
      changeType: "new",
    };
  }

  if (item.status === "removed") {
    return {
      path: filename,
      oldPath: filename,
      newPath: "",
      changeType: "deleted",
    };
  }

  if (item.status === "renamed") {
    return {
      path: filename,
      oldPath: previousFilename,
      newPath: filename,
      changeType: item.changes === 0 ? "rename-pure" : "rename-changed",
    };
  }

  return {
    path: filename,
    oldPath: filename,
    newPath: filename,
    changeType: "change",
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
    if (!token) return yield* Effect.fail(new ProviderError("GitHub is not signed in."));
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
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isNotAuthenticatedMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not logged") ||
    normalized.includes("bad credentials") ||
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authenticate") ||
    (normalized.includes("github.com") && normalized.includes("login"))
  );
}

function parseGitHubErrorBody(text: string) {
  if (!text) return "";
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
    const body = yield* error.response.text.pipe(
      Effect.catchAll(() => Effect.succeed("")),
    );
    return (
      parseGitHubErrorBody(body) ||
      `Provider API returned HTTP ${error.response.status}`
    );
  });
}

function mapHttpError(error: unknown) {
  if (error instanceof ProviderError) return Effect.succeed(error);
  if (error instanceof ParseResult.ParseError) return parseErrorMessage(error);
  if (error instanceof HttpClientError.ResponseError) {
    return Effect.map(responseErrorMessage(error), (message) => new ProviderError(message));
  }
  if (HttpClientError.isHttpClientError(error)) {
    return Effect.succeed(new ProviderError(error.message));
  }
  return Effect.succeed(toProviderError(error));
}

function graphqlErrors<T>(response: GraphQlResponse<T>): Effect.Effect<void, ProviderError> {
  if (!response.errors?.length) return Effect.void;
  const message = response.errors.map((error) => error.message).join("\n");
  return Effect.fail(
    new ProviderError(message || "GitHub returned an unknown GraphQL error"),
  );
}

function githubApiBase(host: string) {
  return host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
}

function githubGraphqlUrl(host: string) {
  return host === "github.com" ? "https://api.github.com/graphql" : `https://${host}/api/graphql`;
}

function githubApiUrl(host: string, pathOrUrl: string) {
  return pathOrUrl.startsWith("http") ? pathOrUrl : `${githubApiBase(host)}${pathOrUrl}`;
}

function requestFor(url: string, token: string, options: GitHubRequestOptions = {}) {
  const request =
    options.method === "POST"
      ? HttpClientRequest.post(url)
      : HttpClientRequest.get(url);

  return request.pipe(
    HttpClientRequest.accept(options.accept ?? "application/json"),
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.setHeader("User-Agent", "rudu"),
    HttpClientRequest.setHeader("X-GitHub-Api-Version", "2022-11-28"),
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
        HttpClientRequest.setHeader("Content-Type", "application/json"),
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
        method: "POST",
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

    const user = yield* githubJson(accountId, host, "/user", GhRestUserSchema);
    const owners = [user.login];

    const orgs = yield* githubJson(
      accountId,
      host,
      "/user/orgs?per_page=100",
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
      return yield* Effect.fail(new ProviderError("Pull request not found"));
    }
    return id;
  });
}

function repoSummaryFromSearch(accountId: string, host: string, label: string, repo: GhSearchRepo): RepoSummary {
  return {
    ...createRepoIdentity("github", host, accountId, repo.full_name),
    provider: "github",
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

function repoSummaryFromRest(accountId: string, host: string, label: string, repo: GhRestRepo): RepoSummary {
  return {
    ...createRepoIdentity("github", host, accountId, repo.full_name),
    provider: "github",
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
    ...createRepoIdentity("github", host, accountId, repo.nameWithOwner),
    provider: "github",
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
    state: merged ? "MERGED" : pullRequest.state,
    isDraft: pullRequest.isDraft,
    mergeStateStatus: pullRequest.mergeStateStatus ?? "UNKNOWN",
    mergeable: pullRequest.mergeable ?? "UNKNOWN",
    additions: pullRequest.additions ?? null,
    deletions: pullRequest.deletions ?? null,
    changeCount: null,
    authorLogin: pullRequest.author?.login ?? "unknown",
    updatedAt: pullRequest.updatedAt,
    url: pullRequest.url,
    headSha: pullRequest.headRefOid,
    baseSha: pullRequest.baseRefOid ?? null,
  };
}

class GitHubProvider implements ForgeProvider {
  authStatus(accountId: string): ReturnType<ForgeProvider["authStatus"]> {
    const provider = this;
    return Effect.gen(function* () {
      const token = yield* storedToken(accountId);
      if (!token) {
        return {
          status: "not_authenticated",
          message: "Sign in with GitHub to load repositories.",
        } satisfies ProviderAuthStatus;
      }
      yield* provider.viewerLogin(accountId);
      return { status: "ready", message: null } satisfies ProviderAuthStatus;
    }).pipe(
      Effect.catchAll((error) => {
        const message = error instanceof Error ? error.message : String(error);
        const status: ProviderAuthStatus = isNotAuthenticatedMessage(message)
          ? {
              status: "not_authenticated",
              message: "Sign in with GitHub again.",
            }
          : {
              status: "unknown_error",
              message,
            };
        return Effect.succeed(status);
      }),
    ) as ReturnType<ForgeProvider["authStatus"]>;
  }

  viewerLogin(accountId: string) {
    return Effect.gen(function* () {
      const token = yield* requireStoredToken(accountId);
      yield* ensureUserContext(accountId, token.host);
      const login = userContext?.login;
      if (!login) {
        return yield* Effect.fail(new ProviderError("Unable to determine GitHub viewer login"));
      }
      return login;
    });
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
    const provider = this;
    return Effect.gen(function* () {
      const token = yield* requireStoredToken(accountId);
      const label = labelForToken(token);
      const trimmedQuery = query.trim();
      if (trimmedQuery.length === 0) {
        return yield* provider.listInitialRepos(accountId, limit);
      }

      const owners = yield* ensureUserContext(accountId, token.host);
      const repos: GhSearchRepo[] = [];
      for (const owner of owners) {
        const qualifier = owner === userContext?.login ? "user" : "org";
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
      if (repo.split("/").length !== 2 || repo.startsWith("/") || repo.endsWith("/")) {
        return yield* Effect.fail(new ProviderError("Enter a repo as owner/name"));
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
        return yield* Effect.fail(new ProviderError("Unable to determine GitHub viewer login"));
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
      console.info(
        `[github] loading overview pull requests from ${token.host} for ${login}`,
      );
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

      console.info(
        `[github] loaded ${entries.length} overview pull requests from ${token.host}`,
      );
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
      return (response.data?.repository?.pullRequests.nodes ?? []).map(
        toPullRequestSummary,
      );
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
        "application/vnd.github.diff",
      );
    });
  }

  fetchPullRequestRefs(repo: RepoIdentity, number: number) {
    console.info("[github] fetching pull request refs", {
      repo: repo.path,
      number,
    });
    return this.getPullRequest(repo, number).pipe(
      Effect.map((pullRequest) => {
        console.info("[github] fetched pull request refs", {
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
      console.info("[github] fetching file content", {
        repo: repo.path,
        path,
        ref,
      });
      const content = yield* githubText(
        repo.accountId,
        repo.host,
        `/repos/${owner}/${name}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
        "application/vnd.github.raw",
      );
      console.info("[github] fetched file content", {
        repo: repo.path,
        path,
        ref,
        length: content.length,
      });
      return content;
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

      return (
        response.data?.repository?.pullRequest?.reviewThreads.nodes ?? []
      ).flatMap((thread): ReviewThread[] => {
        if (thread.comments.nodes.length === 0) return [];
        const comments: ReviewComment[] = thread.comments.nodes.map((comment) => ({
          id: comment.id,
          databaseId: comment.databaseId ?? null,
          authorLogin: comment.author?.login ?? "unknown",
          authorAvatarUrl: comment.author?.avatarUrl ?? null,
          authorAssociation: comment.authorAssociation ?? null,
          body: comment.body,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          url: comment.url,
          replyToId: comment.replyTo?.id ?? null,
        }));
        return [
          {
            id: thread.id,
            provider: "github",
            path: thread.path,
            isResolved: thread.isResolved,
            isOutdated: thread.isOutdated,
            line: thread.line ?? thread.originalLine ?? null,
            startLine: thread.startLine ?? thread.originalStartLine ?? null,
            side: thread.diffSide === "LEFT" ? "LEFT" : "RIGHT",
            startSide:
              thread.startDiffSide === "LEFT" || thread.startDiffSide === "RIGHT"
                ? thread.startDiffSide
                : null,
            subjectType:
              thread.subjectType.toLowerCase() === "file" ? "file" : "line",
            comments,
          },
        ];
      });
    });
  }

  createReviewThread(repo: RepoIdentity, number: number, input: ReviewThreadInput) {
    return Effect.gen(function* () {
      const body = input.body.trim();
      const targetPath = input.path.trim();
      if (!body) return yield* Effect.fail(new ProviderError("Comment body is required"));
      if (!targetPath) return yield* Effect.fail(new ProviderError("File path is required"));
      if (input.subjectType === "line" && input.line == null) {
        return yield* Effect.fail(new ProviderError("Line comments require a target line"));
      }

      const pullRequestId = yield* getPullRequestNodeId(repo, number);
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
      if (!threadId.trim()) return yield* Effect.fail(new ProviderError("Thread id is required"));
      if (!trimmedBody) return yield* Effect.fail(new ProviderError("Reply body is required"));
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
  ) {
    return Effect.gen(function* () {
      const trimmedBody = body.trim();
      if (!threadId.trim()) return yield* Effect.fail(new ProviderError("Thread id is required"));
      if (!commentId.trim()) return yield* Effect.fail(new ProviderError("Comment id is required"));
      if (!trimmedBody) return yield* Effect.fail(new ProviderError("Comment body is required"));
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
