import { Layer, ManagedRuntime } from "effect";
import { CacheService } from "./cache";
import { DiffDataService } from "./services/diff-data";
import { PullRequestService } from "./services/pull-requests";
import { RepoService } from "./services/repos";
import { ReviewCommentService } from "./services/review-comments";
import { TrackedPullRequestService } from "./services/tracked-pull-requests";

const AppLayer = Layer.mergeAll(
  CacheService.Live,
  DiffDataService.Live,
  RepoService.Live,
  PullRequestService.Live,
  TrackedPullRequestService.Live,
  ReviewCommentService.Live,
);

const runtime = ManagedRuntime.make(AppLayer);

export { AppLayer, runtime };
