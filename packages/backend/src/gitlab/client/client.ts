import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from '@effect/platform';
import { Effect, Layer, ParseResult, Schema } from 'effect';
import { getErrorMessage } from '../../errors.ts';
import { getValidAccessToken, updateViewerLogin } from '../../auth/provider-auth.ts';
import { AuthTokenStore, type StoredAuthToken } from '../../auth/token-store.ts';
import { rawPathParam } from '../../providers/route.ts';
import {
  GitLabClientAccessTokenError,
  type GitLabClientError,
  GitLabClientGraphqlError,
  GitLabClientNotAuthenticated,
  GitLabClientRequestTimeoutError,
  GitLabClientResponseError,
  GitLabClientSchemaDecodeError,
  GitLabClientTokenStoreError,
  GitLabClientTransportError,
  GitLabClientViewerLoginPersistenceError,
  isGitLabClientError,
} from './errors.ts';
import {
  GitLabCodeQualityGraphqlQueryDataSchema,
  type GitLabDiff,
  GitLabDiffSchema,
  type GitLabDiscussion,
  GitLabDiscussionSchema,
  type GitLabDraftNote,
  GitLabDraftNoteSchema,
  GitLabErrorBodySchema,
  graphQlResponseSchema,
  GitLabMergeRequestApprovalsSchema,
  type GitLabGroup,
  GitLabGroupSchema,
  type GitLabMergeRequest,
  GitLabMergeRequestSchema,
  type GitLabMrVersion,
  GitLabMrVersionSchema,
  type GitLabNote,
  GitLabNoteSchema,
  type GitLabProject,
  GitLabProjectSchema,
  GitLabUserSchema,
} from './schemas.ts';
import { gitlabRoute, type GitLabSearchMergeRequestState } from './routes.ts';

type GitLabClientEffect<Success> = Effect.Effect<Success, GitLabClientError>;

export type CreateGitLabDraftNoteInput = {
  note: string;
  inReplyToDiscussionId?: string;
  position?:
    | {
        positionType: 'file';
        baseSha: string;
        headSha: string;
        startSha: string;
        oldPath: string;
        newPath: string;
      }
    | {
        positionType: 'text';
        baseSha: string;
        headSha: string;
        startSha: string;
        oldPath: string;
        newPath: string;
        lineRange?: {
          start: {
            type?: 'new' | 'old' | null;
            oldLine?: number;
            newLine?: number;
            lineCode?: string;
          };
          end: {
            type?: 'new' | 'old' | null;
            oldLine?: number;
            newLine?: number;
            lineCode?: string;
          };
        };
        oldLine?: number;
        newLine?: number;
      };
};

