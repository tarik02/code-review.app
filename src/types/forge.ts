import type { GitStatusEntry } from "@pierre/trees";
import { PullRequestBadgeStatus } from "../../electron/shared/types";
import type {
  AccountVisibilitySettings,
  AppearanceBackgroundInput,
  AppearanceBackgroundSettings,
  CreatePullRequestReviewCommentInput,
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
  RepoSummary,
  ReviewCommentSide,
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
  RepoSummary,
  ReviewCommentSide,
  SelectedPullRequest,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
};
