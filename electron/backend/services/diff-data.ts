import { HttpClient } from "@effect/platform";
import { Effect, Layer } from "effect";
import { CacheService } from "../cache";
import { ValidationError } from "../errors";
import { GitService } from "../git/service";
import { parseRepoId } from "../repo-id";
import { AuthTokenStore } from "../auth/token-store";
import { SettingsService } from "./settings";
import { makeGitDiffBackend } from "../diff-data/backends/git";
import { makeProviderApiDiffBackend } from "../diff-data/backends/provider-api";
import { parsePullRequestPatch } from "../diff-data/parse-patch";
import type {
  DiffDataMode,
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
  const settings = yield* SettingsService;
  const git = yield* GitService;

  const provideProviderDeps = <A, E>(
    effect: Effect.Effect<A, E, AuthTokenStore | HttpClient.HttpClient>,
  ) =>
    effect.pipe(
      Effect.provideService(AuthTokenStore, tokenStore),
      Effect.provideService(HttpClient.HttpClient, httpClient),
  );
  const providerApiBackend = makeProviderApiDiffBackend(provideProviderDeps);
  const gitBackend = makeGitDiffBackend(git, provideProviderDeps);
  const parsePatchResult = (input: {
    patch: string;
    repoId: string;
    number: number;
    headSha: string;
    mode: DiffDataMode;
  }) =>
    Effect.try({
      try: () => parsePullRequestPatch(input),
      catch: (error) =>
        error instanceof Error ? error : new Error("Failed to parse the PR patch."),
    });

  const getPatch: DiffDataServiceShape["getPatch"] = Effect.fn(
    "DiffDataService.getPatch",
  )(function* (repoId, number, headSha) {
    const req = createRequest(repoId, headSha);
    const mode = (yield* settings.getDiffDataSettings()).mode;
    const repo = parseRepoId(req.repoId);
    console.info(DIFF_DATA_LOG_PREFIX, "get patch", {
      mode,
      repoId: req.repoId,
      number,
      headSha: req.headSha,
    });

    if (mode === "provider-api") {
      const cached = yield* cache.getCachedPatch(req.repoId, number, req.headSha);
      if (cached !== null) {
        const fileDiffs = yield* parsePatchResult({
          patch: cached,
          repoId: req.repoId,
          number,
          headSha: req.headSha,
          mode,
        });
        return { repoId: req.repoId, number, headSha: req.headSha, fileDiffs };
      }

      const patch = yield* providerApiBackend.getPatch({
        repo,
        number,
        headSha: req.headSha,
        baseSha: null,
      });
      yield* cache.storePatch(req.repoId, number, req.headSha, patch);
      const fileDiffs = yield* parsePatchResult({
        patch,
        repoId: req.repoId,
        number,
        headSha: req.headSha,
        mode,
      });
      return { repoId: req.repoId, number, headSha: req.headSha, fileDiffs };
    }

    const patch = yield* gitBackend.getPatch(
      {
        repo,
        number,
        headSha: req.headSha,
        baseSha: null,
      },
    );
    const fileDiffs = yield* parsePatchResult({
      patch,
      repoId: req.repoId,
      number,
      headSha: req.headSha,
      mode,
    });
    return { repoId: req.repoId, number, headSha: req.headSha, fileDiffs };
  });

  const getChangedFiles: DiffDataServiceShape["getChangedFiles"] = Effect.fn(
    "DiffDataService.getChangedFiles",
  )(
    function* (repoId, number, headSha) {
      const req = createRequest(repoId, headSha);
      const mode = (yield* settings.getDiffDataSettings()).mode;
      const repo = parseRepoId(req.repoId);
      console.info(DIFF_DATA_LOG_PREFIX, "get changed files", {
        mode,
        repoId: req.repoId,
        number,
        headSha: req.headSha,
      });

      if (mode === "provider-api") {
        const cached = yield* cache.getCachedChangedFiles(
          req.repoId,
          number,
          req.headSha,
        );
        if (cached !== null) return cached;

        const files = yield* providerApiBackend.getChangedFiles({
          repo,
          number,
          headSha: req.headSha,
          baseSha: null,
        });
        const paths = files.map((file) => file.path);
        yield* cache.storeChangedFiles(req.repoId, number, req.headSha, paths);
        return paths;
      }

      const files = yield* gitBackend.getChangedFiles({
        repo,
        number,
        headSha: req.headSha,
        baseSha: null,
      });
      return files.map((file) => file.path);
    },
  );

  const getFileContents: DiffDataServiceShape["getFileContents"] = Effect.fn(
    "DiffDataService.getFileContents",
  )(
    function* (input) {
      const req = createRequest(input.repoId, input.headSha);
      const oldPath = input.oldPath.trim();
      const newPath = input.newPath.trim();
      const baseSha = input.baseSha?.trim() || null;
      const mode = (yield* settings.getDiffDataSettings()).mode;
      console.info(DIFF_DATA_LOG_PREFIX, "get file contents", {
        mode,
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
      const backendInput = {
        repo,
        number: input.number,
        oldPath,
        newPath,
        baseSha,
        headSha: req.headSha,
        changeType: input.changeType,
      };
      if (mode === "provider-api") {
        return yield* providerApiBackend.getFileContents(backendInput);
      }
      return yield* gitBackend.getFileContents(backendInput);
    },
  );

  return {
    getPatch,
    getChangedFiles,
    getFileContents,
  } satisfies DiffDataServiceShape;
});

const DiffDataServiceLive = Layer.effect(DiffDataService, makeDiffDataService);

export { DiffDataService, DiffDataServiceLive };
