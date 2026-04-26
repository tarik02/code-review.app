import { Effect } from "effect";
import { ProviderError } from "../errors";
import { createRepoId, normalizeHost, normalizePath } from "../repo-id";
import { providerJson, providerText } from "../auth/http";
import { getStoredAuthToken, updateViewerLogin } from "../auth/provider-auth";
import type {
  ProviderAuthStatus,
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

function projectEndpoint(repo: RepoId, suffix: string) {
  return `projects/${encodeURIComponent(repo.path)}/${suffix}`;
}

function projectPathEndpoint(path: string) {
  return `projects/${encodeURIComponent(path)}`;
}

function gitlabApiUrl(host: string, endpoint: string) {
  return `https://${normalizeHost(host)}/api/v4/${endpoint}`;
}

async function gitlabJson<T>(
  accountId: string,
  host: string,
  endpoint: string,
  init?: RequestInit,
) {
  return providerJson<T>(accountId, gitlabApiUrl(host, endpoint), {
    ...init,
    headers: init?.headers as Record<string, string> | undefined,
  });
}

async function gitlabText(accountId: string, host: string, endpoint: string) {
  return providerText(accountId, gitlabApiUrl(host, endpoint));
}

async function gitlabForm(
  host: string,
  accountId: string,
  method: string,
  endpoint: string,
  forms: Array<[string, string]>,
) {
  const body = new FormData();
  for (const [key, value] of forms) {
    body.set(key, value);
  }
  await gitlabJson<unknown>(accountId, host, endpoint, {
    method,
    body,
  });
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
    id: createRepoId("gitlab", normalizedHost, accountId, project.path_with_namespace).key,
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
  authStatus(accountId: string) {
    return providerEffect<ProviderAuthStatus>(async () => {
      try {
        const token = await getStoredAuthToken(accountId);
        if (!token) {
          return {
            status: "not_authenticated",
            message: "Sign in with GitLab to load projects.",
          };
        }
        await Effect.runPromise(this.viewerLogin(accountId));
        return { status: "ready", message: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isNotAuthenticatedMessage(message)) {
          return {
            status: "not_authenticated",
            message: "Sign in with GitLab again.",
          };
        }
        return { status: "unknown_error", message };
      }
    });
  }

  viewerLogin(accountId: string) {
    return providerEffect(async () => {
      const token = await getStoredAuthToken(accountId);
      if (!token) throw new ProviderError("GitLab is not signed in.");
      const username = (await gitlabJson<GitLabUser>(accountId, token.host, "user")).username;
      await updateViewerLogin(accountId, username);
      return username;
    });
  }

  listInitialRepos(accountId: string, limit: number) {
    return providerEffect(async () => {
      const token = await getStoredAuthToken(accountId);
      if (!token) throw new ProviderError("GitLab is not signed in.");
      const label = token.viewerLogin ? `${token.viewerLogin} @ ${token.host}` : token.host;
      const endpoint = `projects?membership=true&simple=true&per_page=${limit}`;
      return (await gitlabJson<GitLabProject[]>(accountId, token.host, endpoint)).map((project) =>
        repoSummaryFromProject(accountId, token.host, label, project),
      );
    });
  }

  searchRepos(accountId: string, query: string, limit: number) {
    return providerEffect(async () => {
      const token = await getStoredAuthToken(accountId);
      if (!token) throw new ProviderError("GitLab is not signed in.");
      const label = token.viewerLogin ? `${token.viewerLogin} @ ${token.host}` : token.host;
      if (query.trim().length === 0) {
        return await Effect.runPromise(this.listInitialRepos(accountId, limit));
      }

      const endpoint = `projects?membership=true&search=${encodeURIComponent(
        query.trim(),
      )}&simple=true&per_page=${limit}`;
      return (await gitlabJson<GitLabProject[]>(accountId, token.host, endpoint)).map((project) =>
        repoSummaryFromProject(accountId, token.host, label, project),
      );
    });
  }

  validateRepo(accountId: string, input: string) {
    return providerEffect(async () => {
      const token = await getStoredAuthToken(accountId);
      if (!token) throw new ProviderError("GitLab is not signed in.");
      const label = token.viewerLogin ? `${token.viewerLogin} @ ${token.host}` : token.host;
      const [validatedHost, projectPath] = parseGitLabRepoInput(token.host, input);
      if (validatedHost !== normalizeHost(token.host)) {
        throw new ProviderError("Project URL host must match the selected GitLab account.");
      }
      return repoSummaryFromProject(
        accountId,
        validatedHost,
        label,
        await gitlabJson<GitLabProject>(accountId, validatedHost, projectPathEndpoint(projectPath)),
      );
    });
  }

  listPullRequests(repo: RepoId) {
    return providerEffect(async () => {
      return (
        await gitlabJson<GitLabMergeRequest[]>(
          repo.accountId,
          repo.host,
          projectEndpoint(repo, "merge_requests?state=opened&per_page=100"),
        )
      ).map(toPullRequestSummary);
    });
  }

  getPullRequest(repo: RepoId, number: number) {
    return providerEffect(async () => {
      return toPullRequestSummary(
        await gitlabJson<GitLabMergeRequest>(
          repo.accountId,
          repo.host,
          projectEndpoint(repo, `merge_requests/${number}`),
        ),
      );
    });
  }

  fetchPatch(repo: RepoId, number: number) {
    return providerEffect(() =>
      gitlabText(repo.accountId, repo.host, projectEndpoint(repo, `merge_requests/${number}/raw_diffs`)),
    );
  }

  fetchChangedFiles(repo: RepoId, number: number) {
    return providerEffect(async () => {
      const files: string[] = [];
      const seen = new Set<string>();
      let page = 1;
      while (true) {
        const diffs = await gitlabJson<GitLabDiff[]>(
          repo.accountId,
          repo.host,
          projectEndpoint(repo, `merge_requests/${number}/diffs?per_page=100&page=${page}`),
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
        const discussions = await gitlabJson<GitLabDiscussion[]>(
          repo.accountId,
          repo.host,
          projectEndpoint(
            repo,
            `merge_requests/${number}/discussions?per_page=100&page=${page}`,
          ),
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

      const version = (
        await gitlabJson<GitLabMrVersion[]>(
          repo.accountId,
          repo.host,
          projectEndpoint(repo, `merge_requests/${number}/versions`),
        )
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

      await gitlabForm(
        repo.host,
        repo.accountId,
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
      await gitlabForm(
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
      await gitlabForm(
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
