import type { FileDiffMetadata } from "@pierre/diffs";

type ForgeProviderKind = "github" | "gitlab";

type DiffDataMode = "provider-api" | "git";

type DiffDataSettings = {
  mode: DiffDataMode;
};

type ThemePreference = "auto" | "light" | "dark";

type ThemePreferenceSettings = {
  preference: ThemePreference;
};

type ReviewEditorMode = "rich-text" | "source";

type ReviewEditorSettings = {
  defaultMode: ReviewEditorMode;
};

type RepoIdentity = {
  providerId: string;
  repoKey: string;
};

type RepoSummary = RepoIdentity & {
  provider: ForgeProviderKind;
  host: string;
  providerAccountId: string;
  providerAccountLabel: string;
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

type OverviewPullRequestSummary = {
  repo: RepoSummary;
  pullRequest: PullRequestSummary;
};

export const PullRequestBadgeStatus = {
  Merged: "merged",
  Closed: "closed",
  Draft: "draft",
  Conflicting: "conflicting",
  CanMerge: "can_merge",
  Open: "open",
} as const;

export type PullRequestBadgeStatus =
  (typeof PullRequestBadgeStatus)[keyof typeof PullRequestBadgeStatus];

type SelectedPullRequest = {
  providerId: string;
  repoKey: string;
  number: number;
  headSha: string;
  baseSha?: string | null;
};

type PrPatch = RepoIdentity & {
  number: number;
  headSha: string;
  fileDiffs: FileDiffMetadata[];
};

type PrFileChangeType =
  | "change"
  | "rename-pure"
  | "rename-changed"
  | "new"
  | "deleted";

type PrChangedFile = {
  path: string;
  oldPath: string;
  newPath: string;
  changeType: PrFileChangeType;
};

type PrFileContents = RepoIdentity & {
  oldPath: string;
  newPath: string;
  baseSha: string | null;
  headSha: string;
  oldContent: string;
  newContent: string;
};

type ViewerLogin = {
  login: string;
};

type AccountVisibilitySettings = {
  enabledAccountIds: string[];
  disabledAccountIds: string[];
};

type AppearanceBackgroundSettings =
  | { kind: "default" }
  | { kind: "solid"; color: string }
  | {
      kind: "customFile";
      fileName: string;
      mimeType: string;
      dataUrl: string | null;
    };

type AppearanceBackgroundInput =
  | { kind: "default" }
  | { kind: "solid"; color: string };

type ProviderProfile = {
  accountId: string;
  login: string;
};

type ProviderAuthStatusKind =
  | "ready"
  | "not_authenticated"
  | "unknown_error";

type ProviderAuthStatus = {
  status: ProviderAuthStatusKind;
  message: string | null;
};

type ProviderAccount = {
  id: string;
  provider: ForgeProviderKind;
  host: string;
  clientId: string;
  viewerLogin: string | null;
  label: string;
  createdAt: number;
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

type CreatePullRequestReviewCommentInput = RepoIdentity & {
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

type ReplyToPullRequestReviewCommentInput = RepoIdentity & {
  number: number;
  threadId: string;
  body: string;
};

type UpdatePullRequestReviewCommentInput = RepoIdentity & {
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

export type {
  AccountVisibilitySettings,
  AppearanceBackgroundInput,
  AppearanceBackgroundSettings,
  AvailableUpdate,
  CreatePullRequestReviewCommentInput,
  DiffDataMode,
  DiffDataSettings,
  ForgeProviderKind,
  OverviewPullRequestSummary,
  PrChangedFile,
  PrFileChangeType,
  PrFileContents,
  PrPatch,
  ProviderAccount,
  ProviderAuthStatus,
  ProviderAuthStatusKind,
  ProviderProfile,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoIdentity,
  RepoSummary,
  ReviewComment,
  ReviewEditorMode,
  ReviewEditorSettings,
  ReviewCommentSide,
  ReviewThread,
  SelectedPullRequest,
  ThemePreference,
  ThemePreferenceSettings,
  UpdateEvent,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
};
