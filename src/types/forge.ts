import type { GitStatusEntry } from "@pierre/trees";
import { PullRequestBadgeStatus } from "../../electron/shared/types";
import type {
  CliStatus,
  CliStatusKind,
  CreatePullRequestReviewCommentInput,
  ForgeProviderKind,
  PrPatch,
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
  CliStatus,
  CliStatusKind,
  CreatePullRequestReviewCommentInput,
  FileStatsEntry,
  ForgeProviderKind,
  PrPatch,
  PullRequestSummary,
  ReplyToPullRequestReviewCommentInput,
  RepoSummary,
  ReviewCommentSide,
  SelectedPullRequest,
  UpdatePullRequestReviewCommentInput,
  ViewerLogin,
};
