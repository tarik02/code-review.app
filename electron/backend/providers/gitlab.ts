import { Effect } from "effect";
import { ProviderError } from "../errors";
import { createRepoId, normalizeHost, normalizePath } from "../repo-id";
import { runGlabApi, runGlabApiMethod, runGlabWithTimeout } from "../cli/gitlab";
import type {
  CliStatus,
  PullRequestSummary,
  RepoSummary,
  ReviewComment,
  ReviewThread,
} from "../../shared/types";
import type { ForgeProvider, ReviewThreadInput } from "./types";
import type { RepoId } from "../repo-id";

type GitLabProject = {
  name: string;
  path_with_namespace: string;
  description: string | null;
  visibility: string | null;
  avatar_url: string | null;
};

type GitLabUser = {
  username: string;
  avatar_url?: string | null;
};

type GitLabDiffRefs = {
  base_sha?: string | null;
  head_sha?: string | null;
  start_sha?: string | null;
};

type GitLabMergeRequest = {
  iid: number;
  title: string;
  state: string;
  draft?: boolean | null;
  work_in_progress?: boolean | null;
  merge_status?: string | null;
  detailed_merge_status?: string | null;
  changes_count?: string | null;
  author?: GitLabUser | null;
  updated_at: string;
  web_url: string;
  sha?: string | null;
  diff_refs?: GitLabDiffRefs | null;
};

type GitLabDiff = {
  new_path: string;
};

type GitLabDiscussion = {
  id: string;
  individual_note?: boolean;
  notes?: GitLabNote[];
};

type GitLabNote = {
  id: number;
  type?: string | null;
  body: string;
  author?: GitLabUser | null;
  created_at: string;
  updated_at: string;
  web_url?: string | null;
  resolved?: boolean | null;
  position?: GitLabPosition | null;
};

type GitLabPosition = {
  old_path?: string | null;
  new_path?: string | null;
  old_line?: number | null;
  new_line?: number | null;
  position_type?: string | null;
  line_range?: GitLabLineRange | null;
};

type GitLabLineRange = {
  start?: GitLabLineRangePoint | null;
  end?: GitLabLineRangePoint | null;
};

type GitLabLineRangePoint = {
  type?: string | null;
  old_line?: number | null;
  new_line?: number | null;
};

type GitLabMrVersion = {
  base_commit_sha: string;
  head_commit_sha: string;
  start_commit_sha: string;
};

function providerEffect<A>(operation: () => Promise<A>) {
  return Effect.tryPromise({
    try: operation,
    catch: (error) =>
      error instanceof ProviderError
        ? error
        : new ProviderError(error instanceof Error ? error.message : String(error)),
  });
}

