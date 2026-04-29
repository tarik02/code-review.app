import { NodeCommandExecutor, NodeFileSystem, NodeHttpClient } from '@effect/platform-node';
import { Layer, ManagedRuntime } from 'effect';
import { EncryptionService } from './auth/encryption.ts';
import { AuthTokenStoreLive } from './auth/token-store.ts';
import { CacheServiceLive } from './cache.ts';
import { BackendConfig, type BackendRuntimeConfig } from './config.ts';
import { DatabaseServiceLive } from './db/client.ts';
import { AppSettingsServiceLive } from './services/app-settings.ts';
import { DiffDataServiceLive } from './services/diff-data.ts';
import { GitServiceLive } from './git/service.ts';
import { PullRequestServiceLive } from './services/pull-requests.ts';
import { PullRequestQualityServiceLive } from './services/pull-request-quality.ts';
import { RepoServiceLive } from './services/repos.ts';
import { ReviewCommentServiceLive } from './services/review-comments.ts';
import { SettingsServiceLive } from './services/settings.ts';
import { TrackedPullRequestServiceLive } from './services/tracked-pull-requests.ts';

type BackendRuntimeOptions = BackendRuntimeConfig & {
  encryptionLayer: Layer.Layer<EncryptionService>;
};

const PlatformLayer = Layer.provideMerge(NodeCommandExecutor.layer, NodeFileSystem.layer);

function createAppLayer(options: BackendRuntimeOptions) {
  const ConfigLayer = Layer.succeed(BackendConfig, {
    databasePath: options.databasePath,
    migrationsPath: options.migrationsPath,
    userDataPath: options.userDataPath,
  });

  const DatabaseDependentLayer = Layer.provideMerge(
    Layer.mergeAll(AuthTokenStoreLive, CacheServiceLive, AppSettingsServiceLive),
    Layer.mergeAll(DatabaseServiceLive, options.encryptionLayer),
  );

  const BaseServiceLayer = Layer.mergeAll(DatabaseDependentLayer, NodeHttpClient.layerUndici);

  const BaseLayer = Layer.provideMerge(BaseServiceLayer, PlatformLayer);

  const IndependentServiceLayer = Layer.mergeAll(
    RepoServiceLive,
    TrackedPullRequestServiceLive,
    ReviewCommentServiceLive,
    SettingsServiceLive,
    GitServiceLive,
  );

  const BaseAndIndependentServiceLayer = Layer.provideMerge(IndependentServiceLayer, BaseLayer);

  const BaseAndServiceLayer = Layer.provideMerge(
    DiffDataServiceLive,
    BaseAndIndependentServiceLayer,
  );

  const AppLayer = Layer.provideMerge(
    Layer.mergeAll(PullRequestServiceLive, PullRequestQualityServiceLive),
    BaseAndServiceLayer,
  );

  return Layer.provideMerge(AppLayer, ConfigLayer);
}

function createBackendRuntime(options: BackendRuntimeOptions) {
  return ManagedRuntime.make(createAppLayer(options));
}

type BackendRuntime = ReturnType<typeof createBackendRuntime>;

export { createAppLayer, createBackendRuntime };
export type { BackendRuntime, BackendRuntimeConfig, BackendRuntimeOptions };
