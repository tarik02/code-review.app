import { Effect } from "effect";
import { ProviderError } from "../errors";
import { parseOwnerRepo } from "../repo-id";
import { runGh, runGhWithTimeout } from "../cli/github";
import { createRepoId } from "../repo-id";
import type {
  CliStatus,
  PullRequestSummary,
  RepoSummary,
  ReviewComment,
  ReviewThread,
} from "../../shared/types";
import type { ForgeProvider, ReviewThreadInput } from "./types";
import type { RepoId } from "../repo-id";

type GhActor = {
  login: string;
  avatarUrl?: string | null;
};

type GhRepoSummary = {
  name: string;
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean | null;
  owner?: GhActor | null;
};

type GhSearchRepo = {
  name: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean | null;
};

type GhPullRequest = {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  mergeStateStatus?: string | null;
  mergeable?: string | null;
  additions?: number | null;
  deletions?: number | null;
  author?: GhActor | null;
  updatedAt: string;
  url: string;
  headRefOid: string;
  baseRefOid?: string | null;
  mergedAt?: string | null;
};

type GraphQlResponse<T> = {
  data?: T | null;
  errors?: Array<{ message: string }> | null;
};

type PullRequestNodeIdQueryData = {
  repository?: {
    pullRequest?: {
      id: string;
    } | null;
  } | null;
};

type ReviewThreadsQueryData = {
  repository?: {
    pullRequest?: {
      reviewThreads: {
        nodes: GraphQlReviewThread[];
      };
    } | null;
  } | null;
};

type GraphQlReviewThread = {
  id: string;
  path: string;
  isResolved: boolean;
  isOutdated: boolean;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  originalStartLine: number | null;
  diffSide: string;
  startDiffSide: string | null;
  subjectType: string;
  comments: {
    nodes: GraphQlReviewComment[];
  };
};

type GraphQlReviewComment = {
  id: string;
  databaseId: number | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  path: string;
  authorAssociation: string | null;
  author?: GhActor | null;
  replyTo?: { id: string } | null;
};

type UserContext = {
  owners: string[];
  fetchedAt: number;
};

const USER_CONTEXT_TTL_MS = 60 * 60 * 1000;
let userContext: UserContext | null = null;

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
    normalized.includes("gh auth login") ||
    normalized.includes("authenticate") ||
    (normalized.includes("github.com") && normalized.includes("login"))
  );
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

function graphqlErrors<T>(response: GraphQlResponse<T>) {
  if (!response.errors?.length) return;
  const message = response.errors.map((error) => error.message).join("\n");
  throw new ProviderError(message || "GitHub returned an unknown GraphQL error");
}

async function runGhGraphql(args: string[]) {
  return runGh(args);
}

async function ensureUserContext() {
  if (userContext && Date.now() - userContext.fetchedAt < USER_CONTEXT_TTL_MS) {
    return userContext.owners;
  }

  const username = (await runGh(["api", "user", "--jq", ".login"])).trim();
  const owners = [username];

  try {
    const orgsStdout = await runGh(["api", "user/orgs", "--jq", ".[].login"]);
    for (const org of orgsStdout.split("\n")) {
      const trimmed = org.trim();
      if (trimmed.length > 0) owners.push(trimmed);
    }
  } catch {
    // Organization lookup is best-effort, matching the Rust implementation.
  }

  userContext = { owners, fetchedAt: Date.now() };
  return owners;
}

