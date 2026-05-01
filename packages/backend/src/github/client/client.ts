import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from '@effect/platform';
import { Effect, Layer, ParseResult, Schema } from 'effect';
import { getErrorMessage } from '../../errors.ts';
import { hostNameFromHost } from '../../repo-id.ts';
import { getValidAccessToken, updateViewerLogin } from '../../auth/provider-auth.ts';
import { AuthTokenStore, type StoredAuthToken } from '../../auth/token-store.ts';
import {
  GitHubClientAccessTokenError,
  type GitHubClientError,
  GitHubClientGraphqlError,
  GitHubClientNotAuthenticated,
  GitHubClientRequestTimeoutError,
  GitHubClientResponseError,
  GitHubClientSchemaDecodeError,
  GitHubClientTokenStoreError,
  GitHubClientTransportError,
  GitHubClientUnexpectedResponseError,
  GitHubClientViewerLoginPersistenceError,
  isGitHubClientError,
} from './errors.ts';
import {
  AddPullRequestReviewDataSchema,
  AddPullRequestReviewThreadDataSchema,
  AddPullRequestReviewThreadReplyDataSchema,
  type GhChangedFile,
  GhChangedFileSchema,
  type GhCheckRunAnnotation,
  GhCheckRunAnnotationSchema,
  GhCheckRunsResponseSchema,
  type GhPendingReviewComment,
  GhPendingReviewCommentSchema,
  type GhPullRequestReview,
  GhPullRequestReviewSchema,
  type GhRestPullRequest,
  GhRestPullRequestSchema,
  type GhRestRepo,
  GhRestRepoSchema,
  GhRestUserSchema,
  GhSearchResponseSchema,
  GetPullRequestQueryDataSchema,
  GitHubErrorBodySchema,
  graphQlResponseSchema,
  type GraphQlResponse,
  ListPullRequestsQueryDataSchema,
  PullRequestNodeIdQueryDataSchema,
  ReviewThreadsQueryDataSchema,
  SearchPullRequestsQueryDataSchema,
  UpdatePullRequestReviewCommentDataSchema,
} from './schemas.ts';
import { githubRoute } from './routes.ts';

type GitHubClientEffect<Success> = Effect.Effect<Success, GitHubClientError>;