type GitLabApiClientShape = {
  storedToken(): GitLabClientEffect<StoredAuthToken | null>;
  user(): GitLabClientEffect<typeof GitLabUserSchema.Type>;
  projects(input: {
    membership?: boolean;
    simple?: boolean;
    perPage?: number;
    search?: string;
  }): GitLabClientEffect<ReadonlyArray<GitLabProject>>;
  groups(input: {
    allAvailable?: boolean;
    perPage?: number;
    search?: string;
  }): GitLabClientEffect<ReadonlyArray<GitLabGroup>>;
  groupProjects(input: {
    group: string;
    includeSubgroups?: boolean;
    simple?: boolean;
    perPage?: number;
  }): GitLabClientEffect<ReadonlyArray<GitLabProject>>;
  overviewMergeRequests(input: {
    scope: 'reviews_for_me' | 'assigned_to_me' | 'created_by_me';
    state?: GitLabSearchMergeRequestState;
    perPage?: number;
    search?: string;
    in?: 'title';
  }): GitLabClientEffect<ReadonlyArray<GitLabMergeRequest>>;
  searchMergeRequests(input: {
    state: GitLabSearchMergeRequestState;
    perPage?: number;
    page?: number;
    search?: string;
  }): GitLabClientEffect<ReadonlyArray<GitLabMergeRequest>>;
  project(project: string | number): GitLabClientEffect<GitLabProject>;
  projectMergeRequests(input: {
    project: string;
    state?: 'opened' | 'closed' | 'locked' | 'merged' | 'all';
    orderBy?: 'updated_at' | 'created_at';
    sort?: 'desc' | 'asc';
    perPage?: number;
    search?: string;
    in?: 'title';
  }): GitLabClientEffect<ReadonlyArray<GitLabMergeRequest>>;
  mergeRequest(project: string, number: number): GitLabClientEffect<GitLabMergeRequest>;
  mergeRequestApprovals(
    project: string,
    number: number,
  ): GitLabClientEffect<typeof GitLabMergeRequestApprovalsSchema.Type>;
  approveMergeRequest(project: string, number: number, sha: string): GitLabClientEffect<void>;
  unapproveMergeRequest(project: string, number: number): GitLabClientEffect<void>;
  mergeRequestDiffs(input: {
    project: string;
    number: number;
    perPage?: number;
    page?: number;
  }): GitLabClientEffect<ReadonlyArray<GitLabDiff>>;
  mergeRequestRawDiffs(project: string, number: number): GitLabClientEffect<string>;
  mergeRequestVersions(
    project: string,
    number: number,
  ): GitLabClientEffect<ReadonlyArray<GitLabMrVersion>>;
  repositoryFileRaw(input: {
    project: string;
    path: string;
    ref: string;
  }): GitLabClientEffect<string>;
  codeQualityReportsComparer(
    fullPath: string,
    iid: string,
  ): GitLabClientEffect<{
    readonly data?: typeof GitLabCodeQualityGraphqlQueryDataSchema.Type | null;
    readonly errors?: readonly { readonly message: string }[] | null;
  }>;
  mergeRequestDiscussions(input: {
    project: string;
    number: number;
    perPage?: number;
    page?: number;
  }): GitLabClientEffect<ReadonlyArray<GitLabDiscussion>>;
  mergeRequestNotes(input: {
    project: string;
    number: number;
    orderBy?: 'created_at';
    sort?: 'asc' | 'desc';
    perPage?: number;
    page?: number;
  }): GitLabClientEffect<ReadonlyArray<GitLabNote>>;
  draftNotes(project: string, number: number): GitLabClientEffect<ReadonlyArray<GitLabDraftNote>>;
  createMergeRequestNote(
    project: string,
    number: number,
    body: string,
    internal?: boolean
  ): GitLabClientEffect<unknown>;
  createDiscussion(
    project: string,
    number: number,
    formData: Array<[string, string]>,
  ): GitLabClientEffect<unknown>;
  createDraftNote(
    project: string,
    number: number,
    input: CreateGitLabDraftNoteInput,
  ): GitLabClientEffect<GitLabDraftNote>;
  updateDraftNote(
    project: string,
    number: number,
    draftNoteId: string,
    note: string,
  ): GitLabClientEffect<GitLabDraftNote>;
  deleteDraftNote(project: string, number: number, draftNoteId: string): GitLabClientEffect<void>;
  bulkPublishDraftNotes(project: string, number: number): GitLabClientEffect<void>;
  publishDraftNote(project: string, number: number, draftNoteId: number): GitLabClientEffect<void>;
  createDiscussionNote(
    project: string,
    number: number,
    threadId: string,
    body: string,
  ): GitLabClientEffect<void>;
  updateDiscussion(
    project: string,
    number: number,
    threadId: string,
    resolved: boolean,
  ): GitLabClientEffect<void>;
  updateDiscussionNote(
    project: string,
    number: number,
    threadId: string,
    commentId: string,
    body: string,
  ): GitLabClientEffect<void>;
  deleteDiscussionNote(
    project: string,
    number: number,
    threadId: string,
    commentId: string,
  ): GitLabClientEffect<void>;
  updateMergeRequestNote(
    project: string,
    number: number,
    commentId: string,
    body: string,
  ): GitLabClientEffect<void>;
  deleteMergeRequestNote(
    project: string,
    number: number,
    commentId: string,
  ): GitLabClientEffect<void>;
  accessToken(): GitLabClientEffect<string>;
};

class GitLabApiClient extends Effect.Tag('GitLabApiClient')<
  GitLabApiClient,
  GitLabApiClientShape
