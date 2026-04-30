import type { FileDiffMetadata } from '@pierre/diffs';

type ForgeProviderKind = 'github' | 'gitlab';

type DiffDataMode = 'provider-api' | 'git';

type DiffDataSettings = {
  mode: DiffDataMode;
};

type ThemePreference = 'auto' | 'light' | 'dark';

type ThemePreferenceSettings = {
  preference: ThemePreference;
};

type ReviewEditorMode = 'rich-text' | 'source';

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

type PullRequestSearchState = 'open' | 'draft_open' | 'all';

type TrackedPullRequestOrderEntry = RepoIdentity & {
  number: number;
};

export const PullRequestBadgeStatus = {
  Merged: 'merged',
  Closed: 'closed',
  Draft: 'draft',
  Conflicting: 'conflicting',
  CanMerge: 'can_merge',
  Open: 'open',
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

type PrFileChangeType = 'change' | 'rename-pure' | 'rename-changed' | 'new' | 'deleted';

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
  | { kind: 'default' }
  | { kind: 'solid'; color: string }
  | {
      kind: 'customFile';
      fileName: string;
      mimeType: string;
      dataUrl: string | null;
    };

type AppearanceBackgroundInput = { kind: 'default' } | { kind: 'solid'; color: string };

type ProviderProfile = {
  accountId: string;
  login: string;
};

type ProviderAuthStatusKind = 'ready' | 'not_authenticated' | 'unknown_error';

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

type ReviewCommentSide = 'LEFT' | 'RIGHT';

type PullRequestApprovalRemoveStrategy = 'dismiss' | 'unapprove';

type PullRequestApprovalActor = {
  login: string;
  name: string;
  avatarUrl: string | null;
  url: string | null;
  approvedAt: string | null;
};

type PullRequestApprovalState = {
  provider: ForgeProviderKind;
  approvedBy: PullRequestApprovalActor[];
  viewerApproved: boolean;
  viewerRemoveStrategy: PullRequestApprovalRemoveStrategy;
  approvalsRequired: number | null;
  approvalsLeft: number | null;
};

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
  canResolve?: boolean;
  isResolved: boolean;
  isOutdated: boolean;
  line: number | null;
  startLine: number | null;
  side: ReviewCommentSide | null;
  startSide: ReviewCommentSide | null;
  subjectType: 'file' | 'line' | 'global' | null;
  comments: ReviewComment[];
  isPending?: boolean;
  isOptimistic?: boolean;
};

type PendingReviewCommentKind = 'thread' | 'reply' | 'global';

type PendingReviewCommentSubjectType = 'file' | 'line' | 'global';
type PendingReviewSubmitAction = 'comment' | 'approve' | 'request_changes';

type PendingReviewSession = RepoIdentity & {
  id: number;
  number: number;
  headSha: string;
  providerReviewId: string | null;
  createdAt: number;
  updatedAt: number;
};

type PendingReviewComment = RepoIdentity & {
  id: string;
  sessionId: number;
  number: number;
  headSha: string;
  kind: PendingReviewCommentKind;
  providerCommentId: string | null;
  providerThreadId: string | null;
  replyToThreadId: string | null;
  replyToCommentId: number | null;
  body: string;
  path: string;
  oldPath: string;
  newPath: string;
  line: number | null;
  side: ReviewCommentSide | null;
  startLine: number | null;
  startSide: ReviewCommentSide | null;
  subjectType: PendingReviewCommentSubjectType;
  createdAt: number;
  updatedAt: number;
};

type PendingReviewState = {
  session: PendingReviewSession | null;
  comments: PendingReviewComment[];
};

type PullRequestQualityReportStatus = 'ok' | 'warning' | 'failed' | 'pending' | 'unavailable';

type PullRequestQualityFindingSeverity =
  | 'info'
  | 'minor'
  | 'warning'
  | 'major'
  | 'critical'
  | 'unknown';

type PullRequestQualityFindingStatus = 'new' | 'existing' | 'resolved' | 'unknown';

type PullRequestQualityFindingAnchorState = 'inline' | 'file' | 'unmapped';

type PullRequestQualityFindingSourceType = 'github-check' | 'gitlab-code-quality';

type PullRequestQualitySummary = {
  totalFindings: number;
  inlineFindings: number;
  fileOnlyFindings: number;
  statusCounts?: Record<string, number>;
  providerLabel: string;
  detailsUrl?: string;
  notes?: string[];
};