function parseJson<T>(input: string, context: string): T {
  try {
    return JSON.parse(input) as T;
  } catch (error) {
    throw new ProviderError(
      `${context}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isNotAuthenticatedMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not logged") ||
    normalized.includes("not authenticated") ||
    normalized.includes("glab auth login") ||
    normalized.includes("authenticate") ||
    normalized.includes("401") ||
    normalized.includes("unauthorized")
  );
}

function projectEndpoint(repo: RepoId, suffix: string) {
  return `projects/${encodeURIComponent(repo.path)}/${suffix}`;
}

function projectPathEndpoint(path: string) {
  return `projects/${encodeURIComponent(path)}`;
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

function repoSummaryFromProject(host: string, project: GitLabProject): RepoSummary {
  const normalizedHost = normalizeHost(host);
  return {
    id: createRepoId("gitlab", normalizedHost, project.path_with_namespace).key,
    provider: "gitlab",
    host: normalizedHost,
    name: project.name,
    nameWithOwner: project.path_with_namespace,
    description: project.description,
    isPrivate:
      project.visibility == null ? null : project.visibility.toLowerCase() !== "public",
    avatarUrl: project.avatar_url,
  };
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

class GitLabProvider implements ForgeProvider {
  cliStatus(host: string) {
    return providerEffect<CliStatus>(async () => {
      const versionOutput = await runGlabWithTimeout(["--version"]);
      if (!versionOutput.ok) {
        if (versionOutput.kind === "missing") {
          return {
            status: "missing_cli",
            message: "GitLab CLI is not installed or not available on PATH.",
          };
        }
        return {
          status: "unknown_error",
          message: `Couldn't verify GitLab CLI: ${versionOutput.message}`,
        };
      }

      const authOutput = await runGlabWithTimeout([
        "auth",
        "status",
        "--hostname",
        normalizeHost(host),
      ]);
      if (authOutput.ok) return { status: "ready", message: null };

      if (normalizeHost(host) === "gitlab.com") {
        const anyHostAuthOutput = await runGlabWithTimeout(["auth", "status"]);
        if (anyHostAuthOutput.ok) return { status: "ready", message: null };
      }

      if (authOutput.kind === "missing") {
        return {
          status: "missing_cli",
          message: "GitLab CLI is not installed or not available on PATH.",
        };
      }
      if (isNotAuthenticatedMessage(authOutput.message)) {
        return {
          status: "not_authenticated",
          message: `Authenticate GitLab CLI with \`glab auth login --hostname ${normalizeHost(host)}\`.`,
        };
      }
      return { status: "unknown_error", message: authOutput.message };
    });
  }

  viewerLogin(host: string) {
    return providerEffect(async () => {
      const stdout = await runGlabApi(host, "user");
      return parseJson<GitLabUser>(stdout, "Failed to parse GitLab viewer").username;
    });
  }

  listInitialRepos(host: string, limit: number) {
    return providerEffect(async () => {
      const endpoint = `projects?membership=true&simple=true&per_page=${limit}`;
      const stdout = await runGlabApi(host, endpoint);
      return parseJson<GitLabProject[]>(
        stdout,
        "Failed to parse GitLab projects",
      ).map((project) => repoSummaryFromProject(host, project));
    });
  }

  searchRepos(host: string, query: string, limit: number) {
    return providerEffect(async () => {
      if (query.trim().length === 0) {
        return await Effect.runPromise(this.listInitialRepos(host, limit));
      }

      const endpoint = `projects?membership=true&search=${encodeURIComponent(
        query.trim(),
      )}&simple=true&per_page=${limit}`;
      const stdout = await runGlabApi(host, endpoint);
      return parseJson<GitLabProject[]>(
        stdout,
        "Failed to parse GitLab project search results",
      ).map((project) => repoSummaryFromProject(host, project));
    });
  }

  validateRepo(host: string, input: string) {
    return providerEffect(async () => {
      const [validatedHost, projectPath] = parseGitLabRepoInput(host, input);
      const stdout = await runGlabApi(validatedHost, projectPathEndpoint(projectPath));
      return repoSummaryFromProject(
        validatedHost,
        parseJson<GitLabProject>(stdout, "Failed to parse GitLab project"),
      );
    });
  }

  listPullRequests(repo: RepoId) {
    return providerEffect(async () => {
      const stdout = await runGlabApi(
        repo.host,
        projectEndpoint(repo, "merge_requests?state=opened&per_page=100"),
      );
      return parseJson<GitLabMergeRequest[]>(
        stdout,
        "Failed to parse GitLab merge requests",
      ).map(toPullRequestSummary);
    });
  }

  getPullRequest(repo: RepoId, number: number) {
    return providerEffect(async () => {
      const stdout = await runGlabApi(
        repo.host,
        projectEndpoint(repo, `merge_requests/${number}`),
      );
      return toPullRequestSummary(
        parseJson<GitLabMergeRequest>(
          stdout,
          `Failed to parse GitLab merge request #${number}`,
        ),
      );
    });
  }

  fetchPatch(repo: RepoId, number: number) {
    return providerEffect(() =>
      runGlabApi(repo.host, projectEndpoint(repo, `merge_requests/${number}/raw_diffs`)),
    );
  }

  fetchChangedFiles(repo: RepoId, number: number) {
    return providerEffect(async () => {
      const files: string[] = [];
      const seen = new Set<string>();
      let page = 1;
      while (true) {
        const stdout = await runGlabApi(
          repo.host,
          projectEndpoint(repo, `merge_requests/${number}/diffs?per_page=100&page=${page}`),
        );
        const diffs = parseJson<GitLabDiff[]>(
          stdout,
          "Failed to parse GitLab merge request diffs",
        );
        if (diffs.length === 0) break;
        for (const diff of diffs) {
          if (!seen.has(diff.new_path)) {
            seen.add(diff.new_path);
            files.push(diff.new_path);
          }
        }
        page += 1;
      }
      return files;
    });
  }

  listReviewThreads(repo: RepoId, number: number) {
    return providerEffect(async () => {
      const threads: ReviewThread[] = [];
      let page = 1;
      while (true) {
        const stdout = await runGlabApi(
          repo.host,
          projectEndpoint(
            repo,
            `merge_requests/${number}/discussions?per_page=100&page=${page}`,
          ),
        );
        const discussions = parseJson<GitLabDiscussion[]>(
          stdout,
          "Failed to parse GitLab discussions",
        );
        if (discussions.length === 0) break;
        for (const discussion of discussions) {
          if (discussion.individual_note) continue;
          const thread = discussionToReviewThread(discussion);
          if (thread) threads.push(thread);
        }
        page += 1;
      }
      return threads;
    });
  }

  createReviewThread(repo: RepoId, number: number, input: ReviewThreadInput) {
    return providerEffect(async () => {
      const body = input.body.trim();
      if (!body) throw new ProviderError("Comment body is required");

      const versionsStdout = await runGlabApi(
        repo.host,
        projectEndpoint(repo, `merge_requests/${number}/versions`),
      );
      const version = parseJson<GitLabMrVersion[]>(
        versionsStdout,
        "Failed to parse GitLab merge request versions",
      )[0];
      if (!version) throw new ProviderError("GitLab merge request has no diff versions");

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
          throw new ProviderError("Line comments require a target line");
        }
        forms.push(["position[position_type]", "text"]);
        if (input.side === "LEFT") {
          forms.push(["position[old_line]", String(input.line)]);
        } else {
          forms.push(["position[new_line]", String(input.line)]);
        }
      }

      await runGlabApiMethod(
        repo.host,
        "POST",
        projectEndpoint(repo, `merge_requests/${number}/discussions`),
        forms,
      );
    });
  }

  replyToReviewThread(repo: RepoId, number: number, threadId: string, body: string) {
    return providerEffect(async () => {
      const trimmedThreadId = threadId.trim();
      const trimmedBody = body.trim();
      if (!trimmedThreadId) throw new ProviderError("Thread id is required");
      if (!trimmedBody) throw new ProviderError("Reply body is required");
      await runGlabApiMethod(
        repo.host,
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
    repo: RepoId,
    number: number,
    threadId: string,
    commentId: string,
    body: string,
  ) {
    return providerEffect(async () => {
      const trimmedThreadId = threadId.trim();
      const trimmedCommentId = commentId.trim();
      const trimmedBody = body.trim();
      if (!trimmedThreadId) throw new ProviderError("Thread id is required");
      if (!trimmedCommentId) throw new ProviderError("Comment id is required");
      if (!trimmedBody) throw new ProviderError("Comment body is required");
      await runGlabApiMethod(
        repo.host,
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
