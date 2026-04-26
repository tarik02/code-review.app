type ForgeProviderKind = "github" | "gitlab";

type RepoSummary = {
  id: string;
  provider: ForgeProviderKind;
  host: string;
  name: string;
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean | null;
  avatarUrl: string | null;
};

type PullRequestSummary = {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  mergeStateStatus: string;
  mergeable: string;
  additions: number | null;
  deletions: number | null;
  changeCount: number | null;
  authorLogin: string;
  updatedAt: string;
  url: string;
  headSha: string;
  baseSha: string | null;
};

enum PullRequestBadgeStatus {
  Merged = "merged",
  Closed = "closed",
  Draft = "draft",
  Conflicting = "conflicting",
  CanMerge = "can_merge",
  Open = "open",
}

type SelectedPullRequest = {
  repoId: string;
  number: number;
  headSha: string;
};

type PrPatch = {
  repoId: string;
  number: number;
  headSha: string;
  patch: string;
};

type ViewerLogin = {
  login: string;
};

type CliStatusKind =
  | "ready"
  | "missing_cli"
  | "not_authenticated"
  | "unknown_error";

type CliStatus = {
  status: CliStatusKind;
  message: string | null;
};

type ReviewCommentSide = "LEFT" | "RIGHT";

type ReviewComment = {
  id: string;
  databaseId: number | null;
  authorLogin: string;
  authorAvatarUrl: string | null;
  authorAssociation: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  replyToId: string | null;
  isPending?: boolean;
  isOptimistic?: boolean;
};

type ReviewThread = {
  id: string;
  provider: ForgeProviderKind;
  path: string;
  isResolved: boolean;
  isOutdated: boolean;
  line: number | null;
  startLine: number | null;
  side: ReviewCommentSide | null;
  startSide: ReviewCommentSide | null;
  subjectType: "file" | "line" | null;
  comments: ReviewComment[];
  isPending?: boolean;
  isOptimistic?: boolean;
};

type CreatePullRequestReviewCommentInput = {
  repoId: string;
  number: number;
  body: string;
  path: string;
  oldPath: string;
  newPath: string;
  line: number | null;
  side: ReviewCommentSide | null;
  startLine: number | null;
  startSide: ReviewCommentSide | null;
  subjectType: "file" | "line";
};

type ReplyToPullRequestReviewCommentInput = {
  repoId: string;
  number: number;
  threadId: string;
  body: string;
};

type UpdatePullRequestReviewCommentInput = {
  repoId: string;
  number: number;
  threadId: string;
  commentId: string;
  body: string;
};

type AvailableUpdate = {
  version: string;
  body: string | null;
};

type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; update: AvailableUpdate }
  | { type: "not_available" }
  | { type: "progress"; downloaded: number; contentLength: number | null }
  | { type: "downloaded"; update: AvailableUpdate }
  | { type: "error"; message: string };

export { PullRequestBadgeStatus };
export type {
  AvailableUpdate,
  CliStatus,
  CliStatusKind,
  CreatePullRequestReviewCommentInput,
  ForgeProviderKind,
  PrPatch,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoSummary,
  ReviewComment,
  ReviewCommentSide,
  ReviewThread,
  SelectedPullRequest,
  UpdateEvent,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
};