type GitHubApiClientShape = {
  storedToken(): GitHubClientEffect<StoredAuthToken | null>;
  user(): GitHubClientEffect<typeof GhRestUserSchema.Type>;
  userOrgs(input?: {
    perPage?: number;
  }): GitHubClientEffect<ReadonlyArray<typeof GhRestUserSchema.Type>>;
  userRepos(input: {
    perPage?: number;
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    affiliation?:
      | 'owner'
      | 'collaborator'
      | 'organization_member'
      | ReadonlyArray<'owner' | 'collaborator' | 'organization_member'>;
  }): GitHubClientEffect<ReadonlyArray<GhRestRepo>>;
  searchRepositories(input: {
    query: string;
    perPage?: number;
  }): GitHubClientEffect<typeof GhSearchResponseSchema.Type>;
  repo(owner: string, name: string): GitHubClientEffect<GhRestRepo>;
  searchPullRequests(
    query: string,
    first: number,
  ): GitHubClientEffect<GraphQlResponse<typeof SearchPullRequestsQueryDataSchema.Type>>;
  repositoryPullRequests(
    owner: string,
    name: string,
  ): GitHubClientEffect<GraphQlResponse<typeof ListPullRequestsQueryDataSchema.Type>>;
  repositoryOpenPullRequests(
    owner: string,
    name: string,
  ): GitHubClientEffect<ReadonlyArray<GhRestPullRequest>>;
  repositoryPullRequest(
    owner: string,
    name: string,
    number: number,
  ): GitHubClientEffect<GraphQlResponse<typeof GetPullRequestQueryDataSchema.Type>>;
  pullRequestNodeId(owner: string, name: string, number: number): GitHubClientEffect<string>;
  pullRequestReviews(input: {
    owner: string;
    name: string;
    number: number;
    page?: number;
    perPage?: number;
  }): GitHubClientEffect<ReadonlyArray<GhPullRequestReview>>;
  createPullRequestReview(input: {
    owner: string;
    name: string;
    number: number;
    commitId: string;
    event: 'APPROVE';
  }): GitHubClientEffect<unknown>;
  dismissPullRequestReview(input: {
    owner: string;
    name: string;
    number: number;
    reviewId: number;
    message: string;
  }): GitHubClientEffect<unknown>;
  pullRequestFiles(input: {
    owner: string;
    name: string;
    number: number;
    page?: number;
    perPage?: number;
  }): GitHubClientEffect<ReadonlyArray<GhChangedFile>>;
  pullRequestPatch(owner: string, name: string, number: number): GitHubClientEffect<string>;
  repoContent(input: {
    owner: string;
    name: string;
    path: string;
    ref: string;
  }): GitHubClientEffect<string>;
  commitCheckRuns(input: {
    owner: string;
    name: string;
    headSha: string;
    page?: number;
    perPage?: number;
  }): GitHubClientEffect<typeof GhCheckRunsResponseSchema.Type>;
  checkRunAnnotations(input: {
    owner: string;
    name: string;
    checkRunId: number;
    page?: number;
    perPage?: number;
  }): GitHubClientEffect<ReadonlyArray<GhCheckRunAnnotation>>;
  reviewThreads(
    owner: string,
    name: string,
    number: number,
  ): GitHubClientEffect<GraphQlResponse<typeof ReviewThreadsQueryDataSchema.Type>>;
  pullRequestReviewComments(input: {
    owner: string;
    name: string;
    number: number;
    reviewId: number;
    perPage?: number;
  }): GitHubClientEffect<ReadonlyArray<GhPendingReviewComment>>;
  addComment(input: { pullRequestId: string; body: string }): GitHubClientEffect<unknown>;
  addPullRequestReviewThread(input: {
    pullRequestId?: string;
    pullRequestReviewId?: string;
    body: string;
    path: string;
    line: number | null;
    side: string | null;
    startLine: number | null;
    startSide: string | null;
    subjectType: string;
  }): GitHubClientEffect<GraphQlResponse<typeof AddPullRequestReviewThreadDataSchema.Type>>;
  addPullRequestReview(input: {
    pullRequestId: string;
    commitOID: string;
  }): GitHubClientEffect<GraphQlResponse<typeof AddPullRequestReviewDataSchema.Type>>;
  addPullRequestReviewThreadReply(input: {
    pullRequestId?: string;
    pullRequestReviewId?: string;
    pullRequestReviewThreadId: string;
    body: string;
  }): GitHubClientEffect<GraphQlResponse<typeof AddPullRequestReviewThreadReplyDataSchema.Type>>;
  updatePullRequestReviewComment(input: {
    id: string;
    body: string;
  }): GitHubClientEffect<GraphQlResponse<typeof UpdatePullRequestReviewCommentDataSchema.Type>>;
  deletePullRequestReviewComment(id: string): GitHubClientEffect<unknown>;
  submitPullRequestReview(input: {
    pullRequestReviewId: string;
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
    body: string | null;
  }): GitHubClientEffect<unknown>;
  deletePullRequestReview(pullRequestReviewId: string): GitHubClientEffect<unknown>;
  resolveReviewThread(threadId: string): GitHubClientEffect<unknown>;
  unresolveReviewThread(threadId: string): GitHubClientEffect<unknown>;
  updateIssueComment(id: string, body: string): GitHubClientEffect<unknown>;
  deleteIssueComment(id: string): GitHubClientEffect<unknown>;
  accessToken(): GitHubClientEffect<string>;
};

class GitHubApiClient extends Effect.Tag('GitHubApiClient')<
  GitHubApiClient,
  GitHubApiClientShape
>() {}

const API_REQUEST_TIMEOUT = '30 seconds';

function parseGitHubErrorBody(text: string) {
  if (!text) {
    return '';
  }

  if (/<html[\s>]/i.test(text) && /bad gateway/i.test(text)) {
    return 'GitHub returned 502 Bad Gateway.';
  }

  try {
    const parsed = Schema.decodeUnknownSync(GitHubErrorBodySchema)(JSON.parse(text));
    return parsed.message ?? text;
  } catch {
    return text;
  }
}

