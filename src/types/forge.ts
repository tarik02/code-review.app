import type { GitStatusEntry } from "@pierre/trees";
import { PullRequestBadgeStatus } from "../../electron/shared/types";
import type {
  CreatePullRequestReviewCommentInput,
  ForgeProviderKind,
  PrPatch,
  ProviderAccount,
  ProviderAuthStatus,
  ProviderAuthStatusKind,
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
  CreatePullRequestReviewCommentInput,
  FileStatsEntry,
  ForgeProviderKind,
  PrPatch,
  ProviderAccount,
  ProviderAuthStatus,
  ProviderAuthStatusKind,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoSummary,
  ReviewCommentSide,
  SelectedPullRequest,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
};