async function getPullRequestNodeId(repo: RepoId, number: number) {
  const [owner, name] = parseOwnerRepo(repo.path);
  const query = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
    }
  }
}
`;

  const stdout = await runGhGraphql([
    "api",
    "graphql",
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-F",
    `number=${number}`,
    "-f",
    `query=${query}`,
  ]);
  const response = parseJson<GraphQlResponse<PullRequestNodeIdQueryData>>(
    stdout,
    "Failed to parse pull request id",
  );
  graphqlErrors(response);

  const id = response.data?.repository?.pullRequest?.id?.trim();
  if (!id) {
    throw new ProviderError("Pull request not found");
  }
  return id;
}

function repoSummaryFromGh(repo: GhRepoSummary): RepoSummary {
  return {
    id: createRepoId("github", "github.com", repo.nameWithOwner).key,
    provider: "github",
    host: "github.com",
    name: repo.name,
    nameWithOwner: repo.nameWithOwner,
    description: repo.description,
    isPrivate: repo.isPrivate,
    avatarUrl: repo.owner?.avatarUrl ?? null,
  };
}

function repoSummaryFromSearch(repo: GhSearchRepo): RepoSummary {
  return {
    id: createRepoId("github", "github.com", repo.fullName).key,
    provider: "github",
    host: "github.com",
    name: repo.name,
    nameWithOwner: repo.fullName,
    description: repo.description,
    isPrivate: repo.isPrivate,
    avatarUrl: null,
  };
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
  cliStatus(_host: string) {
    return providerEffect<CliStatus>(async () => {
      const versionOutput = await runGhWithTimeout(["--version"]);
      if (!versionOutput.ok) {
        if (versionOutput.kind === "missing") {
          return {
            status: "missing_cli",
            message: "GitHub CLI is not installed or not available on PATH.",
          };
        }
        return {
          status: "unknown_error",
          message: `Couldn't verify GitHub CLI: ${versionOutput.message}`,
        };
      }

      const authOutput = await runGhWithTimeout(["auth", "status"]);
      if (authOutput.ok) return { status: "ready", message: null };

      if (authOutput.kind === "missing") {
        return {
          status: "missing_cli",
          message: "GitHub CLI is not installed or not available on PATH.",
        };
      }
      if (isNotAuthenticatedMessage(authOutput.message)) {
        return {
          status: "not_authenticated",
          message: "Authenticate GitHub CLI with `gh auth login`.",
        };
      }
      return { status: "unknown_error", message: authOutput.message };
    });
  }

  viewerLogin(_host: string) {
    return providerEffect(async () => {
      const owners = await ensureUserContext();
      const login = owners[0];
      if (!login) throw new ProviderError("Unable to determine GitHub viewer login");
      return login;
    });
  }

  listInitialRepos(_host: string, limit: number) {
    return providerEffect(async () => {
      const stdout = await runGh([
        "repo",
        "list",
        "--json",
        "name,nameWithOwner,description,isPrivate,owner",
        "--limit",
        String(limit),
      ]);
      return parseJson<GhRepoSummary[]>(stdout, "Failed to parse repos").map(
        repoSummaryFromGh,
      );
    });
  }

  searchRepos(_host: string, query: string, limit: number) {
    return providerEffect(async () => {
      if (query.trim().length === 0) {
        return await Effect.runPromise(this.listInitialRepos("github.com", limit));
      }

      const owners = await ensureUserContext();
      const args = [
        "search",
        "repos",
        query,
        "--limit",
        String(limit),
        "--json",
        "name,fullName,description,isPrivate",
        "--match",
        "name",
      ];
      for (const owner of owners) {
        args.push("--owner", owner);
      }
      const stdout = await runGh(args);
      const repos = parseJson<GhSearchRepo[]>(
        stdout,
        "Failed to parse search results",
      );
      const seen = new Set<string>();
      return repos.flatMap((repo) => {
        if (seen.has(repo.fullName)) return [];
        seen.add(repo.fullName);
        return [repoSummaryFromSearch(repo)];
      });
    });
  }

  validateRepo(_host: string, input: string) {
    return providerEffect(async () => {
      const repo = input.trim();
      if (repo.split("/").length !== 2 || repo.startsWith("/") || repo.endsWith("/")) {
        throw new ProviderError("Enter a repo as owner/name");
      }
      const stdout = await runGh([
        "repo",
        "view",
        repo,
        "--json",
        "name,nameWithOwner,description,isPrivate,owner",
      ]);
      return repoSummaryFromGh(
        parseJson<GhRepoSummary>(stdout, "Failed to parse repo details"),
      );
    });
  }

  listPullRequests(repo: RepoId) {
    return providerEffect(async () => {
      const stdout = await runGh([
        "pr",
        "list",
        "-R",
        repo.path,
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,title,state,isDraft,mergeStateStatus,mergeable,additions,deletions,author,updatedAt,url,headRefOid,baseRefOid",
      ]);
      return parseJson<GhPullRequest[]>(
        stdout,
        "Failed to parse pull requests",
      ).map(toPullRequestSummary);
    });
  }

  getPullRequest(repo: RepoId, number: number) {
    return providerEffect(async () => {
      const stdout = await runGh([
        "pr",
        "view",
        String(number),
        "-R",
        repo.path,
        "--json",
        "number,title,state,isDraft,mergeStateStatus,mergeable,additions,deletions,author,updatedAt,url,headRefOid,baseRefOid,mergedAt",
      ]);
      return toPullRequestSummary(
        parseJson<GhPullRequest>(
          stdout,
          `Failed to parse pull request #${number}`,
        ),
      );
    });
  }

  fetchPatch(repo: RepoId, number: number) {
    return providerEffect(() =>
      runGh(["pr", "diff", String(number), "-R", repo.path, "--color", "never"]),
    );
  }

  fetchChangedFiles(repo: RepoId, number: number) {
    return providerEffect(async () => {
      const stdout = await runGh([
        "pr",
        "diff",
        String(number),
        "-R",
        repo.path,
        "--name-only",
        "--color",
        "never",
      ]);
      const seen = new Set<string>();
      return stdout.split("\n").flatMap((line) => {
        const item = line.trim();
        if (!item || seen.has(item)) return [];
        seen.add(item);
        return [item];
      });
    });
  }

  listReviewThreads(repo: RepoId, number: number) {
    return providerEffect(async () => {
      const [owner, name] = parseOwnerRepo(repo.path);
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
      const stdout = await runGhGraphql([
        "api",
        "graphql",
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
        "-F",
        `number=${number}`,
        "-f",
        `query=${query}`,
      ]);
      const response = parseJson<GraphQlResponse<ReviewThreadsQueryData>>(
        stdout,
        "Failed to parse review threads",
      );
      graphqlErrors(response);

      return (
        response.data?.repository?.pullRequest?.reviewThreads.nodes ?? []
      ).flatMap((thread): ReviewThread[] => {
        if (thread.comments.nodes.length === 0) return [];
        const comments: ReviewComment[] = thread.comments.nodes.map((comment) => ({
          id: comment.id,
          databaseId: comment.databaseId,
          authorLogin: comment.author?.login ?? "unknown",
          authorAvatarUrl: comment.author?.avatarUrl ?? null,
          authorAssociation: comment.authorAssociation,
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
            line: thread.line ?? thread.originalLine,
            startLine: thread.startLine ?? thread.originalStartLine,
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

  createReviewThread(repo: RepoId, number: number, input: ReviewThreadInput) {
    return providerEffect(async () => {
      const body = input.body.trim();
      const targetPath = input.path.trim();
      if (!body) throw new ProviderError("Comment body is required");
      if (!targetPath) throw new ProviderError("File path is required");
      if (input.subjectType === "line" && input.line == null) {
        throw new ProviderError("Line comments require a target line");
      }

      const pullRequestId = await getPullRequestNodeId(repo, number);
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

      const args = [
        "api",
        "graphql",
        "-f",
        `pullRequestId=${pullRequestId}`,
        "-f",
        `body=${body}`,
        "-f",
        `path=${targetPath}`,
        "-f",
        `subjectType=${input.subjectType.toUpperCase()}`,
        "-f",
        `query=${query}`,
      ];
      if (input.line != null) args.push("-F", `line=${input.line}`);
      if (input.side) args.push("-f", `side=${input.side}`);
      if (input.startLine != null) args.push("-F", `startLine=${input.startLine}`);
      if (input.startSide) args.push("-f", `startSide=${input.startSide}`);
      await runGhGraphql(args);
    });
  }

  replyToReviewThread(repo: RepoId, number: number, threadId: string, body: string) {
    return providerEffect(async () => {
      const trimmedBody = body.trim();
      if (!threadId.trim()) throw new ProviderError("Thread id is required");
      if (!trimmedBody) throw new ProviderError("Reply body is required");
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
      const pullRequestId = await getPullRequestNodeId(repo, number);
      await runGhGraphql([
        "api",
        "graphql",
        "-f",
        `pullRequestId=${pullRequestId}`,
        "-f",
        `pullRequestReviewThreadId=${threadId.trim()}`,
        "-f",
        `body=${trimmedBody}`,
        "-f",
        `query=${query}`,
      ]);
    });
  }

  updateReviewComment(
    _repo: RepoId,
    _number: number,
    threadId: string,
    commentId: string,
    body: string,
  ) {
    return providerEffect(async () => {
      const trimmedBody = body.trim();
      if (!threadId.trim()) throw new ProviderError("Thread id is required");
      if (!commentId.trim()) throw new ProviderError("Comment id is required");
      if (!trimmedBody) throw new ProviderError("Comment body is required");
      const query = `
mutation($id: ID!, $body: String!) {
  updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) {
    pullRequestReviewComment { id }
  }
}
`;
      await runGhGraphql([
        "api",
        "graphql",
        "-f",
        `id=${commentId.trim()}`,
        "-f",
        `body=${trimmedBody}`,
        "-f",
        `query=${query}`,
      ]);
    });
  }
}

export { GitHubProvider };
