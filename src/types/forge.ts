import type { GitStatusEntry } from "@pierre/trees";
import { PullRequestBadgeStatus } from "../../electron/shared/types";
import type {
  AccountVisibilitySettings,
  AppearanceBackgroundInput,
  AppearanceBackgroundSettings,
  CreatePullRequestReviewCommentInput,
  DiffDataMode,
  DiffDataSettings,
  ForgeProviderKind,
  OverviewPullRequestSummary,
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
  ReviewCommentSide,
  ReviewEditorMode,
  ReviewEditorSettings,
  SelectedPullRequest,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
} from "../../electron/shared/types";

type FileStatsEntry = {
  additions: number;
  deletions: number;
  status: GitStatusEntry["status"];
};

export { PullRequestBadgeStatus };
export type {
  AccountVisibilitySettings,
  AppearanceBackgroundInput,
  AppearanceBackgroundSettings,
  CreatePullRequestReviewCommentInput,
  DiffDataMode,
  DiffDataSettings,
  FileStatsEntry,
  ForgeProviderKind,
  OverviewPullRequestSummary,
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
  ReviewCommentSide,
  ReviewEditorMode,
  ReviewEditorSettings,
  SelectedPullRequest,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
};
