import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { ProviderError, ValidationError } from "../errors";
import { parseRepoId } from "../repo-id";
import { providerFor } from "../providers/registry";
import type { PrPatch } from "../../shared/types";

type DiffDataServiceShape = {
  getPatch(repoId: string, number: number, headSha: string): Effect.Effect<PrPatch, Error, CacheService>;
  getChangedFiles(
    repoId: string,
    number: number,
    headSha: string,
  ): Effect.Effect<string[], Error, CacheService>;
};

class DiffDataService extends Effect.Tag("DiffDataService")<
  DiffDataService,
  DiffDataServiceShape
>() {
  static Live = Layer.succeed(this, createDiffDataService());
}

function createRequest(repoId: string, headSha: string) {
  const trimmedRepoId = repoId.trim();
  const trimmedHeadSha = headSha.trim();
  if (!trimmedRepoId) throw new ValidationError("Repo is required");
  if (!trimmedHeadSha) throw new ValidationError("Head SHA is required");
  return { repoId: trimmedRepoId, headSha: trimmedHeadSha };
}

function createDiffDataService(): DiffDataServiceShape {
  return {
    getPatch: (repoId, number, headSha) =>
      Effect.gen(function* () {
        const req = createRequest(repoId, headSha);
        const cache = yield* CacheService;
        const cached = yield* cache.getCachedPatch(req.repoId, number, req.headSha);
        if (cached !== null) {
          return { repoId: req.repoId, number, headSha: req.headSha, patch: cached };
        }

        const repo = parseRepoId(req.repoId);
        const patch = yield* providerFor(repo.provider).fetchPatch(repo, number);
        yield* cache.storePatch(req.repoId, number, req.headSha, patch);
        return { repoId: req.repoId, number, headSha: req.headSha, patch };
      }),

    getChangedFiles: (repoId, number, headSha) =>
      Effect.gen(function* () {
        const req = createRequest(repoId, headSha);
        const cache = yield* CacheService;
        const cached = yield* cache.getCachedChangedFiles(
          req.repoId,
          number,
          req.headSha,
        );
        if (cached !== null) return cached;

        const repo = parseRepoId(req.repoId);
        const files = yield* providerFor(repo.provider).fetchChangedFiles(repo, number);
        const unique = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
        yield* cache.storeChangedFiles(req.repoId, number, req.headSha, unique);
        return unique;
      }).pipe(
        Effect.mapError((error) =>
          error instanceof Error ? error : new ProviderError(String(error)),
        ),
      ),
  };
}

export { DiffDataService };