>() {}

const API_REQUEST_TIMEOUT = '30 seconds';

function parseGitLabErrorBody(text: string) {
  if (!text) {
    return '';
  }

  try {
    const parsed = Schema.decodeUnknownSync(GitLabErrorBodySchema)(JSON.parse(text));
    return parsed.message ?? text;
  } catch {
    return text;
  }
}

const makeGitLabApiClient = (accountId: string) =>
  Effect.gen(function* () {
    const tokenStore = yield* AuthTokenStore;
    const httpClient = yield* HttpClient.HttpClient;

    const storedToken: GitLabApiClientShape['storedToken'] = Effect.fn(
      'GitLabApiClient.storedToken',
    )(function* () {
      return yield* tokenStore.get(accountId).pipe(
        Effect.mapError(
          (cause) =>
            new GitLabClientTokenStoreError({
              message: getErrorMessage(cause),
              accountId,
              cause,
            }),
        ),
      );
    });

    const requireStoredToken = Effect.fn('GitLabApiClient.requireStoredToken')(function* () {
      const token = yield* storedToken();
      if (!token) {
        return yield* Effect.fail(
          new GitLabClientNotAuthenticated({
            message: 'GitLab is not signed in.',
            accountId,
            cause: { accountId },
          }),
        );
      }

      return token;
    });

    const accessToken: GitLabApiClientShape['accessToken'] = Effect.fn(
      'GitLabApiClient.accessToken',
    )(function* () {
      return yield* getValidAccessToken(accountId).pipe(
        Effect.provideService(AuthTokenStore, tokenStore),
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.mapError(
          (cause) =>
            new GitLabClientAccessTokenError({
              message: getErrorMessage(cause),
              accountId,
              cause,
            }),
        ),
      );
    });

    const saveViewerLogin = Effect.fn('GitLabApiClient.saveViewerLogin')(function* (login: string) {
      yield* updateViewerLogin(accountId, login).pipe(
        Effect.provideService(AuthTokenStore, tokenStore),
        Effect.mapError(
          (cause) =>
            new GitLabClientViewerLoginPersistenceError({
              message: getErrorMessage(cause),
              accountId,
              login,
              cause,
            }),
        ),
      );
    });

    const setDefaultHeaders = (request: HttpClientRequest.HttpClientRequest) =>
      request.pipe(
        HttpClientRequest.accept('application/json'),
        HttpClientRequest.setHeader('User-Agent', 'code-review.app'),
      );

    const accept = (value: string) => HttpClientRequest.accept(value);
    const prefixApiHost = (host: string) => HttpClientRequest.prependUrl(`${host}/api/v4/`);
    const prefixGraphqlHost = (host: string) => HttpClientRequest.prependUrl(`${host}/api/`);

    const authorize = Effect.fn('GitLabApiClient.authorize')(function* () {
      const token = yield* accessToken();
      return HttpClientRequest.bearerToken(token);
    });

    const formRequestBody = (formData: ReadonlyArray<readonly [string, string]>) =>
      HttpClientRequest.bodyUrlParams(formData);

    const jsonRequestBody = (body: unknown) => (request: HttpClientRequest.HttpClientRequest) =>
      request.pipe(
        HttpClientRequest.setHeader('Content-Type', 'application/json'),
        HttpClientRequest.bodyUnsafeJson(body),
      );

    const responseErrorMessage = (error: HttpClientError.ResponseError) =>
      Effect.gen(function* () {
        const body = yield* error.response.text.pipe(Effect.catchAll(() => Effect.succeed('')));
        return parseGitLabErrorBody(body) || `Provider API returned HTTP ${error.response.status}`;
      });

    const parseSchemaError = (error: ParseResult.ParseError) =>
      ParseResult.TreeFormatter.formatError(error).pipe(
        Effect.map(
          (message) =>
            new GitLabClientSchemaDecodeError({
              message,
              cause: error,
            }),
        ),
      );

    const mapHttpError = (error: unknown): Effect.Effect<GitLabClientError> => {
      if (isGitLabClientError(error)) {
        return Effect.succeed(error);
      }
      if (error instanceof ParseResult.ParseError) {
        return parseSchemaError(error);
      }
      if (error instanceof HttpClientError.ResponseError) {
        return responseErrorMessage(error).pipe(
          Effect.map(
            (message) =>
              new GitLabClientResponseError({
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
          new GitLabClientTransportError({
            message: error.message,
            cause: error,
          }),
        );
      }
      return Effect.succeed(
        new GitLabClientTransportError({
          message: getErrorMessage(error),
          cause: error,
        }),
      );
    };

    const logApiResponse = (response: HttpClientResponse.HttpClientResponse) =>
      Effect.logInfo('[gitlab api] request').pipe(
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
            new GitLabClientRequestTimeoutError({
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
      <A, I>(schema: Schema.Schema<A, I, never>) =>
      (response: Effect.Effect<HttpClientResponse.HttpClientResponse, GitLabClientError>) =>
        response.pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
          Effect.catchAll((error) => Effect.flatMap(mapHttpError(error), Effect.fail)),
        );

    const decodeTextBody = (
      response: Effect.Effect<HttpClientResponse.HttpClientResponse, GitLabClientError>,
    ) =>
      response.pipe(
        Effect.flatMap((httpResponse) => httpResponse.text),
        Effect.catchAll((error) => Effect.flatMap(mapHttpError(error), Effect.fail)),
      );

    const graphqlErrors = (response: { errors?: ReadonlyArray<{ message: string }> | null }) => {
      if (!response.errors?.length) {
        return Effect.void;
      }

      return Effect.fail(
        new GitLabClientGraphqlError({
          message: response.errors.map((error) => error.message).join('\n'),
          messages: response.errors.map((error) => error.message),
          cause: response.errors,
        }),
      );
    };

    const decodeGraphqlBody =
      <A, I>(schema: Schema.Schema<A, I, never>) =>
      (response: Effect.Effect<HttpClientResponse.HttpClientResponse, GitLabClientError>) =>
        response.pipe(decodeJsonBody(graphQlResponseSchema(schema)), Effect.tap(graphqlErrors));

    const user: GitLabApiClientShape['user'] = Effect.fn('GitLabApiClient.user')(function* () {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      const response = yield* HttpClientRequest.get(gitlabRoute('user')).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(GitLabUserSchema),
      );
      yield* saveViewerLogin(response.username);
      return response;
    });

    const projects: GitLabApiClientShape['projects'] = Effect.fn('GitLabApiClient.projects')(
      function* (input) {
        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.get(
          gitlabRoute('projects', {
            query: {
              membership: input.membership,
              simple: input.simple,
              per_page: input.perPage,
              search: input.search,
            },
          }),
        ).pipe(
          setDefaultHeaders,
          prefixApiHost(token.host),
          auth,
          send,
          decodeJsonBody(Schema.Array(GitLabProjectSchema)),
        );
      },
    );

    const groups: GitLabApiClientShape['groups'] = Effect.fn('GitLabApiClient.groups')(
      function* (input) {
        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.get(
          gitlabRoute('groups', {
            query: {
              all_available: input.allAvailable ?? false,
              search: input.search,
              order_by: 'name',
              sort: 'asc',
              per_page: input.perPage,
            },
          }),
        ).pipe(
          setDefaultHeaders,
          prefixApiHost(token.host),
          auth,
          send,
          decodeJsonBody(Schema.Array(GitLabGroupSchema)),
        );
      },
    );

    const groupProjects: GitLabApiClientShape['groupProjects'] = Effect.fn(
      'GitLabApiClient.groupProjects',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        gitlabRoute('groups/:group/projects', {
          params: { group: input.group },
          query: {
            include_subgroups: input.includeSubgroups,
            simple: input.simple,
            order_by: 'last_activity_at',
            sort: 'desc',
            per_page: input.perPage,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(Schema.Array(GitLabProjectSchema)),
      );
    });

    const overviewMergeRequests: GitLabApiClientShape['overviewMergeRequests'] = Effect.fn(
      'GitLabApiClient.overviewMergeRequests',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        gitlabRoute('merge_requests', {
          query: {
            scope: input.scope,
            state: input.state ?? 'opened',
            order_by: 'updated_at',
            sort: 'desc',
            non_archived: 'true',
            per_page: input.perPage ?? 100,
            search: input.search,
            in: input.in,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(Schema.Array(GitLabMergeRequestSchema)),
      );
    });

    const searchMergeRequests: GitLabApiClientShape['searchMergeRequests'] = Effect.fn(
      'GitLabApiClient.searchMergeRequests',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      const trimmedSearch = input.search?.trim() ?? '';
      return yield* HttpClientRequest.get(
        gitlabRoute('search', {
          query: {
            scope: 'merge_requests',
            state: input.state,
            order_by: 'updated_at',
            sort: 'desc',
            per_page: input.perPage ?? 20,
            page: input.page,
            search: trimmedSearch,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(Schema.Array(GitLabMergeRequestSchema)),
      );
    });

    const project: GitLabApiClientShape['project'] = Effect.fn('GitLabApiClient.project')(
      function* (project) {
        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.get(
          gitlabRoute('projects/:project', {
            params: { project },
          }),
        ).pipe(
          setDefaultHeaders,
          prefixApiHost(token.host),
          auth,
          send,
          decodeJsonBody(GitLabProjectSchema),
        );
      },
    );

    const projectMergeRequests: GitLabApiClientShape['projectMergeRequests'] = Effect.fn(
      'GitLabApiClient.projectMergeRequests',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        gitlabRoute('projects/:project/merge_requests', {
          params: { project: input.project },
          query: {
            state: input.state,
            order_by: input.orderBy,
            sort: input.sort,
            per_page: input.perPage,
            search: input.search,
            in: input.in,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(Schema.Array(GitLabMergeRequestSchema)),
      );
    });

    const mergeRequest: GitLabApiClientShape['mergeRequest'] = Effect.fn(
      'GitLabApiClient.mergeRequest',
    )(function* (project, number) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        gitlabRoute('projects/:project/merge_requests/:number', {
          params: { project, number },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(GitLabMergeRequestSchema),
      );
    });

    const mergeRequestApprovals: GitLabApiClientShape['mergeRequestApprovals'] = Effect.fn(
      'GitLabApiClient.mergeRequestApprovals',
    )(function* (project, number) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        gitlabRoute('projects/:project/merge_requests/:number/approvals', {
          params: { project, number },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(GitLabMergeRequestApprovalsSchema),
      );
    });

    const approveMergeRequest: GitLabApiClientShape['approveMergeRequest'] = Effect.fn(
      'GitLabApiClient.approveMergeRequest',
    )(function* (project, number, sha) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      yield* HttpClientRequest.post(
        gitlabRoute('projects/:project/merge_requests/:number/approve', {
          params: { project, number },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        formRequestBody([['sha', sha]]),
        send,
        Effect.asVoid,
      );
    });

    const unapproveMergeRequest: GitLabApiClientShape['unapproveMergeRequest'] = Effect.fn(
      'GitLabApiClient.unapproveMergeRequest',
    )(function* (project, number) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      yield* HttpClientRequest.post(
        gitlabRoute('projects/:project/merge_requests/:number/unapprove', {
          params: { project, number },
        }),
      ).pipe(setDefaultHeaders, prefixApiHost(token.host), auth, send, Effect.asVoid);
    });

    const mergeRequestDiffs: GitLabApiClientShape['mergeRequestDiffs'] = Effect.fn(
      'GitLabApiClient.mergeRequestDiffs',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        gitlabRoute('projects/:project/merge_requests/:number/diffs', {
          params: { project: input.project, number: input.number },
          query: { per_page: input.perPage, page: input.page },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(Schema.Array(GitLabDiffSchema)),
      );
    });

    const mergeRequestRawDiffs: GitLabApiClientShape['mergeRequestRawDiffs'] = Effect.fn(
      'GitLabApiClient.mergeRequestRawDiffs',
    )(function* (project, number) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        gitlabRoute('projects/:project/merge_requests/:number/raw_diffs', {
          params: { project, number },
        }),
      ).pipe(
        setDefaultHeaders,
        accept('text/plain'),
        prefixApiHost(token.host),
        auth,
        send,
        decodeTextBody,
      );
    });

    const mergeRequestVersions: GitLabApiClientShape['mergeRequestVersions'] = Effect.fn(
      'GitLabApiClient.mergeRequestVersions',
    )(function* (project, number) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        gitlabRoute('projects/:project/merge_requests/:number/versions', {
          params: { project, number },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(Schema.Array(GitLabMrVersionSchema)),
      );
    });

    const repositoryFileRaw: GitLabApiClientShape['repositoryFileRaw'] = Effect.fn(
      'GitLabApiClient.repositoryFileRaw',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        gitlabRoute('projects/:project/repository/files/:path/raw', {
          params: {
            project: input.project,
            path: rawPathParam(encodeURIComponent(input.path)),
          },
          query: { ref: input.ref },
        }),
      ).pipe(
        setDefaultHeaders,
        accept('text/plain'),
        prefixApiHost(token.host),
        auth,
        send,
        decodeTextBody,
      );
    });

    const codeQualityReportsComparer: GitLabApiClientShape['codeQualityReportsComparer'] =
      Effect.fn('GitLabApiClient.codeQualityReportsComparer')(function* (fullPath, iid) {
        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.post('graphql').pipe(
          setDefaultHeaders,
          prefixGraphqlHost(token.host),
          auth,
          jsonRequestBody({
            query: `
query($fullPath: ID!, $iid: String!) {
  project(fullPath: $fullPath) {
    mergeRequest(iid: $iid) {
      codequalityReportsComparer {
        status
        report {
          status
          newErrors {
            description
            fingerprint
            severity
            filePath
            line
            webUrl
            engineName
          }
          resolvedErrors {
            description
            fingerprint
            severity
            filePath
            line
            webUrl
            engineName
          }
          existingErrors {
            description
            fingerprint
            severity
            filePath
            line
            webUrl
            engineName
          }
          summary {
            errored
            resolved
            total
          }
        }
      }
    }
  }
}
`,
            variables: { fullPath, iid },
          }),
          send,
          decodeGraphqlBody(GitLabCodeQualityGraphqlQueryDataSchema),
        );
      });

    const mergeRequestDiscussions: GitLabApiClientShape['mergeRequestDiscussions'] = Effect.fn(
      'GitLabApiClient.mergeRequestDiscussions',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        gitlabRoute('projects/:project/merge_requests/:number/discussions', {
          params: { project: input.project, number: input.number },
          query: { per_page: input.perPage, page: input.page },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(Schema.Array(GitLabDiscussionSchema)),
      );
    });

    const mergeRequestNotes: GitLabApiClientShape['mergeRequestNotes'] = Effect.fn(
      'GitLabApiClient.mergeRequestNotes',
    )(function* (input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.get(
        gitlabRoute('projects/:project/merge_requests/:number/notes', {
          params: { project: input.project, number: input.number },
          query: {
            order_by: input.orderBy,
            sort: input.sort,
            per_page: input.perPage,
            page: input.page,
          },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        decodeJsonBody(Schema.Array(GitLabNoteSchema)),
      );
    });

    const draftNotes: GitLabApiClientShape['draftNotes'] = Effect.fn('GitLabApiClient.draftNotes')(
      function* (project, number) {
        const token = yield* requireStoredToken();
        const auth = yield* authorize();
        return yield* HttpClientRequest.get(
          gitlabRoute('projects/:project/merge_requests/:number/draft_notes', {
            params: { project, number },
          }),
        ).pipe(
          setDefaultHeaders,
          prefixApiHost(token.host),
          auth,
          send,
          decodeJsonBody(Schema.Array(GitLabDraftNoteSchema)),
        );
      },
    );

    const createMergeRequestNote: GitLabApiClientShape['createMergeRequestNote'] = Effect.fn(
      'GitLabApiClient.createMergeRequestNote',
    )(function* (project, number, body, internal) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      const requestBody = {
        body,
        ...(internal !== undefined ? { internal } : {}),
      };
      return yield* HttpClientRequest.post(
        gitlabRoute('projects/:project/merge_requests/:number/notes', {
          params: { project, number },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        jsonRequestBody(requestBody),
        send,
        decodeJsonBody(Schema.Unknown),
        Effect.tapError((error) =>
          Effect.logError('[gitlab] createMergeRequestNote failed').pipe(
            Effect.annotateLogs({
              host: token.host,
              project,
              number,
              contentType: 'application/json',
              requestBody: JSON.stringify(requestBody),
              error: getErrorMessage(error),
            }),
          ),
        ),
      );
    });

    const createDiscussion: GitLabApiClientShape['createDiscussion'] = Effect.fn(
      'GitLabApiClient.createDiscussion',
    )(function* (project, number, formData) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.post(
        gitlabRoute('projects/:project/merge_requests/:number/discussions', {
          params: { project, number },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        formRequestBody(formData),
        send,
        decodeJsonBody(Schema.Unknown),
      );
    });

    const createDraftNote: GitLabApiClientShape['createDraftNote'] = Effect.fn(
      'GitLabApiClient.createDraftNote',
    )(function* (project, number, input) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      const formData: Array<[string, string]> = [['note', input.note]];
      if (input.inReplyToDiscussionId) {
        formData.push(['in_reply_to_discussion_id', input.inReplyToDiscussionId]);
      }
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
      return yield* HttpClientRequest.post(
        gitlabRoute('projects/:project/merge_requests/:number/draft_notes', {
          params: { project, number },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        formRequestBody(formData),
        send,
        decodeJsonBody(GitLabDraftNoteSchema),
      );
    });

    const updateDraftNote: GitLabApiClientShape['updateDraftNote'] = Effect.fn(
      'GitLabApiClient.updateDraftNote',
    )(function* (project, number, draftNoteId, note) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      return yield* HttpClientRequest.put(
        gitlabRoute('projects/:project/merge_requests/:number/draft_notes/:draftNoteId', {
          params: { project, number, draftNoteId },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        formRequestBody([['note', note]]),
        send,
        decodeJsonBody(GitLabDraftNoteSchema),
      );
    });

    const deleteDraftNote: GitLabApiClientShape['deleteDraftNote'] = Effect.fn(
      'GitLabApiClient.deleteDraftNote',
    )(function* (project, number, draftNoteId) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      yield* HttpClientRequest.del(
        gitlabRoute('projects/:project/merge_requests/:number/draft_notes/:draftNoteId', {
          params: { project, number, draftNoteId },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        Effect.asVoid,
        Effect.catchAll((error) =>
          error instanceof GitLabClientResponseError && error.status === 404
            ? Effect.void
            : Effect.fail(error),
        ),
      );
    });

    const bulkPublishDraftNotes: GitLabApiClientShape['bulkPublishDraftNotes'] = Effect.fn(
      'GitLabApiClient.bulkPublishDraftNotes',
    )(function* (project, number) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      yield* HttpClientRequest.post(
        gitlabRoute('projects/:project/merge_requests/:number/draft_notes/bulk_publish', {
          params: { project, number },
        }),
      ).pipe(setDefaultHeaders, prefixApiHost(token.host), auth, send, Effect.asVoid);
    });

    const publishDraftNote: GitLabApiClientShape['publishDraftNote'] = Effect.fn(
      'GitLabApiClient.publishDraftNote',
    )(function* (project, number, draftNoteId) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      yield* HttpClientRequest.put(
        gitlabRoute('projects/:project/merge_requests/:number/draft_notes/:draftNoteId/publish', {
          params: { project, number, draftNoteId },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        send,
        Effect.asVoid,
        Effect.catchAll((error) =>
          error instanceof GitLabClientResponseError && error.status === 404
            ? Effect.void
            : Effect.fail(error),
        ),
      );
    });

    const createDiscussionNote: GitLabApiClientShape['createDiscussionNote'] = Effect.fn(
      'GitLabApiClient.createDiscussionNote',
    )(function* (project, number, threadId, body) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      yield* HttpClientRequest.post(
        gitlabRoute('projects/:project/merge_requests/:number/discussions/:threadId/notes', {
          params: { project, number, threadId },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        formRequestBody([['body', body]]),
        send,
        Effect.asVoid,
      );
    });

    const updateDiscussion: GitLabApiClientShape['updateDiscussion'] = Effect.fn(
      'GitLabApiClient.updateDiscussion',
    )(function* (project, number, threadId, resolved) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      yield* HttpClientRequest.put(
        gitlabRoute('projects/:project/merge_requests/:number/discussions/:threadId', {
          params: { project, number, threadId },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        formRequestBody([['resolved', String(resolved)]]),
        send,
        Effect.asVoid,
      );
    });

    const updateDiscussionNote: GitLabApiClientShape['updateDiscussionNote'] = Effect.fn(
      'GitLabApiClient.updateDiscussionNote',
    )(function* (project, number, threadId, commentId, body) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      yield* HttpClientRequest.put(
        gitlabRoute(
          'projects/:project/merge_requests/:number/discussions/:threadId/notes/:commentId',
          {
            params: { project, number, threadId, commentId },
          },
        ),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        formRequestBody([['body', body]]),
        send,
        Effect.asVoid,
      );
    });

    const deleteDiscussionNote: GitLabApiClientShape['deleteDiscussionNote'] = Effect.fn(
      'GitLabApiClient.deleteDiscussionNote',
    )(function* (project, number, threadId, commentId) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      yield* HttpClientRequest.del(
        gitlabRoute(
          'projects/:project/merge_requests/:number/discussions/:threadId/notes/:commentId',
          {
            params: { project, number, threadId, commentId },
          },
        ),
      ).pipe(setDefaultHeaders, prefixApiHost(token.host), auth, send, Effect.asVoid);
    });

    const updateMergeRequestNote: GitLabApiClientShape['updateMergeRequestNote'] = Effect.fn(
      'GitLabApiClient.updateMergeRequestNote',
    )(function* (project, number, commentId, body) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      yield* HttpClientRequest.put(
        gitlabRoute('projects/:project/merge_requests/:number/notes/:commentId', {
          params: { project, number, commentId },
        }),
      ).pipe(
        setDefaultHeaders,
        prefixApiHost(token.host),
        auth,
        formRequestBody([['body', body]]),
        send,
        Effect.asVoid,
      );
    });

    const deleteMergeRequestNote: GitLabApiClientShape['deleteMergeRequestNote'] = Effect.fn(
      'GitLabApiClient.deleteMergeRequestNote',
    )(function* (project, number, commentId) {
      const token = yield* requireStoredToken();
      const auth = yield* authorize();
      yield* HttpClientRequest.del(
        gitlabRoute('projects/:project/merge_requests/:number/notes/:commentId', {
          params: { project, number, commentId },
        }),
      ).pipe(setDefaultHeaders, prefixApiHost(token.host), auth, send, Effect.asVoid);
    });

    return {
      storedToken,
      user,
      projects,
      groups,
      groupProjects,
      overviewMergeRequests,
      searchMergeRequests,
      project,
      projectMergeRequests,
      mergeRequest,
      mergeRequestApprovals,
      approveMergeRequest,
      unapproveMergeRequest,
      mergeRequestDiffs,
      mergeRequestRawDiffs,
      mergeRequestVersions,
      repositoryFileRaw,
      codeQualityReportsComparer,
      mergeRequestDiscussions,
      mergeRequestNotes,
      draftNotes,
      createMergeRequestNote,
      createDiscussion,
      createDraftNote,
      updateDraftNote,
      deleteDraftNote,
      bulkPublishDraftNotes,
      publishDraftNote,
      createDiscussionNote,
      updateDiscussion,
      updateDiscussionNote,
      deleteDiscussionNote,
      updateMergeRequestNote,
      deleteMergeRequestNote,
      accessToken,
    } satisfies GitLabApiClientShape;
  });

const GitLabApiClientLive = (accountId: string) =>
  Layer.effect(GitLabApiClient, makeGitLabApiClient(accountId));

export { GitLabApiClient, GitLabApiClientLive, makeGitLabApiClient };
export type { GitLabApiClientShape };
