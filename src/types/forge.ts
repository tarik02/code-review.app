import type { GitStatusEntry } from "@pierre/trees";
import { PullRequestBadgeStatus } from "../../electron/shared/types";
import type {
  AccountVisibilitySettings,
  CreatePullRequestReviewCommentInput,
  ForgeProviderKind,
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
  CreatePullRequestReviewCommentInput,
  FileStatsEntry,
  ForgeProviderKind,
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
