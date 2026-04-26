import { Effect } from "effect";
import { ProviderError } from "../errors";
import { parseOwnerRepo } from "../repo-id";
import { createRepoId } from "../repo-id";
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

type GhActor = {
  login: string;
  avatarUrl?: string | null;
  avatar_url?: string | null;
};

type GhSearchRepo = {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean | null;
  owner?: GhActor | null;
};

type GhRestRepo = {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean | null;
  owner?: GhActor | null;
};

type GhRestUser = {
  login: string;
};

type GhSearchResponse = {
  items: GhSearchRepo[];
};

type GhChangedFile = {
  filename: string;
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
  accountId: string;
  login: string;
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
    normalized.includes("bad credentials") ||
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authenticate") ||
    (normalized.includes("github.com") && normalized.includes("login"))
  );
}

function graphqlErrors<T>(response: GraphQlResponse<T>) {
  if (!response.errors?.length) return;
  const message = response.errors.map((error) => error.message).join("\n");
  throw new ProviderError(message || "GitHub returned an unknown GraphQL error");
}

function githubApiBase(host: string) {
  return host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
}

function githubGraphqlUrl(host: string) {
  return host === "github.com" ? "https://api.github.com/graphql" : `https://${host}/api/graphql`;
}

async function githubJson<T>(
  accountId: string,
  host: string,
  path: string,
  init?: RequestInit,
) {
  return providerJson<T>(accountId, `${githubApiBase(host)}${path}`, {
    ...init,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}

async function githubText(accountId: string, host: string, path: string, accept: string) {
  return providerText(accountId, `${githubApiBase(host)}${path}`, {
    accept,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

async function githubGraphql<T>(
  accountId: string,
  host: string,
  query: string,
  variables: Record<string, string | number | boolean | null>,
) {
  const response = await providerJson<GraphQlResponse<T>>(accountId, githubGraphqlUrl(host), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  graphqlErrors(response);
  return response;
}

async function ensureUserContext(accountId: string, host: string) {
  if (
    userContext &&
    userContext.accountId === accountId &&
    Date.now() - userContext.fetchedAt < USER_CONTEXT_TTL_MS
  ) {
    return userContext.owners;
  }

  const user = await githubJson<GhRestUser>(accountId, host, "/user");
  const owners = [user.login];

  try {
    const orgs = await githubJson<GhRestUser[]>(accountId, host, "/user/orgs?per_page=100");
    for (const org of orgs) {
      if (org.login.trim().length > 0) owners.push(org.login);
    }
  } catch {
    // Organization lookup is best-effort.
  }

  await updateViewerLogin(accountId, user.login);
  userContext = { accountId, login: user.login, owners, fetchedAt: Date.now() };
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

  const response = await githubGraphql<PullRequestNodeIdQueryData>(repo.accountId, repo.host, query, {
    owner,
    name,
    number,
  });

  const id = response.data?.repository?.pullRequest?.id?.trim();
  if (!id) {
    throw new ProviderError("Pull request not found");
  }
  return id;
}

function repoSummaryFromSearch(accountId: string, host: string, label: string, repo: GhSearchRepo): RepoSummary {
  return {
    id: createRepoId("github", host, accountId, repo.full_name).key,
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
    id: createRepoId("github", host, accountId, repo.full_name).key,
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
  authStatus(accountId: string) {
    return providerEffect<ProviderAuthStatus>(async () => {
      try {
        const token = await getStoredAuthToken(accountId);
        if (!token) {
          return {
            status: "not_authenticated",
            message: "Sign in with GitHub to load repositories.",
          };
        }
        await Effect.runPromise(this.viewerLogin(accountId));
        return { status: "ready", message: null };
      } catch (error) {
        if (isNotAuthenticatedMessage(error instanceof Error ? error.message : String(error))) {
          return {
            status: "not_authenticated",
            message: "Sign in with GitHub again.",
          };
        }
        return {
          status: "unknown_error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  viewerLogin(accountId: string) {
    return providerEffect(async () => {
      const token = await getStoredAuthToken(accountId);
      if (!token) throw new ProviderError("GitHub is not signed in.");
      await ensureUserContext(accountId, token.host);
      const login = userContext?.login;
      if (!login) throw new ProviderError("Unable to determine GitHub viewer login");
      return login;
    });
  }

  listInitialRepos(accountId: string, limit: number) {
    return providerEffect(async () => {
      const token = await getStoredAuthToken(accountId);
      if (!token) throw new ProviderError("GitHub is not signed in.");
      const label = token.viewerLogin ? `${token.viewerLogin} @ ${token.host}` : token.host;
      const repos = await githubJson<GhRestRepo[]>(
        accountId,
        token.host,
        `/user/repos?per_page=${limit}&sort=updated&affiliation=owner,collaborator,organization_member`,
      );
      return repos.map((repo) => repoSummaryFromRest(accountId, token.host, label, repo));
    });
  }

  searchRepos(accountId: string, query: string, limit: number) {
    return providerEffect(async () => {
      const token = await getStoredAuthToken(accountId);
      if (!token) throw new ProviderError("GitHub is not signed in.");
      const label = token.viewerLogin ? `${token.viewerLogin} @ ${token.host}` : token.host;
      if (query.trim().length === 0) {
        return await Effect.runPromise(this.listInitialRepos(accountId, limit));
      }

      const owners = await ensureUserContext(accountId, token.host);
      const repos: GhSearchRepo[] = [];
      for (const owner of owners) {
        const qualifier = owner === userContext?.login ? "user" : "org";
        const response = await githubJson<GhSearchResponse>(
          accountId,
          token.host,
          `/search/repositories?q=${encodeURIComponent(`${query.trim()} in:name ${qualifier}:${owner}`)}&per_page=${limit}`,
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
    return providerEffect(async () => {
      const token = await getStoredAuthToken(accountId);
      if (!token) throw new ProviderError("GitHub is not signed in.");
      const label = token.viewerLogin ? `${token.viewerLogin} @ ${token.host}` : token.host;
      const repo = input.trim();
      if (repo.split("/").length !== 2 || repo.startsWith("/") || repo.endsWith("/")) {
        throw new ProviderError("Enter a repo as owner/name");
      }
      const [owner, name] = parseOwnerRepo(repo);
      const details = await githubJson<GhRestRepo>(accountId, token.host, `/repos/${owner}/${name}`);
      return repoSummaryFromRest(accountId, token.host, label, details);
    });
  }

  listPullRequests(repo: RepoId) {
    return providerEffect(async () => {
      const [owner, name] = parseOwnerRepo(repo.path);
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
      const response = await githubGraphql<{
        repository?: { pullRequests: { nodes: GhPullRequest[] } } | null;
      }>(repo.accountId, repo.host, query, { owner, name });
      return (response.data?.repository?.pullRequests.nodes ?? []).map(
        toPullRequestSummary,
      );
    });
  }

  getPullRequest(repo: RepoId, number: number) {
    return providerEffect(async () => {
      const [owner, name] = parseOwnerRepo(repo.path);
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
      const response = await githubGraphql<{
        repository?: { pullRequest?: GhPullRequest | null } | null;
      }>(repo.accountId, repo.host, query, { owner, name, number });
      const pullRequest = response.data?.repository?.pullRequest;
      if (!pullRequest) throw new ProviderError(`Pull request #${number} not found`);
      return toPullRequestSummary(pullRequest);
    });
  }

  fetchPatch(repo: RepoId, number: number) {
    return providerEffect(async () => {
      const [owner, name] = parseOwnerRepo(repo.path);
      return githubText(
        repo.accountId,
        repo.host,
        `/repos/${owner}/${name}/pulls/${number}`,
        "application/vnd.github.diff",
      );
    });
  }

  fetchChangedFiles(repo: RepoId, number: number) {
    return providerEffect(async () => {
      const [owner, name] = parseOwnerRepo(repo.path);
      const seen = new Set<string>();
      const files: string[] = [];
      let page = 1;
      while (true) {
        const items = await githubJson<GhChangedFile[]>(
          repo.accountId,
          repo.host,
          `/repos/${owner}/${name}/pulls/${number}/files?per_page=100&page=${page}`,
        );
        if (items.length === 0) break;
        for (const item of items) {
          if (!seen.has(item.filename)) {
            seen.add(item.filename);
            files.push(item.filename);
          }
        }
        page += 1;
      }
      return files;
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
      const response = await githubGraphql<ReviewThreadsQueryData>(repo.accountId, repo.host, query, {
        owner,
        name,
        number,
      });

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

      await githubGraphql(repo.accountId, repo.host, query, {
        pullRequestId,
        body,
        path: targetPath,
        line: input.line,
        side: input.side,
        startLine: input.startLine,
        startSide: input.startSide,
        subjectType: input.subjectType.toUpperCase(),
      });
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
      await githubGraphql(repo.accountId, repo.host, query, {
        pullRequestId,
        pullRequestReviewThreadId: threadId.trim(),
        body: trimmedBody,
      });
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
      await githubGraphql(_repo.accountId, _repo.host, query, {
        id: commentId.trim(),
        body: trimmedBody,
      });
    });
  }
}

export { GitHubProvider };
