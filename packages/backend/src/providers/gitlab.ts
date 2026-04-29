import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Effect, ParseResult, Schema } from "effect";
import { ProviderError } from "../errors.ts";
import { createRepoIdentity, normalizeHost, normalizePath } from "../repo-id.ts";
import {
  getValidAccessToken,
  updateViewerLogin,
} from "../auth/provider-auth.ts";
import type {
  OverviewPullRequestSummary,
  ProviderAuthStatus,
  PrChangedFile,
  PullRequestSummary,
  RepoSummary,
  ReviewComment,
  ReviewThread,
} from "@code-review-app/shared";
import type { ForgeProvider, PullRequestRefs, ReviewThreadInput } from "./types.ts";
import type { RepoIdentity } from "../repo-id.ts";
import { AuthTokenStore, type StoredAuthToken } from "../auth/token-store.ts";

type GitLabRequestOptions = {
  method?: "GET" | "POST" | "PUT";
  accept?: string;
  form?: Array<[string, string]>;
};

const API_REQUEST_TIMEOUT = "30 seconds";

const NullableString = Schema.NullOr(Schema.String);
const OptionalNullableString = Schema.optional(Schema.NullOr(Schema.String));
const OptionalNullableNumber = Schema.optional(Schema.NullOr(Schema.Number));
const OptionalNullableBoolean = Schema.optional(Schema.NullOr(Schema.Boolean));

const GitLabUserSchema = Schema.Struct({
  username: Schema.String,
  avatar_url: OptionalNullableString,
});

const GitLabProjectSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  path_with_namespace: Schema.String,
  description: NullableString,
  visibility: NullableString,
  avatar_url: NullableString,
});

const GitLabDiffRefsSchema = Schema.Struct({
  base_sha: OptionalNullableString,
  head_sha: OptionalNullableString,
  start_sha: OptionalNullableString,
});

const GitLabMergeRequestSchema = Schema.Struct({
  project_id: OptionalNullableNumber,
  iid: Schema.Number,
  title: Schema.String,
  state: Schema.String,
  draft: OptionalNullableBoolean,
  work_in_progress: OptionalNullableBoolean,
  merge_status: OptionalNullableString,
  detailed_merge_status: OptionalNullableString,
  changes_count: OptionalNullableString,
  author: Schema.optional(Schema.NullOr(GitLabUserSchema)),
  updated_at: Schema.String,
  web_url: Schema.String,
  sha: OptionalNullableString,
  diff_refs: Schema.optional(Schema.NullOr(GitLabDiffRefsSchema)),
});

const GitLabDiffSchema = Schema.Struct({
  new_path: Schema.String,
  old_path: Schema.String,
  new_file: Schema.Boolean,
  deleted_file: Schema.Boolean,
  renamed_file: Schema.Boolean,
});

const GitLabLineRangePointSchema = Schema.Struct({
  type: OptionalNullableString,
  old_line: OptionalNullableNumber,
  new_line: OptionalNullableNumber,
});

const GitLabLineRangeSchema = Schema.Struct({
  start: Schema.optional(Schema.NullOr(GitLabLineRangePointSchema)),
  end: Schema.optional(Schema.NullOr(GitLabLineRangePointSchema)),
});

const GitLabPositionSchema = Schema.Struct({
  old_path: OptionalNullableString,
  new_path: OptionalNullableString,
  old_line: OptionalNullableNumber,
  new_line: OptionalNullableNumber,
  position_type: OptionalNullableString,
  line_range: Schema.optional(Schema.NullOr(GitLabLineRangeSchema)),
});

const GitLabNoteSchema = Schema.Struct({
  id: Schema.Number,
  type: OptionalNullableString,
  body: Schema.String,
  system: OptionalNullableBoolean,
  author: Schema.optional(Schema.NullOr(GitLabUserSchema)),
  created_at: Schema.String,
  updated_at: Schema.String,
  web_url: OptionalNullableString,
  resolved: OptionalNullableBoolean,
  position: Schema.optional(Schema.NullOr(GitLabPositionSchema)),
});

