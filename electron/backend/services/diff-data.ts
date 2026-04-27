import { HttpClient } from "@effect/platform";
import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { ProviderError, ValidationError } from "../errors";
import { parseRepoId } from "../repo-id";
import { providerFor } from "../providers/registry";
import { AuthTokenStore } from "../auth/token-store";
import type { PrPatch } from "../../shared/types";

type DiffDataServiceShape = {
  getPatch(
    repoId: string,
    number: number,
    headSha: string,
  ): Effect.Effect<PrPatch, Error>;
  getChangedFiles(
    repoId: string,
    number: number,
    headSha: string,
  ): Effect.Effect<string[], Error>;
};

class DiffDataService extends Effect.Tag("DiffDataService")<
  DiffDataService,
  DiffDataServiceShape
>() {}

function createRequest(repoId: string, headSha: string) {
  const trimmedRepoId = repoId.trim();
  const trimmedHeadSha = headSha.trim();
  if (!trimmedRepoId) throw new ValidationError("Repo is required");
  if (!trimmedHeadSha) throw new ValidationError("Head SHA is required");
  return { repoId: trimmedRepoId, headSha: trimmedHeadSha };
}

const makeDiffDataService = Effect.gen(function* () {
  const cache = yield* CacheService;
  const tokenStore = yield* AuthTokenStore;
  const httpClient = yield* HttpClient.HttpClient;

  const provideProviderDeps = <A, E>(
    effect: Effect.Effect<A, E, AuthTokenStore | HttpClient.HttpClient>,
  ) =>
    effect.pipe(
      Effect.provideService(AuthTokenStore, tokenStore),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );

  const getPatch: DiffDataServiceShape["getPatch"] = Effect.fn(
    "DiffDataService.getPatch",
  )(function* (repoId, number, headSha) {
    const req = createRequest(repoId, headSha);
    const cached = yield* cache.getCachedPatch(req.repoId, number, req.headSha);
    if (cached !== null) {
      return { repoId: req.repoId, number, headSha: req.headSha, patch: cached };
    }

    const repo = parseRepoId(req.repoId);
    const patch = yield* provideProviderDeps(
      providerFor(repo.provider).fetchPatch(repo, number),
    );
    yield* cache.storePatch(req.repoId, number, req.headSha, patch);
    return { repoId: req.repoId, number, headSha: req.headSha, patch };
  });

  const getChangedFiles: DiffDataServiceShape["getChangedFiles"] = Effect.fn(
    "DiffDataService.getChangedFiles",
  )(
    function* (repoId, number, headSha) {
      const req = createRequest(repoId, headSha);
      const cached = yield* cache.getCachedChangedFiles(
        req.repoId,
        number,
        req.headSha,
      );
      if (cached !== null) return cached;

      const repo = parseRepoId(req.repoId);
      const files = yield* provideProviderDeps(
        providerFor(repo.provider).fetchChangedFiles(repo, number),
      );
      const unique = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
      yield* cache.storeChangedFiles(req.repoId, number, req.headSha, unique);
      return unique;
    },
    Effect.mapError((error) =>
      error instanceof Error ? error : new ProviderError(String(error)),
    ),
  );

  return {
    getPatch,
    getChangedFiles,
  } satisfies DiffDataServiceShape;
});

const DiffDataServiceLive = Layer.effect(DiffDataService, makeDiffDataService);

export { DiffDataService, DiffDataServiceLive };
