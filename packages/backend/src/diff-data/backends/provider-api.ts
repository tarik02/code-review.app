import { HttpClient } from "@effect/platform";
import { Effect } from "effect";
import { ProviderError, ValidationError } from "../../errors.ts";
import { providerFor } from "../../providers/registry.ts";
import { AuthTokenStore } from "../../auth/token-store.ts";
import { repoIdentityCacheKey } from "../../repo-id.ts";
import type { PrChangedFile, PrFileContents } from "@code-review-app/shared";
import type { DiffDataBackend } from "./types.ts";

type ProvideProviderDeps = <A, E>(
  effect: Effect.Effect<A, E, AuthTokenStore | HttpClient.HttpClient>,
) => Effect.Effect<A, E>;

function makeProviderApiDiffBackend(provideProviderDeps: ProvideProviderDeps): DiffDataBackend {
  const getPatch: DiffDataBackend["getPatch"] = Effect.fn("ProviderApiDiffBackend.getPatch")(
    function* (input, _options) {
      return yield* provideProviderDeps(
        providerFor(input.repo.provider).fetchPatch(input.repo, input.number),
      );
    },
  );

  const getChangedFiles: DiffDataBackend["getChangedFiles"] = Effect.fn(
    "ProviderApiDiffBackend.getChangedFiles",
  )(
    function* (input) {
      const files = yield* provideProviderDeps(
        providerFor(input.repo.provider).fetchChangedFiles(input.repo, input.number),
      );
      const seen = new Set<string>();
      const unique: PrChangedFile[] = [];
      for (const file of files) {
        const path = file.path.trim();
        if (!path || seen.has(path)) {
          continue;
        }
        seen.add(path);
        unique.push({ ...file, path });
      }
      return unique;
    },
    Effect.mapError((error) => (error instanceof Error ? error : new ProviderError(String(error)))),
  );

  const getFileContents: DiffDataBackend["getFileContents"] = Effect.fn(
    "ProviderApiDiffBackend.getFileContents",
  )(
    function* (input) {
      const oldPath = input.oldPath.trim();
      const newPath = input.newPath.trim();
      let baseSha = input.baseSha?.trim() || null;
      const provider = providerFor(input.repo.provider);

      if (!oldPath && input.changeType !== "new") {
        throw new ValidationError("Old file path is required");
      }
      if (!newPath && input.changeType !== "deleted") {
        throw new ValidationError("New file path is required");
      }

      if (!baseSha && input.changeType !== "new") {
        console.info("[diff-data] provider api base sha missing; fetching refs", {
          repo: repoIdentityCacheKey(input.repo),
          number: input.number,
          provider: input.repo.provider,
        });
        const refs = yield* provideProviderDeps(
          provider.fetchPullRequestRefs(input.repo, input.number),
        );
        baseSha = refs.baseSha;
        console.info("[diff-data] provider api resolved refs", {
          repo: repoIdentityCacheKey(input.repo),
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
        oldContent = yield* provideProviderDeps(
          provider.fetchFileContent(input.repo, oldPath, baseSha ?? ""),
        );
      }

      if (input.changeType !== "deleted") {
        newContent = yield* provideProviderDeps(
          provider.fetchFileContent(input.repo, newPath, input.headSha),
        );
      }

      return {
        providerId: input.repo.providerId,
        repoKey: input.repo.repoKey,
        oldPath,
        newPath,
        baseSha,
        headSha: input.headSha,
        oldContent,
        newContent,
      } satisfies PrFileContents;
    },
    Effect.mapError((error) => (error instanceof Error ? error : new ProviderError(String(error)))),
  );

  return {
    getPatch,
    getChangedFiles,
    getFileContents,
  };
}

export { makeProviderApiDiffBackend };