const GitLabDiscussionSchema = Schema.Struct({
  id: Schema.String,
  individual_note: Schema.optional(Schema.Boolean),
  notes: Schema.optional(Schema.Array(GitLabNoteSchema)),
});

const GitLabMrVersionSchema = Schema.Struct({
  base_commit_sha: Schema.String,
  head_commit_sha: Schema.String,
  start_commit_sha: Schema.String,
});

const GitLabErrorBodySchema = Schema.Struct({
  message: Schema.optional(Schema.String),
});

type GitLabProject = typeof GitLabProjectSchema.Type;
type GitLabMergeRequest = typeof GitLabMergeRequestSchema.Type;
type GitLabMrVersion = typeof GitLabMrVersionSchema.Type;
type GitLabPosition = typeof GitLabPositionSchema.Type;
type GitLabDiscussion = typeof GitLabDiscussionSchema.Type;
type GitLabDiff = typeof GitLabDiffSchema.Type;

function toChangedFile(diff: GitLabDiff): PrChangedFile {
  const oldPath = diff.old_path.trim();
  const newPath = diff.new_path.trim();
  const path = newPath || oldPath;

  if (diff.new_file) {
    return {
      path,
      oldPath: "",
      newPath,
      changeType: "new",
    };
  }

  if (diff.deleted_file) {
    return {
      path,
      oldPath,
      newPath: "",
      changeType: "deleted",
    };
  }

  if (diff.renamed_file) {
    return {
      path,
      oldPath,
      newPath,
      changeType: "rename-changed",
    };
  }

  return {
    path,
    oldPath,
    newPath,
    changeType: "change",
  };
}

const OVERVIEW_MERGE_REQUEST_SCOPES = [
  "reviews_for_me",
  "assigned_to_me",
  "created_by_me",
] as const;

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
    if (!token) return yield* Effect.fail(new ProviderError("GitLab is not signed in."));
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

function isNotAuthenticatedMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not logged") ||
    normalized.includes("not authenticated") ||
    normalized.includes("authenticate") ||
    normalized.includes("401") ||
    normalized.includes("unauthorized")
  );
}

function projectEndpoint(repo: RepoIdentity, suffix: string) {
  return `projects/${encodeURIComponent(repo.path)}/${suffix}`;
}

function projectIdEndpoint(project: string | number, suffix: string) {
  return `projects/${encodeURIComponent(String(project))}/${suffix}`;
}

function projectPathEndpoint(path: string) {
  return `projects/${encodeURIComponent(path)}`;
}

function gitlabApiUrl(host: string, endpoint: string) {
  return `https://${normalizeHost(host)}/api/v4/${endpoint}`;
}

function overviewMergeRequestsEndpoint(
  scope: (typeof OVERVIEW_MERGE_REQUEST_SCOPES)[number],
) {
  const params = new URLSearchParams({
    scope,
    state: "opened",
    order_by: "updated_at",
    sort: "desc",
    non_archived: "true",
    per_page: "100",
  });
  return `merge_requests?${params}`;
}

function parseGitLabErrorBody(text: string) {
  if (!text) return "";
  try {
    const parsed = Schema.decodeUnknownSync(GitLabErrorBodySchema)(JSON.parse(text));
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
      parseGitLabErrorBody(body) ||
      `Provider API returned HTTP ${error.response.status}`
    );
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

function summarizeGitLabFormData(form: Array<[string, string]> | undefined) {
  if (!form) {
    return null;
  }

  const summary: Record<string, string> = {};
  for (const [key, stringValue] of form) {
    summary[key] =
      key === "body" && stringValue.length > 500
        ? `${stringValue.slice(0, 500)}…`
        : stringValue;
  }

  return summary;
}

function summarizeGitLabError(error: unknown) {
  if (error instanceof HttpClientError.ResponseError) {
    return {
      type: error._tag,
      message: error.message,
      reason: error.reason,
      description: error.description,
      methodAndUrl: error.methodAndUrl,
      status: error.response.status,
      request: {
        method: error.request.method,
        url: error.request.url,
      },
      cause: summarizeGitLabError(error.cause),
    };
  }

  if (HttpClientError.isHttpClientError(error)) {
    return {
      type: error._tag,
      message: error.message,
      reason: error.reason,
      description: error.description,
      methodAndUrl: error.methodAndUrl,
      request: {
        method: error.request.method,
        url: error.request.url,
      },
      cause: summarizeGitLabError(error.cause),
    };
  }

  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    type: typeof error,
    message: String(error),
  };
}

