import { HttpClient } from "@effect/platform";
import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { ProviderError, ValidationError } from "../errors";
import { parseRepoId } from "../repo-id";
import { providerFor } from "../providers/registry";
import { AuthTokenStore } from "../auth/token-store";
import type {
  PrFileChangeType,
  PrFileContents,
  PrPatch,
} from "../../shared/types";

const DIFF_DATA_LOG_PREFIX = "[diff-data]";

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
  getFileContents(input: {
    repoId: string;
    number: number;
    oldPath: string;
    newPath: string;
    baseSha: string | null;
    headSha: string;
    changeType: PrFileChangeType;
  }): Effect.Effect<PrFileContents, Error>;
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

  const getFileContents: DiffDataServiceShape["getFileContents"] = Effect.fn(
    "DiffDataService.getFileContents",
  )(
    function* (input) {
      const req = createRequest(input.repoId, input.headSha);
      const oldPath = input.oldPath.trim();
      const newPath = input.newPath.trim();
      let baseSha = input.baseSha?.trim() || null;
      console.info(DIFF_DATA_LOG_PREFIX, "get file contents", {
        repoId: req.repoId,
        number: input.number,
        oldPath,
        newPath,
        baseSha,
        headSha: req.headSha,
        changeType: input.changeType,
      });

      if (!oldPath && input.changeType !== "new") {
        throw new ValidationError("Old file path is required");
      }
      if (!newPath && input.changeType !== "deleted") {
        throw new ValidationError("New file path is required");
      }
      const repo = parseRepoId(req.repoId);
      const provider = providerFor(repo.provider);
      if (!baseSha && input.changeType !== "new") {
        console.info(DIFF_DATA_LOG_PREFIX, "base sha missing; fetching refs", {
          repoId: req.repoId,
          number: input.number,
          provider: repo.provider,
        });
        const refs = yield* provideProviderDeps(
          provider.fetchPullRequestRefs(repo, input.number),
        );
        baseSha = refs.baseSha;
        console.info(DIFF_DATA_LOG_PREFIX, "resolved refs", {
          repoId: req.repoId,
          number: input.number,
          baseSha,
          headSha: refs.headSha,
        });
      }
      if (!baseSha && input.changeType !== "new") {
        throw new ValidationError("Base SHA is required");
      }
      let oldContent = "";
      let newContent = "";

      if (input.changeType !== "new") {
        console.info(DIFF_DATA_LOG_PREFIX, "fetch old file content", {
          repoId: req.repoId,
          number: input.number,
          path: oldPath,
          ref: baseSha,
        });
        oldContent = yield* provideProviderDeps(
          provider.fetchFileContent(repo, oldPath, baseSha ?? ""),
        );
        console.info(DIFF_DATA_LOG_PREFIX, "fetched old file content", {
          repoId: req.repoId,
          number: input.number,
          path: oldPath,
          length: oldContent.length,
        });
      }

      if (input.changeType !== "deleted") {
        console.info(DIFF_DATA_LOG_PREFIX, "fetch new file content", {
          repoId: req.repoId,
          number: input.number,
          path: newPath,
          ref: req.headSha,
        });
        newContent = yield* provideProviderDeps(
          provider.fetchFileContent(repo, newPath, req.headSha),
        );
        console.info(DIFF_DATA_LOG_PREFIX, "fetched new file content", {
          repoId: req.repoId,
          number: input.number,
          path: newPath,
          length: newContent.length,
        });
      }

      return {
        repoId: req.repoId,
        oldPath,
        newPath,
        baseSha,
        headSha: req.headSha,
        oldContent,
        newContent,
      };
    },
    Effect.mapError((error) =>
      error instanceof Error ? error : new ProviderError(String(error)),
    ),
  );

  return {
    getPatch,
    getChangedFiles,
    getFileContents,
  } satisfies DiffDataServiceShape;
});

const DiffDataServiceLive = Layer.effect(DiffDataService, makeDiffDataService);

export { DiffDataService, DiffDataServiceLive };