const makeGitHubApiClient = (accountId: string) =>
  Effect.gen(function* () {
    const tokenStore = yield* AuthTokenStore;
    const httpClient = yield* HttpClient.HttpClient;

    const storedToken: GitHubApiClientShape['storedToken'] = Effect.fn(
      'GitHubApiClient.storedToken',
    )(function* () {
      return yield* tokenStore.get(accountId).pipe(
        Effect.mapError(
          (cause) =>
            new GitHubClientTokenStoreError({
              message: getErrorMessage(cause),
              accountId,
              cause,
            }),
        ),
      );
    });

    const requireStoredToken = Effect.fn('GitHubApiClient.requireStoredToken')(function* () {
      const token = yield* storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitHubClientNotAuthenticated({
            message: 'GitHub is not signed in.',
            accountId,
            cause: { accountId },
          }),
        );
      }

      return token;
    });

    const accessToken: GitHubApiClientShape['accessToken'] = Effect.fn(
      'GitHubApiClient.accessToken',
    )(function* () {
      return yield* getValidAccessToken(accountId).pipe(
        Effect.provideService(AuthTokenStore, tokenStore),
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.mapError(
          (cause) =>
            new GitHubClientAccessTokenError({
              message: getErrorMessage(cause),
              accountId,
              cause,
            }),
        ),
      );
    });

    const saveViewerLogin = Effect.fn('GitHubApiClient.saveViewerLogin')(function* (login: string) {
      yield* updateViewerLogin(accountId, login).pipe(
        Effect.provideService(AuthTokenStore, tokenStore),
        Effect.mapError(
          (cause) =>
            new GitHubClientViewerLoginPersistenceError({
              message: getErrorMessage(cause),
              accountId,
              login,
              cause,
            }),
        ),
      );
    });

    const githubApiBase = (host: string) =>
      hostNameFromHost(host) === 'github.com' ? 'https://api.github.com' : `${host}/api/v3`;

    const setDefaultHeaders = (request: HttpClientRequest.HttpClientRequest) =>
      request.pipe(
        HttpClientRequest.accept('application/json'),
        HttpClientRequest.setHeader('User-Agent', 'code-review.app'),
        HttpClientRequest.setHeader('X-GitHub-Api-Version', '2022-11-28'),
      );

    const accept = (value: string) => HttpClientRequest.accept(value);
    const prefixApiHost = (host: string) => HttpClientRequest.prependUrl(githubApiBase(host));
    const prefixGraphqlHost = (host: string) =>
      HttpClientRequest.prependUrl(
        hostNameFromHost(host) === 'github.com' ? 'https://api.github.com' : `${host}/api`,
      );

    const authorize = Effect.fn('GitHubApiClient.authorize')(function* () {
      const token = yield* accessToken();
      return HttpClientRequest.bearerToken(token);
    });

    const jsonRequestBody = (body: unknown) => (request: HttpClientRequest.HttpClientRequest) =>
      request.pipe(
        HttpClientRequest.setHeader('Content-Type', 'application/json'),
        HttpClientRequest.bodyUnsafeJson(body),
      );

    const responseErrorMessage = (error: HttpClientError.ResponseError) =>
      Effect.gen(function* () {
        const body = yield* error.response.text.pipe(Effect.catchAll(() => Effect.succeed('')));
        return parseGitHubErrorBody(body) || `Provider API returned HTTP ${error.response.status}`;
      });

    const parseSchemaError = (error: ParseResult.ParseError) =>
      ParseResult.TreeFormatter.formatError(error).pipe(
        Effect.map(
          (message) =>
            new GitHubClientSchemaDecodeError({
              message,
              cause: error,
            }),
        ),
      );

    const mapHttpError = (error: unknown): Effect.Effect<GitHubClientError> => {
      if (isGitHubClientError(error)) {
        return Effect.succeed(error);
      }

      if (error instanceof ParseResult.ParseError) {
        return parseSchemaError(error);
      }

      if (error instanceof HttpClientError.ResponseError) {
        return responseErrorMessage(error).pipe(
          Effect.map(
            (message) =>
              new GitHubClientResponseError({
                message,
                url: error.request.url,
                status: error.response.status,
                cause: error,
              }),
          ),
        );
      }

      if (HttpClientError.isHttpClientError(error)) {
        return Effect.succeed(
          new GitHubClientTransportError({
            message: error.message,
            cause: error,
          }),
        );
      }

      return Effect.succeed(
        new GitHubClientTransportError({
          message: getErrorMessage(error),
          cause: error,
        }),
      );
    };

    const logApiResponse = (response: HttpClientResponse.HttpClientResponse) =>
      Effect.logInfo('[github api] request').pipe(
        Effect.annotateLogs({
          method: response.request.method,
          url: response.request.url,
          statusCode: response.status,
        }),
      );

    const send = (request: HttpClientRequest.HttpClientRequest) =>
      httpClient.execute(request).pipe(
        Effect.timeoutFail({
          duration: API_REQUEST_TIMEOUT,
          onTimeout: () =>
            new GitHubClientRequestTimeoutError({
              message: `Provider API request timed out after 30s: ${request.url}`,
              url: request.url,
              timeout: API_REQUEST_TIMEOUT,
              cause: { url: request.url, timeout: API_REQUEST_TIMEOUT },
            }),
        }),
        Effect.tap(logApiResponse),
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.catchAll((error) => Effect.flatMap(mapHttpError(error), Effect.fail)),
      );

    const decodeJsonBody =
      <A, I, R>(schema: Schema.Schema<A, I, R>) =>
      (response: Effect.Effect<HttpClientResponse.HttpClientResponse, GitHubClientError>) =>
        response.pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
          Effect.catchAll((error) => Effect.flatMap(mapHttpError(error), Effect.fail)),
        );

    const decodeTextBody = (
      response: Effect.Effect<HttpClientResponse.HttpClientResponse, GitHubClientError>,
    ) =>
      response.pipe(
        Effect.flatMap((httpResponse) => httpResponse.text),
        Effect.catchAll((error) => Effect.flatMap(mapHttpError(error), Effect.fail)),
      );

    const graphqlErrors = <T>(response: GraphQlResponse<T>) => {
      if (!response.errors?.length) {
        return Effect.void;
      }

      const message = response.errors.map((error) => error.message).join('\n');
      return Effect.fail(
        new GitHubClientGraphqlError({
          message: message || 'GitHub returned an unknown GraphQL error',
          messages: response.errors.map((error) => error.message),
          cause: response.errors,
        }),
      );
    };

    const decodeGraphqlBody =
      <A, I, R>(schema: Schema.Schema<A, I, R>) =>
      (response: Effect.Effect<HttpClientResponse.HttpClientResponse, GitHubClientError>) =>
        response.pipe(decodeJsonBody(graphQlResponseSchema(schema)), Effect.tap(graphqlErrors));

    const user: GitHubApiClientShape['user'] = Effect.fn('GitHubApiClient.user')(function* () {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      const response = yield* HttpClientRequest.get(githubRoute('/user')).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(GhRestUserSchema),
      );
      yield* saveViewerLogin(response.login);
      return response;
    });

    const userOrgs: GitHubApiClientShape['userOrgs'] = Effect.fn('GitHubApiClient.userOrgs')(
      function* (input = {}) {
        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.get(
          githubRoute('/user/orgs', {
            query: {
              per_page: input.perPage,
            },
          }),
        ).pipe(
          setDefaultHeaders,
          prefixApiHost(token.host),
          auth,
          send,
          decodeJsonBody(Schema.Array(GhRestUserSchema)),
        );
      },
    );

    const userRepos: GitHubApiClientShape['userRepos'] = Effect.fn('GitHubApiClient.userRepos')(
      function* (input) {
        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.get(
          githubRoute('/user/repos', {
            query: {
              per_page: input.perPage,
              sort: input.sort,
              affiliation: input.affiliation,
            },
          }),
        ).pipe(
          setDefaultHeaders,
          prefixApiHost(token.host),
          auth,
          send,
          decodeJsonBody(Schema.Array(GhRestRepoSchema)),
        );
      },
    );

    const searchRepositories: GitHubApiClientShape['searchRepositories'] = Effect.fn(
      'GitHubApiClient.searchRepositories',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        githubRoute('/search/repositories', {
          query: {
            q: input.query,
            per_page: input.perPage,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(GhSearchResponseSchema),
      );
    });

    const repo: GitHubApiClientShape['repo'] = Effect.fn('GitHubApiClient.repo')(
      function* (owner, name) {
        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.get(
          githubRoute('/repos/:owner/:name', {
            params: { owner, name },
          }),
        ).pipe(
          setDefaultHeaders,
          prefixApiHost(token.host),
          auth,
          send,
          decodeJsonBody(GhRestRepoSchema),
        );
      },
    );

    const searchPullRequests: GitHubApiClientShape['searchPullRequests'] = Effect.fn(
      'GitHubApiClient.searchPullRequests',
    )(function* (query, first) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post('/graphql').pipe(
        setDefaultHeaders,
        prefixGraphqlHost(token.host),
        auth,
        jsonRequestBody({
          query: `
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
`,
          variables: { query, first },
        }),
        send,
        decodeGraphqlBody(SearchPullRequestsQueryDataSchema),
      );
    });

    const repositoryPullRequests: GitHubApiClientShape['repositoryPullRequests'] = Effect.fn(
      'GitHubApiClient.repositoryPullRequests',
    )(function* (owner, name) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post('/graphql').pipe(
        setDefaultHeaders,
        prefixGraphqlHost(token.host),
        auth,
        jsonRequestBody({
          query: `
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
`,
          variables: { owner, name },
        }),
        send,
        decodeGraphqlBody(ListPullRequestsQueryDataSchema),
      );
    });

    const repositoryOpenPullRequests: GitHubApiClientShape['repositoryOpenPullRequests'] =
      Effect.fn('GitHubApiClient.repositoryOpenPullRequests')(function* (owner, name) {
        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.get(
          githubRoute('/repos/:owner/:name/pulls', {
            params: { owner, name },
            query: {
              state: 'open',
              per_page: 100,
            },
          }),
        ).pipe(
          setDefaultHeaders,
          prefixApiHost(token.host),
          auth,
          send,
          decodeJsonBody(Schema.Array(GhRestPullRequestSchema)),
        );
      });

    const repositoryPullRequest: GitHubApiClientShape['repositoryPullRequest'] = Effect.fn(
      'GitHubApiClient.repositoryPullRequest',
    )(function* (owner, name, number) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post('/graphql').pipe(
        setDefaultHeaders,
        prefixGraphqlHost(token.host),
        auth,
        jsonRequestBody({
          query: `
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
`,
          variables: { owner, name, number },
        }),
        send,
        decodeGraphqlBody(GetPullRequestQueryDataSchema),
      );
    });

    const pullRequestNodeId: GitHubApiClientShape['pullRequestNodeId'] = Effect.fn(
      'GitHubApiClient.pullRequestNodeId',
    )(function* (owner, name, number) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      const response = yield* HttpClientRequest.post('/graphql').pipe(
        setDefaultHeaders,
        prefixGraphqlHost(token.host),
        auth,
        jsonRequestBody({
          query: `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
    }
  }
}
`,
          variables: { owner, name, number },
        }),
        send,
        decodeGraphqlBody(PullRequestNodeIdQueryDataSchema),
      );

      const id = response.data?.repository?.pullRequest?.id?.trim();
      if (!id) {
        return yield* Effect.fail(
          new GitHubClientUnexpectedResponseError({
            message: 'Pull request not found',
            cause: response,
          }),
        );
      }

      return id;
    });

    const pullRequestReviews: GitHubApiClientShape['pullRequestReviews'] = Effect.fn(
      'GitHubApiClient.pullRequestReviews',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        githubRoute('/repos/:owner/:name/pulls/:number/reviews', {
          params: {
            owner: input.owner,
            name: input.name,
            number: input.number,
          },
          query: {
            per_page: input.perPage,
            page: input.page,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(Schema.Array(GhPullRequestReviewSchema)),
      );
    });

    const createPullRequestReview: GitHubApiClientShape['createPullRequestReview'] = Effect.fn(
      'GitHubApiClient.createPullRequestReview',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post(
        githubRoute('/repos/:owner/:name/pulls/:number/reviews', {
          params: {
            owner: input.owner,
            name: input.name,
            number: input.number,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        jsonRequestBody({
          commit_id: input.commitId,
          event: input.event,
        }),
        send,
        decodeJsonBody(Schema.Unknown),
      );
    });

    const dismissPullRequestReview: GitHubApiClientShape['dismissPullRequestReview'] = Effect.fn(
      'GitHubApiClient.dismissPullRequestReview',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.put(
        githubRoute('/repos/:owner/:name/pulls/:number/reviews/:reviewId/dismissals', {
          params: {
            owner: input.owner,
            name: input.name,
            number: input.number,
            reviewId: input.reviewId,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        jsonRequestBody({
          event: 'DISMISS',
          message: input.message,
        }),
        send,
        decodeJsonBody(Schema.Unknown),
      );
    });

    const pullRequestFiles: GitHubApiClientShape['pullRequestFiles'] = Effect.fn(
      'GitHubApiClient.pullRequestFiles',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        githubRoute('/repos/:owner/:name/pulls/:number/files', {
          params: {
            owner: input.owner,
            name: input.name,
            number: input.number,
          },
          query: {
            per_page: input.perPage,
            page: input.page,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(Schema.Array(GhChangedFileSchema)),
      );
    });

    const pullRequestPatch: GitHubApiClientShape['pullRequestPatch'] = Effect.fn(
      'GitHubApiClient.pullRequestPatch',
    )(function* (owner, name, number) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        githubRoute('/repos/:owner/:name/pulls/:number', {
          params: { owner, name, number },
        }),
      ).pipe(
        setDefaultHeaders,
        accept('application/vnd.github.diff'),
        prefixApiHost(token.host),
        auth,
        send,
        decodeTextBody,
      );
    });

    const repoContent: GitHubApiClientShape['repoContent'] = Effect.fn(
      'GitHubApiClient.repoContent',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        githubRoute('/repos/:owner/:name/contents/:path', {
          params: {
            owner: input.owner,
            name: input.name,
            path: { raw: input.path },
          },
          query: { ref: input.ref },
        }),
      ).pipe(
        setDefaultHeaders,
        accept('application/vnd.github.raw'),
        prefixApiHost(token.host),
        auth,
        send,
        decodeTextBody,
      );
    });

    const commitCheckRuns: GitHubApiClientShape['commitCheckRuns'] = Effect.fn(
      'GitHubApiClient.commitCheckRuns',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        githubRoute('/repos/:owner/:name/commits/:headSha/check-runs', {
          params: {
            owner: input.owner,
            name: input.name,
            headSha: input.headSha,
          },
          query: {
            per_page: input.perPage,
            page: input.page,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(GhCheckRunsResponseSchema),
      );
    });

    const checkRunAnnotations: GitHubApiClientShape['checkRunAnnotations'] = Effect.fn(
      'GitHubApiClient.checkRunAnnotations',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        githubRoute('/repos/:owner/:name/check-runs/:checkRunId/annotations', {
          params: {
            owner: input.owner,
            name: input.name,
            checkRunId: input.checkRunId,
          },
          query: {
            per_page: input.perPage,
            page: input.page,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(Schema.Array(GhCheckRunAnnotationSchema)),
      );
    });

    const reviewThreads: GitHubApiClientShape['reviewThreads'] = Effect.fn(
      'GitHubApiClient.reviewThreads',
    )(function* (owner, name, number) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post('/graphql').pipe(
        setDefaultHeaders,
        prefixGraphqlHost(token.host),
        auth,
        jsonRequestBody({
          query: `
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
`,
          variables: { owner, name, number },
        }),
        send,
        decodeGraphqlBody(ReviewThreadsQueryDataSchema),
      );
    });

    const pullRequestReviewComments: GitHubApiClientShape['pullRequestReviewComments'] = Effect.fn(
      'GitHubApiClient.pullRequestReviewComments',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        githubRoute('/repos/:owner/:name/pulls/:number/reviews/:reviewId/comments', {
          params: {
            owner: input.owner,
            name: input.name,
            number: input.number,
            reviewId: input.reviewId,
          },
          query: {
            per_page: input.perPage,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(Schema.Array(GhPendingReviewCommentSchema)),
      );
    });

    const addComment: GitHubApiClientShape['addComment'] = Effect.fn('GitHubApiClient.addComment')(
      function* (input) {
        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.post('/graphql').pipe(
          setDefaultHeaders,
          prefixGraphqlHost(token.host),
          auth,
          jsonRequestBody({
            query: `
mutation($pullRequestId: ID!, $body: String!) {
  addComment(input: { subjectId: $pullRequestId, body: $body }) {
    commentEdge {
      node {
        id
      }
    }
  }
}
`,
            variables: input,
          }),
          send,
          decodeGraphqlBody(Schema.Unknown),
        );
      },
    );

    const addPullRequestReviewThread: GitHubApiClientShape['addPullRequestReviewThread'] =
      Effect.fn('GitHubApiClient.addPullRequestReviewThread')(function* (input) {
        const idField = input.pullRequestReviewId ? 'pullRequestReviewId' : 'pullRequestId';
        const idVariableName = input.pullRequestReviewId
          ? '$pullRequestReviewId: ID!'
          : '$pullRequestId: ID!';
        const idVariable = input.pullRequestReviewId
          ? { pullRequestReviewId: input.pullRequestReviewId }
          : { pullRequestId: input.pullRequestId };

        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.post('/graphql').pipe(
          setDefaultHeaders,
          prefixGraphqlHost(token.host),
          auth,
          jsonRequestBody({
            query: `
mutation(
  ${idVariableName},
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
      ${idField}: $${idField},
      body: $body,
      path: $path,
      line: $line,
      side: $side,
      startLine: $startLine,
      startSide: $startSide,
      subjectType: $subjectType
    }
  ) {
    thread {
      id
      comments(last: 1) { nodes { id } }
    }
  }
}
`,
            variables: {
              ...idVariable,
              body: input.body,
              path: input.path,
              line: input.line,
              side: input.side,
              startLine: input.startLine,
              startSide: input.startSide,
              subjectType: input.subjectType,
            },
          }),
          send,
          decodeGraphqlBody(AddPullRequestReviewThreadDataSchema),
        );
      });

    const addPullRequestReview: GitHubApiClientShape['addPullRequestReview'] = Effect.fn(
      'GitHubApiClient.addPullRequestReview',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post('/graphql').pipe(
        setDefaultHeaders,
        prefixGraphqlHost(token.host),
        auth,
        jsonRequestBody({
          query: `
mutation($pullRequestId: ID!, $commitOID: GitObjectID!) {
  addPullRequestReview(input: { pullRequestId: $pullRequestId, commitOID: $commitOID }) {
    pullRequestReview { id }
  }
}
`,
          variables: input,
        }),
        send,
        decodeGraphqlBody(AddPullRequestReviewDataSchema),
      );
    });

    const addPullRequestReviewThreadReply: GitHubApiClientShape['addPullRequestReviewThreadReply'] =
      Effect.fn('GitHubApiClient.addPullRequestReviewThreadReply')(function* (input) {
        const idField = input.pullRequestReviewId ? 'pullRequestReviewId' : 'pullRequestId';
        const idVariableName = input.pullRequestReviewId
          ? '$pullRequestReviewId: ID!'
          : '$pullRequestId: ID!';
        const idVariable = input.pullRequestReviewId
          ? { pullRequestReviewId: input.pullRequestReviewId }
          : { pullRequestId: input.pullRequestId };

        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.post('/graphql').pipe(
          setDefaultHeaders,
          prefixGraphqlHost(token.host),
          auth,
          jsonRequestBody({
            query: `
mutation(${idVariableName}, $pullRequestReviewThreadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(
    input: {
      ${idField}: $${idField},
      pullRequestReviewThreadId: $pullRequestReviewThreadId,
      body: $body
    }
  ) {
    comment { id }
  }
}
`,
            variables: {
              ...idVariable,
              pullRequestReviewThreadId: input.pullRequestReviewThreadId,
              body: input.body,
            },
          }),
          send,
          decodeGraphqlBody(AddPullRequestReviewThreadReplyDataSchema),
        );
      });

    const updatePullRequestReviewComment: GitHubApiClientShape['updatePullRequestReviewComment'] =
      Effect.fn('GitHubApiClient.updatePullRequestReviewComment')(function* (input) {
        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.post('/graphql').pipe(
          setDefaultHeaders,
          prefixGraphqlHost(token.host),
          auth,
          jsonRequestBody({
            query: `
mutation($id: ID!, $body: String!) {
  updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) {
    pullRequestReviewComment { id }
  }
}
`,
            variables: input,
          }),
          send,
          decodeGraphqlBody(UpdatePullRequestReviewCommentDataSchema),
        );
      });

    const deletePullRequestReviewComment: GitHubApiClientShape['deletePullRequestReviewComment'] =
      Effect.fn('GitHubApiClient.deletePullRequestReviewComment')(function* (id) {
        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.post('/graphql').pipe(
          setDefaultHeaders,
          prefixGraphqlHost(token.host),
          auth,
          jsonRequestBody({
            query: `
mutation($id: ID!) {
  deletePullRequestReviewComment(input: { id: $id }) {
    pullRequestReviewComment { id }
  }
}
`,
            variables: { id },
          }),
          send,
          decodeGraphqlBody(Schema.Unknown),
        );
      });

    const submitPullRequestReview: GitHubApiClientShape['submitPullRequestReview'] = Effect.fn(
      'GitHubApiClient.submitPullRequestReview',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post('/graphql').pipe(
        setDefaultHeaders,
        prefixGraphqlHost(token.host),
        auth,
        jsonRequestBody({
          query: `
mutation($pullRequestReviewId: ID!, $event: PullRequestReviewEvent!, $body: String) {
  submitPullRequestReview(input: { pullRequestReviewId: $pullRequestReviewId, event: $event, body: $body }) {
    pullRequestReview { id }
  }
}
`,
          variables: input,
        }),
        send,
        decodeGraphqlBody(Schema.Unknown),
      );
    });

    const deletePullRequestReview: GitHubApiClientShape['deletePullRequestReview'] = Effect.fn(
      'GitHubApiClient.deletePullRequestReview',
    )(function* (pullRequestReviewId) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post('/graphql').pipe(
        setDefaultHeaders,
        prefixGraphqlHost(token.host),
        auth,
        jsonRequestBody({
          query: `
mutation($pullRequestReviewId: ID!) {
  deletePullRequestReview(input: { pullRequestReviewId: $pullRequestReviewId }) {
    pullRequestReview { id }
  }
}
`,
          variables: { pullRequestReviewId },
        }),
        send,
        decodeGraphqlBody(Schema.Unknown),
      );
    });

    const resolveReviewThread: GitHubApiClientShape['resolveReviewThread'] = Effect.fn(
      'GitHubApiClient.resolveReviewThread',
    )(function* (threadId) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post('/graphql').pipe(
        setDefaultHeaders,
        prefixGraphqlHost(token.host),
        auth,
        jsonRequestBody({
          query: `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id }
  }
}
`,
          variables: { threadId },
        }),
        send,
        decodeGraphqlBody(Schema.Unknown),
      );
    });

    const unresolveReviewThread: GitHubApiClientShape['unresolveReviewThread'] = Effect.fn(
      'GitHubApiClient.unresolveReviewThread',
    )(function* (threadId) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post('/graphql').pipe(
        setDefaultHeaders,
        prefixGraphqlHost(token.host),
        auth,
        jsonRequestBody({
          query: `
mutation($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) {
    thread { id }
  }
}
`,
          variables: { threadId },
        }),
        send,
        decodeGraphqlBody(Schema.Unknown),
      );
    });

    const updateIssueComment: GitHubApiClientShape['updateIssueComment'] = Effect.fn(
      'GitHubApiClient.updateIssueComment',
    )(function* (id, body) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post('/graphql').pipe(
        setDefaultHeaders,
        prefixGraphqlHost(token.host),
        auth,
        jsonRequestBody({
          query: `
mutation($id: ID!, $body: String!) {
  updateIssueComment(input: { id: $id, body: $body }) {
    issueComment { id }
  }
}
`,
          variables: { id, body },
        }),
        send,
        decodeGraphqlBody(Schema.Unknown),
      );
    });

    const deleteIssueComment: GitHubApiClientShape['deleteIssueComment'] = Effect.fn(
      'GitHubApiClient.deleteIssueComment',
    )(function* (id) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post('/graphql').pipe(
        setDefaultHeaders,
        prefixGraphqlHost(token.host),
        auth,
        jsonRequestBody({
          query: `
mutation($id: ID!) {
  deleteIssueComment(input: { id: $id }) {
    clientMutationId
  }
}
`,
          variables: { id },
        }),
        send,
        decodeGraphqlBody(Schema.Unknown),
      );
    });

    return {
      storedToken,
      user,
      userOrgs,
      userRepos,
      searchRepositories,
      repo,
      searchPullRequests,
      repositoryPullRequests,
      repositoryOpenPullRequests,
      repositoryPullRequest,
      pullRequestNodeId,
      pullRequestReviews,
      createPullRequestReview,
      dismissPullRequestReview,
      pullRequestFiles,
      pullRequestPatch,
      repoContent,
      commitCheckRuns,
      checkRunAnnotations,
      reviewThreads,
      pullRequestReviewComments,
      addComment,
      addPullRequestReviewThread,
      addPullRequestReview,
      addPullRequestReviewThreadReply,
      updatePullRequestReviewComment,
      deletePullRequestReviewComment,
      submitPullRequestReview,
      deletePullRequestReview,
      resolveReviewThread,
      unresolveReviewThread,
      updateIssueComment,
      deleteIssueComment,
      accessToken,
    } satisfies GitHubApiClientShape;
  });

const GitHubApiClientLive = (accountId: string) =>
  Layer.effect(GitHubApiClient, makeGitHubApiClient(accountId));

export { GitHubApiClient, GitHubApiClientLive, makeGitHubApiClient };
export type { GitHubApiClientShape };