type PullRequestQualityFinding = {
  id: string;
  sourceType: PullRequestQualityFindingSourceType;
  sourceName: string;
  severity: PullRequestQualityFindingSeverity;
  status?: PullRequestQualityFindingStatus;
  title: string;
  message?: string;
  path: string;
  line: number | null;
  endLine?: number | null;
  anchorState: PullRequestQualityFindingAnchorState;
  externalUrl?: string;
  rawCategory?: string;
  fingerprint?: string;
};

type PullRequestQualityReport = {
  provider: ForgeProviderKind;
  repoKey: string;
  number: number;
  headSha: string | null;
  status: PullRequestQualityReportStatus;
  summary: PullRequestQualitySummary;
  findings: PullRequestQualityFinding[];
  fetchedAt: string;
  sourceMetadata?: Record<string, unknown>;
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
  subjectType: 'file' | 'line' | 'global';
};

type CreatePendingReviewThreadInput = RepoIdentity & {
  number: number;
  headSha: string;
  body: string;
  path: string;
  oldPath: string;
  newPath: string;
  line: number | null;
  side: ReviewCommentSide | null;
  startLine: number | null;
  startSide: ReviewCommentSide | null;
  subjectType: 'file' | 'line';
};

type CreatePendingReviewReplyInput = RepoIdentity & {
  number: number;
  headSha: string;
  threadId: string;
  body: string;
  path: string;
  line: number | null;
  side: ReviewCommentSide | null;
  startLine: number | null;
  startSide: ReviewCommentSide | null;
  subjectType: PendingReviewCommentSubjectType;
};

type CreatePendingReviewGlobalInput = RepoIdentity & {
  number: number;
  headSha: string;
  body: string;
};

type UpdatePendingReviewCommentInput = RepoIdentity & {
  number: number;
  headSha: string;
  pendingCommentId: string;
  body: string;
};

type DeletePendingReviewCommentInput = RepoIdentity & {
  number: number;
  headSha: string;
  pendingCommentId: string;
};

type PublishPendingReviewInput = RepoIdentity & {
  number: number;
  headSha: string;
  action?: PendingReviewSubmitAction;
  summary?: string;
};

type DiscardPendingReviewInput = RepoIdentity & {
  number: number;
  headSha: string;
};

type PullRequestSearchInput = {
  accountId: string;
  query: string;
  limit: number;
  states: PullRequestSearchState;
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
  subjectType: 'file' | 'line' | 'global';
};

type SetPullRequestReviewThreadResolvedInput = RepoIdentity & {
  number: number;
  threadId: string;
  isResolved: boolean;
};

type DeletePullRequestReviewCommentInput = RepoIdentity & {
  number: number;
  threadId: string;
  commentId: string;
  subjectType: 'file' | 'line' | 'global';
};

type AvailableUpdate = {
  version: string;
  body: string | null;
};

type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; update: AvailableUpdate }
  | { type: 'not_available' }
  | { type: 'progress'; downloaded: number; contentLength: number | null }
  | { type: 'downloaded'; update: AvailableUpdate }
  | { type: 'error'; message: string };

export type {
  AccountVisibilitySettings,
  AppearanceBackgroundInput,
  AppearanceBackgroundSettings,
  AvailableUpdate,
  CreatePendingReviewGlobalInput,
  CreatePendingReviewReplyInput,
  CreatePendingReviewThreadInput,
  CreatePullRequestReviewCommentInput,
  DeletePullRequestReviewCommentInput,
  DeletePendingReviewCommentInput,
  DiffDataMode,
  DiffDataSettings,
  DiscardPendingReviewInput,
  ForgeProviderKind,
  OverviewPullRequestSummary,
  PendingReviewComment,
  PendingReviewCommentKind,
  PendingReviewCommentSubjectType,
  PendingReviewSubmitAction,
  PendingReviewSession,
  PendingReviewState,
  PublishPendingReviewInput,
  PullRequestApprovalActor,
  PullRequestApprovalRemoveStrategy,
  PullRequestApprovalState,
  PrChangedFile,
  PrFileChangeType,
  PrFileContents,
  PrPatch,
  ProviderAccount,
  ProviderAuthStatus,
  ProviderAuthStatusKind,
  ProviderProfile,
  PullRequestSearchInput,
  PullRequestSearchState,
  PullRequestQualityFinding,
  PullRequestQualityFindingAnchorState,
  PullRequestQualityFindingSeverity,
  PullRequestQualityFindingSourceType,
  PullRequestQualityFindingStatus,
  PullRequestQualityReport,
  PullRequestQualityReportStatus,
  PullRequestQualitySummary,
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
  SetPullRequestReviewThreadResolvedInput,
  ThemePreference,
  ThemePreferenceSettings,
  TrackedPullRequestOrderEntry,
  UpdatePendingReviewCommentInput,
  UpdateEvent,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
};
