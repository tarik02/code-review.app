import { HttpClient } from "@effect/platform";
import { Effect, Layer } from "effect";
import { CacheService } from "../cache.ts";
import { ValidationError } from "../errors.ts";
import { GitService } from "../git/service.ts";
import { createRepoIdentityFromParts, repoIdentityCacheKey } from "../repo-id.ts";
import { AuthTokenStore } from "../auth/token-store.ts";
import { SettingsService } from "./settings.ts";
import { makeGitDiffBackend } from "../diff-data/backends/git.ts";
import { makeProviderApiDiffBackend } from "../diff-data/backends/provider-api.ts";
import { parsePullRequestPatch } from "../diff-data/parse-patch.ts";
import type {
  DiffDataMode,
  PrFileChangeType,
  PrFileContents,
  PrPatch,
  RepoIdentity,
} from "@rudu/shared";

const DIFF_DATA_LOG_PREFIX = "[diff-data]";

type DiffDataServiceShape = {
  getPatch(
    repo: RepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<PrPatch, Error>;
  getChangedFiles(
    repo: RepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<string[], Error>;
  getFileContents(input: {
    providerId: string;
    repoKey: string;
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

function createRequest(repo: RepoIdentity, headSha: string) {
  const trimmedHeadSha = headSha.trim();
  if (!repo.providerId.trim() || !repo.repoKey.trim()) {
    throw new ValidationError("Repo is required");
  }
  if (!trimmedHeadSha) throw new ValidationError("Head SHA is required");
  return { repo, headSha: trimmedHeadSha };
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
    providerId: string;
    repoKey: string;
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
  )(function* (repoInput, number, headSha) {
    const req = createRequest(repoInput, headSha);
    const mode = (yield* settings.getDiffDataSettings()).mode;
    const repo = createRepoIdentityFromParts(req.repo.providerId, req.repo.repoKey);
    console.info(DIFF_DATA_LOG_PREFIX, "get patch", {
      mode,
      repo: repoIdentityCacheKey(repo),
      number,
      headSha: req.headSha,
    });

    if (mode === "provider-api") {
      const cached = yield* cache.getCachedPatch(req.repo, number, req.headSha);
      if (cached !== null) {
        const fileDiffs = yield* parsePatchResult({
          patch: cached,
          providerId: req.repo.providerId,
          repoKey: req.repo.repoKey,
          number,
          headSha: req.headSha,
          mode,
        });
        return { ...req.repo, number, headSha: req.headSha, fileDiffs };
      }

      const patch = yield* providerApiBackend.getPatch({
        repo,
        number,
        headSha: req.headSha,
        baseSha: null,
      });
      yield* cache.storePatch(req.repo, number, req.headSha, patch);
      const fileDiffs = yield* parsePatchResult({
        patch,
        providerId: req.repo.providerId,
        repoKey: req.repo.repoKey,
        number,
        headSha: req.headSha,
        mode,
      });
      return { ...req.repo, number, headSha: req.headSha, fileDiffs };
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
      providerId: req.repo.providerId,
      repoKey: req.repo.repoKey,
      number,
      headSha: req.headSha,
      mode,
    });
    return { ...req.repo, number, headSha: req.headSha, fileDiffs };
  });

  const getChangedFiles: DiffDataServiceShape["getChangedFiles"] = Effect.fn(
    "DiffDataService.getChangedFiles",
  )(
    function* (repoInput, number, headSha) {
      const req = createRequest(repoInput, headSha);
      const mode = (yield* settings.getDiffDataSettings()).mode;
      const repo = createRepoIdentityFromParts(req.repo.providerId, req.repo.repoKey);
      console.info(DIFF_DATA_LOG_PREFIX, "get changed files", {
        mode,
        repo: repoIdentityCacheKey(repo),
        number,
        headSha: req.headSha,
      });

      if (mode === "provider-api") {
        const cached = yield* cache.getCachedChangedFiles(
          req.repo,
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
        yield* cache.storeChangedFiles(req.repo, number, req.headSha, paths);
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
      const req = createRequest(input, input.headSha);
      const oldPath = input.oldPath.trim();
      const newPath = input.newPath.trim();
      const baseSha = input.baseSha?.trim() || null;
      const mode = (yield* settings.getDiffDataSettings()).mode;
      console.info(DIFF_DATA_LOG_PREFIX, "get file contents", {
        mode,
        repo: repoIdentityCacheKey(req.repo),
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
      const repo = createRepoIdentityFromParts(req.repo.providerId, req.repo.repoKey);
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
