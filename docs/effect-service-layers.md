# Effect Service Layers

This backend uses Effect services for forge, auth, diff, settings, and cache
domain logic. Service implementations should be constructed as layer effects
that acquire dependencies once, define named methods with `Effect.fn`, and
export a named live layer. Runtime-specific concerns, such as Electron paths and
safe-storage encryption, are injected by the host package.

## Service File Pattern

Use this shape for new services and when refactoring existing services:

```ts
import { Effect, Layer } from 'effect';

type ExampleServiceShape = {
  run(input: string): Effect.Effect<string, Error>;
};

class ExampleService extends Effect.Tag('ExampleService')<ExampleService, ExampleServiceShape>() {}

const makeExampleService = Effect.gen(function* () {
  const dependency = yield* DependencyService;

  const run: ExampleServiceShape['run'] = Effect.fn('ExampleService.run')(function* (input) {
    return yield* dependency.doWork(input);
  });

  return {
    run,
  } satisfies ExampleServiceShape;
});

const ExampleServiceLive = Layer.effect(ExampleService, makeExampleService);

export { ExampleService, ExampleServiceLive };
```

## Rules

- Keep the service tag class and the live layer as separate exports.
- Do not use `static Live` on service tags.
- Do not use `Layer.succeed(Service, createService())` for backend services.
- Name constructor effects `make<ServiceName>`, for example `makeRepoService`.
- Name live layers `<ServiceName>Live`, for example `RepoServiceLive`.
- Name method spans `<ServiceName>.<methodName>`, for example `RepoService.searchRepos`.
- Annotate methods with the shape type, for example `RepoServiceShape["searchRepos"]`.
- Return the implementation object with `satisfies <ServiceName>Shape`.
- Acquire service dependencies at the top of `make<ServiceName>`, not inside each method.
- Service method return types should not expose dependencies that the live layer captures.
- Keep tRPC procedures as thin adapters that yield the service tag and call methods.

## Provider Dependencies

Provider methods can require `AuthTokenStore` and `HttpClient.HttpClient`. Services
that call providers should capture those dependencies in the constructor and
provide them into provider effects:

```ts
import { HttpClient } from '@effect/platform';
import { Effect } from 'effect';
import { AuthTokenStore } from '../auth/token-store';

const makeExampleService = Effect.gen(function* () {
  const tokenStore = yield* AuthTokenStore;
  const httpClient = yield* HttpClient.HttpClient;

  const provideProviderDeps = <A, E>(
    effect: Effect.Effect<A, E, AuthTokenStore | HttpClient.HttpClient>,
  ) =>
    effect.pipe(
      Effect.provideService(AuthTokenStore, tokenStore),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );

  // Use provideProviderDeps(provider.call(...)) inside methods.
});
```

## Finalizers

If a service registers finalizers with `Effect.addFinalizer`, export it with
`Layer.scoped` instead of `Layer.effect`:

```ts
const makeCacheService = Effect.gen(function* () {
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      db?.close();
      db = null;
    }),
  );

  return service;
});

const CacheServiceLive = Layer.scoped(CacheService, makeCacheService);
```

Do not eagerly initialize resources only to register a finalizer. For example,
`CacheService` keeps SQLite initialization lazy and closes the database only if
it was opened.

## Runtime Layer Composition

`Layer.mergeAll` combines sibling layers. It does not provide one sibling's
output to another sibling's constructor. If a layer needs services produced by
another layer, use explicit binary `Layer.provideMerge(dependent, provider)`.

Use binary calls rather than pipe form for `provideMerge`; the dependency
direction is easier to read and less error-prone.

Current runtime stages inside `packages/backend/src/runtime.ts`:

```ts
const PlatformLayer = NodeCommandExecutor.layer.pipe(Layer.provideMerge(NodeFileSystem.layer));

const ConfigLayer = Layer.succeed(BackendConfig, config);

const BaseServiceLayer = Layer.mergeAll(
  AuthTokenStoreLive,
  CacheServiceLive,
  NodeHttpClient.layerUndici,
);

const BaseLayer = Layer.provideMerge(BaseServiceLayer, PlatformLayer);

const IndependentServiceLayer = Layer.mergeAll(
  RepoServiceLive,
  TrackedPullRequestServiceLive,
  ReviewCommentServiceLive,
  SettingsServiceLive,
  GitServiceLive,
);

const BaseAndIndependentServiceLayer = Layer.provideMerge(IndependentServiceLayer, BaseLayer);

const BaseAndServiceLayer = Layer.provideMerge(DiffDataServiceLive, BaseAndIndependentServiceLayer);

const AppLayer = Layer.provideMerge(PullRequestServiceLive, BaseAndServiceLayer);

return Layer.provideMerge(AppLayer, ConfigLayer);
```

Layer stages should reflect constructor dependencies:

- Platform services provide Node command execution and file-system services.
- Base services provide auth tokens, SQLite cache, and HTTP client.
- Independent services may depend on platform/base services, but not on each other.
- `DiffDataServiceLive` depends on base services plus `SettingsServiceLive` and `GitServiceLive`.
- `PullRequestServiceLive` depends on base services plus `DiffDataServiceLive`.
- `BackendConfig` supplies `databasePath`, `migrationsPath`, and `userDataPath`
  from the host package.

When adding a new service, place it in the earliest stage where all constructor
dependencies are already provided.