function requestFor(url: string, token: string, options: GitLabRequestOptions = {}) {
  const request =
    options.method === "POST"
      ? HttpClientRequest.post(url)
      : options.method === "PUT"
        ? HttpClientRequest.put(url)
        : HttpClientRequest.get(url);

  const authorizedRequest = request.pipe(
    HttpClientRequest.accept(options.accept ?? "application/json"),
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.setHeader("User-Agent", "code-review.app"),
  );

  return options.form
    ? authorizedRequest.pipe(HttpClientRequest.bodyUrlParams(options.form))
    : authorizedRequest;
}

function gitlabResponse(
  accountId: string,
  host: string,
  endpoint: string,
  options?: GitLabRequestOptions,
) {
  const url = gitlabApiUrl(host, endpoint);
  const method = options?.method ?? "GET";
  return Effect.gen(function* () {
    const token = yield* validAccessToken(accountId);
    const client = yield* HttpClient.HttpClient;
    return yield* client.execute(requestFor(url, token, options)).pipe(
      Effect.timeoutFail({
        duration: API_REQUEST_TIMEOUT,
        onTimeout: () => new ProviderError(`Provider API request timed out after 30s: ${url}`),
      }),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    );
  }).pipe(
    Effect.catchAll((error) =>
      Effect.flatMap(mapHttpError(error), (providerError) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            console.error("[gitlab] request failed", {
              accountId,
              host,
              endpoint,
              method,
              url,
              accept: options?.accept ?? "application/json",
              formData: summarizeGitLabFormData(options?.form),
              providerError: providerError.message,
              rawError: summarizeGitLabError(error),
            });
          });
          return yield* Effect.fail(providerError);
        }),
      ),
    ),
  );
}

function gitlabJson<A, I, R>(
  accountId: string,
  host: string,
  endpoint: string,
  schema: Schema.Schema<A, I, R>,
  options?: GitLabRequestOptions,
): Effect.Effect<A, ProviderError, AuthTokenStore | HttpClient.HttpClient | R> {
  return gitlabResponse(accountId, host, endpoint, options).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
    Effect.catchAll((error) =>
      Effect.flatMap(mapHttpError(error), (providerError) => Effect.fail(providerError)),
    ),
  );
}

function gitlabText(
  accountId: string,
  host: string,
  endpoint: string,
  options?: GitLabRequestOptions,
): Effect.Effect<string, ProviderError, AuthTokenStore | HttpClient.HttpClient> {
  return gitlabResponse(accountId, host, endpoint, {
    ...options,
    accept: options?.accept ?? "text/plain",
  }).pipe(
    Effect.flatMap((response) => response.text),
    Effect.catchAll((error) =>
      Effect.flatMap(mapHttpError(error), (providerError) => Effect.fail(providerError)),
    ),
  );
}

function gitlabForm(
  host: string,
  accountId: string,
  method: "POST" | "PUT",
  endpoint: string,
  forms: Array<[string, string]>,
): Effect.Effect<void, ProviderError, AuthTokenStore | HttpClient.HttpClient> {
  return gitlabResponse(accountId, host, endpoint, { method, form: forms }).pipe(
    Effect.asVoid,
  );
}

