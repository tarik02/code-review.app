import { NodeHttpClient } from "@effect/platform-node";
import { Layer, ManagedRuntime } from "effect";
import { AuthTokenStoreLive } from "./auth/token-store";
import { CacheServiceLive } from "./cache";
import { DiffDataServiceLive } from "./services/diff-data";
import { PullRequestServiceLive } from "./services/pull-requests";
import { RepoServiceLive } from "./services/repos";
import { ReviewCommentServiceLive } from "./services/review-comments";
import { SettingsServiceLive } from "./services/settings";
import { TrackedPullRequestServiceLive } from "./services/tracked-pull-requests";

const BaseLayer = Layer.mergeAll(
  AuthTokenStoreLive,
  CacheServiceLive,
  NodeHttpClient.layerUndici,
);

const ServiceLayer = Layer.mergeAll(
  DiffDataServiceLive,
  RepoServiceLive,
  TrackedPullRequestServiceLive,
  ReviewCommentServiceLive,
  SettingsServiceLive,
);

const BaseAndServiceLayer = Layer.provideMerge(ServiceLayer, BaseLayer);

const AppLayer = Layer.provideMerge(
  PullRequestServiceLive,
  BaseAndServiceLayer,
);

const runtime = ManagedRuntime.make(AppLayer);

export { AppLayer, runtime };
