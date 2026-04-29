import {
  NodeCommandExecutor,
  NodeFileSystem,
  NodeHttpClient,
} from "@effect/platform-node";
import { Layer, ManagedRuntime } from "effect";
import { ElectronSafeStorageEncryption } from "./auth/encryption";
import { AuthTokenStoreLive } from "./auth/token-store";
import { CacheServiceLive } from "./cache";
import { DatabaseServiceLive } from "./db/client";
import { AppSettingsServiceLive } from "./services/app-settings";
import { DiffDataServiceLive } from "./services/diff-data";
import { GitServiceLive } from "./git/service";
import { PullRequestServiceLive } from "./services/pull-requests";
import { RepoServiceLive } from "./services/repos";
import { ReviewCommentServiceLive } from "./services/review-comments";
import { SettingsServiceLive } from "./services/settings";
import { TrackedPullRequestServiceLive } from "./services/tracked-pull-requests";

const PlatformLayer = Layer.provideMerge(
  NodeCommandExecutor.layer,
  NodeFileSystem.layer,
);

const DatabaseDependentLayer = Layer.provideMerge(
  Layer.mergeAll(AuthTokenStoreLive, CacheServiceLive, AppSettingsServiceLive),
  Layer.mergeAll(DatabaseServiceLive, ElectronSafeStorageEncryption),
);

const BaseServiceLayer = Layer.mergeAll(
  DatabaseDependentLayer,
  NodeHttpClient.layerUndici,
);

const BaseLayer = Layer.provideMerge(
  BaseServiceLayer,
  PlatformLayer,
);

const IndependentServiceLayer = Layer.mergeAll(
  RepoServiceLive,
  TrackedPullRequestServiceLive,
  ReviewCommentServiceLive,
  SettingsServiceLive,
  GitServiceLive,
);

const BaseAndIndependentServiceLayer = Layer.provideMerge(
  IndependentServiceLayer,
  BaseLayer,
);

const BaseAndServiceLayer = Layer.provideMerge(
  DiffDataServiceLive,
  BaseAndIndependentServiceLayer,
);

const AppLayer = Layer.provideMerge(
  PullRequestServiceLive,
  BaseAndServiceLayer,
);

const runtime = ManagedRuntime.make(AppLayer);

export { AppLayer, runtime };