function parseGitLabRepoInput(host: string, input: string): [string, string] {
  const trimmed = input.trim();
  if (!trimmed) throw new ProviderError("Repo is required");

  const urlMatch = trimmed.match(/^https?:\/\/([^/]+)\/(.+)$/);
  if (urlMatch) {
    const inputHost = normalizeHost(urlMatch[1]);
    const path = normalizePath(urlMatch[2].replace(/\.git$/, ""));
    if (!path) throw new ProviderError("GitLab project path is required");
    return [inputHost, path];
  }

  const path = normalizePath(trimmed.replace(/\.git$/, ""));
  if (path.split("/").length < 2) {
    throw new ProviderError("Enter a GitLab project as namespace/project");
  }
  return [normalizeHost(host), path];
}

function repoSummaryFromProject(
  accountId: string,
  host: string,
  label: string,
  project: GitLabProject,
): RepoSummary {
  const normalizedHost = normalizeHost(host);
  return {
    ...createRepoIdentity("gitlab", normalizedHost, accountId, project.path_with_namespace),
    provider: "gitlab",
    host: normalizedHost,
    providerAccountId: accountId,
    providerAccountLabel: label,
    name: project.name,
    nameWithOwner: project.path_with_namespace,
    description: project.description,
    isPrivate:
      project.visibility == null ? null : project.visibility.toLowerCase() !== "public",
    avatarUrl: project.avatar_url,
  };
}

function labelForToken(token: { viewerLogin: string | null; host: string }) {
  return token.viewerLogin ? `${token.viewerLogin} @ ${token.host}` : token.host;
}

function mapState(state: string) {
  if (state === "opened") return "OPEN";
  if (state === "closed") return "CLOSED";
  if (state === "merged") return "MERGED";
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
  return typeof mergeRequest.project_id === "number"
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
    mergeStateStatus: (mr.detailed_merge_status ?? mr.merge_status ?? "UNKNOWN").toUpperCase(),
    mergeable: "UNKNOWN",
    additions: null,
    deletions: null,
    changeCount: parseChangeCount(mr.changes_count),
    authorLogin: mr.author?.username ?? "unknown",
    updatedAt: mr.updated_at,
    url: mr.web_url,
    headSha: mr.sha ?? diffRefs?.head_sha ?? "",
    baseSha: diffRefs?.base_sha ?? diffRefs?.start_sha ?? null,
  };
}

function fetchGitLabPullRequestRefsByProject(
  accountId: string,
  host: string,
  project: string | number,
  number: number,
) {
  return Effect.gen(function* () {
    console.info("[gitlab] fetching merge request diff refs", {
      host,
      project,
      number,
    });
    const versions = yield* gitlabJson(
      accountId,
      host,
      projectIdEndpoint(project, `merge_requests/${number}/versions`),
      Schema.Array(GitLabMrVersionSchema),
    );
    const version = versions[0];
    if (!version) {
      return yield* Effect.fail(new ProviderError("GitLab merge request has no diff versions"));
    }
    const refs = refsFromVersion(version);
    console.info("[gitlab] fetched merge request diff refs", {
      host,
      project,
      number,
      baseSha: refs.baseSha,
      headSha: refs.headSha,
    });
    return refs;
  });
}

function fetchGitLabPullRequestRefs(repo: RepoIdentity, number: number) {
  return fetchGitLabPullRequestRefsByProject(
    repo.accountId,
    repo.host,
    repo.path,
    number,
  );
}

function lineSide(position: GitLabPosition): "LEFT" | "RIGHT" | null {
  const end = position.line_range?.end;
  if (end?.type === "old") return "LEFT";
  if (end?.type === "new") return "RIGHT";
  if (position.old_line != null && position.new_line == null) return "LEFT";
  if (position.new_line != null) return "RIGHT";
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
  return (
    position.line_range?.start?.new_line ??
    position.line_range?.start?.old_line ??
    null
  );
}

function startSideFromPosition(position: GitLabPosition): "LEFT" | "RIGHT" | null {
  const type = position.line_range?.start?.type;
  if (type === "old") return "LEFT";
  if (type === "new") return "RIGHT";
  return null;
}

function pathFromPosition(position: GitLabPosition | null | undefined) {
  return position?.new_path ?? position?.old_path ?? "";
}

function discussionToReviewThread(discussion: GitLabDiscussion): ReviewThread | null {
  const notes = discussion.notes ?? [];
  const rootNote = notes[0];
  if (!rootNote) return null;

  const position = rootNote.position ?? null;
  const rootId = String(rootNote.id);
  const comments: ReviewComment[] = notes.map((note) => {
    const id = String(note.id);
    return {
      id,
      databaseId: note.id,
      authorLogin: note.author?.username ?? "unknown",
      authorAvatarUrl: note.author?.avatar_url ?? null,
      authorAssociation: null,
      body: note.body,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
      url: note.web_url ?? "",
      replyToId: id === rootId ? null : rootId,
    };
  });

  const subjectType =
    position?.position_type === "file"
      ? "file"
      : rootNote.type === "DiffNote"
        ? "line"
        : "file";

  return {
    id: discussion.id,
    provider: "gitlab",
    path: pathFromPosition(position),
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

function noteToGlobalReviewThread(note: typeof GitLabNoteSchema.Type): ReviewThread {
  return {
    id: String(note.id),
    provider: "gitlab",
    path: "",
    isResolved: false,
    isOutdated: false,
    line: null,
    startLine: null,
    side: null,
    startSide: null,
    subjectType: "global",
    comments: [
      {
        id: String(note.id),
        databaseId: note.id,
        authorLogin: note.author?.username ?? "unknown",
        authorAvatarUrl: note.author?.avatar_url ?? null,
        authorAssociation: null,
        body: note.body,
        createdAt: note.created_at,
        updatedAt: note.updated_at,
        url: note.web_url ?? "",
        replyToId: null,
      },
    ],
  };
}

class GitLabProvider implements ForgeProvider {
  authStatus(accountId: string): ReturnType<ForgeProvider["authStatus"]> {
    const provider = this;
    return Effect.gen(function* () {
      const token = yield* storedToken(accountId);
      if (!token) {
        return {
          status: "not_authenticated",
          message: "Sign in with GitLab to load projects.",
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
              message: "Sign in with GitLab again.",
            }
          : { status: "unknown_error", message };
        return Effect.succeed(status);
      }),
    ) as ReturnType<ForgeProvider["authStatus"]>;
  }

  viewerLogin(accountId: string) {
    return Effect.gen(function* () {
      const token = yield* requireStoredToken(accountId);
      const user = yield* gitlabJson(
        accountId,
        token.host,
        "user",
        GitLabUserSchema,
      );
      yield* saveViewerLogin(accountId, user.username);
      return user.username;
    });
  }

  listInitialRepos(accountId: string, limit: number) {
    return Effect.gen(function* () {
      const token = yield* requireStoredToken(accountId);
      const label = labelForToken(token);
      const endpoint = `projects?membership=true&simple=true&per_page=${limit}`;
      const projects = yield* gitlabJson(
        accountId,
        token.host,
        endpoint,
        Schema.Array(GitLabProjectSchema),
      );
      return projects.map((project) =>
        repoSummaryFromProject(accountId, token.host, label, project),
      );
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

      const endpoint = `projects?membership=true&search=${encodeURIComponent(
        trimmedQuery,
      )}&simple=true&per_page=${limit}`;
      const projects = yield* gitlabJson(
        accountId,
        token.host,
        endpoint,
        Schema.Array(GitLabProjectSchema),
      );
      return projects.map((project) =>
        repoSummaryFromProject(accountId, token.host, label, project),
      );
    });
  }

  validateRepo(accountId: string, input: string) {
    return Effect.gen(function* () {
      const token = yield* requireStoredToken(accountId);
      const label = labelForToken(token);
      const [validatedHost, projectPath] = parseGitLabRepoInput(token.host, input);
      if (validatedHost !== normalizeHost(token.host)) {
        return yield* Effect.fail(
          new ProviderError("Project URL host must match the selected GitLab account."),
        );
      }
      const project = yield* gitlabJson(
        accountId,
        validatedHost,
        projectPathEndpoint(projectPath),
        GitLabProjectSchema,
      );
      return repoSummaryFromProject(accountId, validatedHost, label, project);
    });
  }

  listOverviewPullRequests(accountId: string) {
    return Effect.gen(function* () {
      const token = yield* requireStoredToken(accountId);
      const label = labelForToken(token);
      console.info(
        `[gitlab] loading overview merge requests from ${token.host} (${OVERVIEW_MERGE_REQUEST_SCOPES.join(
          ", ",
        )})`,
      );
      const scopedResults = yield* Effect.forEach(
        OVERVIEW_MERGE_REQUEST_SCOPES,
        (scope) =>
          gitlabJson(
            accountId,
            token.host,
            overviewMergeRequestsEndpoint(scope),
            Schema.Array(GitLabMergeRequestSchema),
          ).pipe(
            Effect.map((mergeRequests) => ({ scope, mergeRequests, error: null })),
            Effect.catchAll((error) =>
              Effect.succeed({ scope, mergeRequests: [], error }),
            ),
          ),
        { concurrency: "unbounded" },
      );
      const mergeRequestsByKey = new Map<string, GitLabMergeRequest>();
      const errors: ProviderError[] = [];

      for (const result of scopedResults) {
        if (result.error) {
          errors.push(result.error);
          console.warn(
            `[gitlab] failed to load overview merge request scope ${result.scope} from ${token.host}`,
            result.error,
          );
          continue;
        }

        console.info(
          `[gitlab] loaded ${result.mergeRequests.length} overview merge requests for scope ${result.scope} from ${token.host}`,
        );
        for (const mergeRequest of result.mergeRequests) {
          mergeRequestsByKey.set(mergeRequestKey(mergeRequest), mergeRequest);
        }
      }

      if (
        mergeRequestsByKey.size === 0 &&
        errors.length === scopedResults.length
      ) {
        return yield* Effect.fail(
          new ProviderError(
            errors[0]?.message ?? "Failed to load GitLab overview merge requests.",
          ),
        );
      }

      const mergeRequests = [...mergeRequestsByKey.values()].sort(
        (left, right) =>
          Date.parse(right.updated_at) - Date.parse(left.updated_at),
      );
      console.info(
        `[gitlab] collected ${mergeRequests.length} overview merge requests from ${token.host}`,
      );
      const projectIds = [
        ...new Set(
          mergeRequests
            .map((mergeRequest) => mergeRequest.project_id)
            .filter(
              (projectId): projectId is number => typeof projectId === "number",
            ),
        ),
      ];
      const projectResults = yield* Effect.forEach(
        projectIds,
        (projectId) =>
          gitlabJson(
            accountId,
            token.host,
            `projects/${projectId}`,
            GitLabProjectSchema,
          ).pipe(
            Effect.map((project) => ({ projectId, project })),
            Effect.catchAll((error) => {
              console.warn(
                `[gitlab] failed to load project ${projectId} for overview`,
                error,
              );
              return Effect.succeed({ projectId, project: null });
            }),
          ),
        { concurrency: "unbounded" },
      );
      const projectsById = new Map<number, GitLabProject>();
      for (const result of projectResults) {
        if (result.project) {
          projectsById.set(result.projectId, result.project);
        }
      }
      const entries: OverviewPullRequestSummary[] = [];

      for (const mergeRequest of mergeRequests) {
        const projectId = mergeRequest.project_id;
        if (typeof projectId !== "number") {
          console.warn(
            `[gitlab] skipping overview MR !${mergeRequest.iid}: missing project_id`,
          );
          continue;
        }

        const project = projectsById.get(projectId);
        if (!project) continue;

        entries.push({
          repo: repoSummaryFromProject(accountId, token.host, label, project),
          pullRequest: toPullRequestSummary(mergeRequest),
        });
      }

      console.info(
        `[gitlab] mapped ${entries.length} overview merge requests from ${token.host}`,
      );
      return entries;
    });
  }

  listPullRequests(repo: RepoIdentity) {
    return Effect.gen(function* () {
      const mergeRequests = yield* gitlabJson(
        repo.accountId,
        repo.host,
        projectEndpoint(
          repo,
          "merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=100",
        ),
        Schema.Array(GitLabMergeRequestSchema),
      );

      return mergeRequests.map((mergeRequest) =>
        toPullRequestSummary(mergeRequest),
      );
    });
  }

  getPullRequest(repo: RepoIdentity, number: number) {
    return Effect.gen(function* () {
      const mergeRequest = yield* gitlabJson(
        repo.accountId,
        repo.host,
        projectEndpoint(repo, `merge_requests/${number}`),
        GitLabMergeRequestSchema,
      );
      return toPullRequestSummary(mergeRequest);
    });
  }

  fetchChangedFiles(repo: RepoIdentity, number: number) {
    return Effect.gen(function* () {
      const files: PrChangedFile[] = [];
      const seen = new Set<string>();
      let page = 1;
      let shouldContinue = true;
      while (shouldContinue) {
        const diffs = yield* gitlabJson(
          repo.accountId,
          repo.host,
          projectEndpoint(repo, `merge_requests/${number}/diffs?per_page=100&page=${page}`),
          Schema.Array(GitLabDiffSchema),
        );
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
    });
  }

  fetchPatch(repo: RepoIdentity, number: number) {
    return gitlabText(
      repo.accountId,
      repo.host,
      projectEndpoint(repo, `merge_requests/${number}/raw_diffs`),
    );
  }

  fetchPullRequestRefs(repo: RepoIdentity, number: number) {
    return fetchGitLabPullRequestRefs(repo, number);
  }

  fetchFileContent(repo: RepoIdentity, path: string, ref: string) {
    console.info("[gitlab] fetching file content", {
      repo: repo.path,
      path,
      ref,
    });
    return gitlabText(
      repo.accountId,
      repo.host,
      projectEndpoint(
        repo,
        `repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`,
      ),
    ).pipe(
      Effect.tap((content) =>
        Effect.sync(() => {
          console.info("[gitlab] fetched file content", {
            repo: repo.path,
            path,
            ref,
            length: content.length,
          });
        }),
      ),
    );
  }

  gitRemote(repo: RepoIdentity) {
    return Effect.gen(function* () {
      const token = yield* validAccessToken(repo.accountId);
      return {
        url: `https://${repo.host}/${repo.path}.git`,
        auth: {
          envConfig: [],
          askPass: {
            username: "oauth2",
            password: token,
          },
        },
      };
    });
  }

  listReviewThreads(repo: RepoIdentity, number: number) {
    return Effect.gen(function* () {
      const threads: ReviewThread[] = [];
      const discussionNoteIds = new Set<number>();
      let discussionsPage = 1;
      while (true) {
        const discussions = yield* gitlabJson(
          repo.accountId,
          repo.host,
          projectEndpoint(repo, `merge_requests/${number}/discussions?per_page=100&page=${discussionsPage}`),
          Schema.Array(GitLabDiscussionSchema),
        );
        if (discussions.length === 0) {
          break;
        }

        for (const discussion of discussions) {
          if (discussion.individual_note) continue;
          for (const note of discussion.notes ?? []) {
            discussionNoteIds.add(note.id);
          }
          const thread = discussionToReviewThread(discussion);
          if (thread) threads.push(thread);
        }
        discussionsPage += 1;
      }

      let notesPage = 1;
      while (true) {
        const notes = yield* gitlabJson(
          repo.accountId,
          repo.host,
          projectEndpoint(
            repo,
            `merge_requests/${number}/notes?order_by=created_at&sort=asc&per_page=100&page=${notesPage}`,
          ),
          Schema.Array(GitLabNoteSchema),
        );
        if (notes.length === 0) {
          break;
        }

        for (const note of notes) {
          if (note.system) continue;
          if (discussionNoteIds.has(note.id)) continue;
          if (note.position != null) continue;
          if (note.type === "DiffNote") continue;
          threads.push(noteToGlobalReviewThread(note));
        }
        notesPage += 1;
      }

      return threads;
    });
  }

  createReviewThread(repo: RepoIdentity, number: number, input: ReviewThreadInput) {
    return Effect.gen(function* () {
      const body = input.body.trim();
      if (!body) return yield* Effect.fail(new ProviderError("Comment body is required"));
      if (input.subjectType === "global") {
        yield* gitlabForm(
          repo.host,
          repo.accountId,
          "POST",
          projectEndpoint(repo, `merge_requests/${number}/notes`),
          [["body", body]],
        );
        return;
      }

      const versions = yield* gitlabJson(
        repo.accountId,
        repo.host,
        projectEndpoint(repo, `merge_requests/${number}/versions`),
        Schema.Array(GitLabMrVersionSchema),
      );
      const version = versions[0];
      if (!version) {
        return yield* Effect.fail(new ProviderError("GitLab merge request has no diff versions"));
      }

      const oldPath = input.oldPath.trim() || input.path.trim();
      const newPath = input.newPath.trim() || input.path.trim();
      const forms: Array<[string, string]> = [
        ["body", body],
        ["position[base_sha]", version.base_commit_sha],
        ["position[head_sha]", version.head_commit_sha],
        ["position[start_sha]", version.start_commit_sha],
        ["position[old_path]", oldPath],
        ["position[new_path]", newPath],
      ];

      if (input.subjectType === "file") {
        forms.push(["position[position_type]", "file"]);
      } else {
        if (input.line == null) {
          return yield* Effect.fail(new ProviderError("Line comments require a target line"));
        }
        forms.push(["position[position_type]", "text"]);
        if (input.side === "LEFT") {
          forms.push(["position[old_line]", String(input.line)]);
        } else {
          forms.push(["position[new_line]", String(input.line)]);
        }
      }

      yield* gitlabForm(
        repo.host,
        repo.accountId,
        "POST",
        projectEndpoint(repo, `merge_requests/${number}/discussions`),
        forms,
      );
    });
  }

  replyToReviewThread(repo: RepoIdentity, number: number, threadId: string, body: string) {
    return Effect.gen(function* () {
      const trimmedThreadId = threadId.trim();
      const trimmedBody = body.trim();
      if (!trimmedThreadId) return yield* Effect.fail(new ProviderError("Thread id is required"));
      if (!trimmedBody) return yield* Effect.fail(new ProviderError("Reply body is required"));
      yield* gitlabForm(
        repo.host,
        repo.accountId,
        "POST",
        projectEndpoint(
          repo,
          `merge_requests/${number}/discussions/${trimmedThreadId}/notes`,
        ),
        [["body", trimmedBody]],
      );
    });
  }

  updateReviewComment(
    repo: RepoIdentity,
    number: number,
    threadId: string,
    commentId: string,
    body: string,
    subjectType: ReviewThreadInput["subjectType"],
  ) {
    return Effect.gen(function* () {
      const trimmedThreadId = threadId.trim();
      const trimmedCommentId = commentId.trim();
      const trimmedBody = body.trim();
      if (!trimmedCommentId) return yield* Effect.fail(new ProviderError("Comment id is required"));
      if (!trimmedBody) return yield* Effect.fail(new ProviderError("Comment body is required"));
      if (subjectType !== "global" && !trimmedThreadId) {
        return yield* Effect.fail(new ProviderError("Thread id is required"));
      }

      if (subjectType === "global") {
        yield* gitlabForm(
          repo.host,
          repo.accountId,
          "PUT",
          projectEndpoint(repo, `merge_requests/${number}/notes/${trimmedCommentId}`),
          [["body", trimmedBody]],
        );
        return;
      }

      yield* gitlabForm(
        repo.host,
        repo.accountId,
        "PUT",
        projectEndpoint(
          repo,
          `merge_requests/${number}/discussions/${trimmedThreadId}/notes/${trimmedCommentId}`,
        ),
        [["body", trimmedBody]],
      );
    });
  }
}

export { GitLabProvider };
