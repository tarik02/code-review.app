import { HttpClient } from "@effect/platform";
import { Effect } from "effect";
import { ProviderError, ValidationError } from "../../errors";
import type { GitServiceShape } from "../../git/service";
import {
  GitAuthenticationFailed,
  GitAuthorizationFailed,
  GitCommandFailed,
  GitCommandTimedOut,
  GitExecutableNotFound,
  GitPartialCloneUnsupported,
  GitPathNotFound,
  GitRefNotFound,
  GitRepositoryNotFound,
  GitUnknownCommandError,
  firstLine,
  type GitError,
} from "../../git/errors";
import { providerFor } from "../../providers/registry";
import { AuthTokenStore } from "../../auth/token-store";
import type { PrFileContents } from "../../../shared/types";
import type { GitRemoteSpec, PullRequestRefs } from "../../providers/types";
import type { RepoId } from "../../repo-id";
import type {
  DiffBackendFileContentsInput,
  DiffBackendInput,
  DiffDataBackend,
} from "./types";

type ProvideProviderDeps = <A, E>(
  effect: Effect.Effect<A, E, AuthTokenStore | HttpClient.HttpClient>,
) => Effect.Effect<A, E>;

type ResolvedRefs = {
  baseSha: string;
  headSha: string;
  source: "input" | "provider";
};

function gitErrorToProviderError(error: GitError) {
  if (error instanceof GitExecutableNotFound) {
    return new ProviderError("Git mode requires git to be installed and available on PATH.");
  }
  if (error instanceof GitAuthenticationFailed) {
    return new ProviderError(
      "Git authentication failed for this repository. Sign in again or switch diff loading to Provider API.",
    );
  }
  if (error instanceof GitAuthorizationFailed) {
    return new ProviderError("Your account cannot fetch this repository with git.");
  }
  if (error instanceof GitRepositoryNotFound) {
    return new ProviderError("Git could not find this repository.");
  }
  if (error instanceof GitRefNotFound) {
    return new ProviderError("Git could not fetch one of the PR refs.");
  }
  if (error instanceof GitPathNotFound) {
    return new ProviderError("Git could not find this file at the requested ref.");
  }
  if (error instanceof GitPartialCloneUnsupported) {
    return new ProviderError("This git server does not support blobless partial clone.");
  }
  if (error instanceof GitCommandTimedOut) {
    return new ProviderError("Git command timed out.");
  }
  if (error instanceof GitCommandFailed) {
    return new ProviderError(
      `Git command failed: ${firstLine(error.stderr) || "unknown git error"}`,
    );
  }
  if (error instanceof GitUnknownCommandError) {
    return new ProviderError("Git command failed unexpectedly.");
  }
  return new ProviderError("Git command failed unexpectedly.");
}

function logGitError(context: string, error: GitError) {
  console.debug("[diff-data]", context, {
    tag: error._tag,
    error:
      error instanceof GitUnknownCommandError
        ? { args: error.args }
        : error,
  });
}

function resolveRefs(
  repo: RepoId,
  number: number,
  baseSha: string | null,
  headSha: string,
  provideProviderDeps: ProvideProviderDeps,
): Effect.Effect<ResolvedRefs, Error> {
  return Effect.gen(function* () {
    const trimmedHeadSha = headSha.trim();
    if (!trimmedHeadSha) throw new ValidationError("Head SHA is required");
    const trimmedBaseSha = baseSha?.trim() || null;
    if (trimmedBaseSha) {
      return {
        baseSha: trimmedBaseSha,
        headSha: trimmedHeadSha,
        source: "input",
      } satisfies ResolvedRefs;
    }

    console.info("[diff-data] git base sha missing; fetching refs", {
      repoId: repo.key,
      number,
      provider: repo.provider,
    });
    const refs: PullRequestRefs = yield* provideProviderDeps(
      providerFor(repo.provider).fetchPullRequestRefs(repo, number),
    );
    if (!refs.baseSha) {
      throw new ValidationError("Base SHA is required");
    }
    return {
      baseSha: refs.baseSha,
      headSha: trimmedHeadSha || refs.headSha || "",
      source: "provider",
    } satisfies ResolvedRefs;
  });
}

function prepareGitDiff(
  input: DiffBackendInput | DiffBackendFileContentsInput,
  git: GitServiceShape,
  provideProviderDeps: ProvideProviderDeps,
): Effect.Effect<
  { remoteSpec: GitRemoteSpec; diffBaseSha: string; headSha: string; cachePath: string },
  Error
> {
  return Effect.gen(function* () {
    const refs = yield* resolveRefs(
      input.repo,
      input.number,
      input.baseSha,
      input.headSha,
      provideProviderDeps,
    );
    console.info("[diff-data] git refs resolved", {
      repoId: input.repo.key,
      number: input.number,
      source: refs.source,
      baseSha: refs.baseSha,
      headSha: refs.headSha,
    });

    const remoteSpec = yield* provideProviderDeps(
      providerFor(input.repo.provider).gitRemote(input.repo),
    );
    const handle = yield* git.ensureRepo(input.repo, remoteSpec).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => logGitError("git ensure repo failed", error)),
      ),
      Effect.mapError(gitErrorToProviderError),
    );

    yield* git.fetchRefs(handle, refs.baseSha, refs.headSha, remoteSpec).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => logGitError("git fetch refs failed", error)),
      ),
      Effect.mapError(gitErrorToProviderError),
    );
    const diffBaseSha = yield* git.mergeBase(
      handle,
      refs.baseSha,
      refs.headSha,
      remoteSpec,
    ).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => logGitError("git merge-base failed", error)),
      ),
      Effect.mapError(gitErrorToProviderError),
    );

    return {
      remoteSpec,
      diffBaseSha,
      headSha: refs.headSha,
      cachePath: handle.path,
    };
  });
}

function makeGitDiffBackend(
  git: GitServiceShape,
  provideProviderDeps: ProvideProviderDeps,
): DiffDataBackend {
  const getPatch: DiffDataBackend["getPatch"] = Effect.fn(
    "GitDiffBackend.getPatch",
  )(function* (input, options) {
    const prepared = yield* prepareGitDiff(input, git, provideProviderDeps);
    const handle = { repo: input.repo, path: prepared.cachePath };
    const patch = yield* git.diffPatch(
      handle,
      prepared.diffBaseSha,
      prepared.headSha,
      prepared.remoteSpec,
      options?.contextLines,
    ).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => logGitError("git diff patch failed", error)),
      ),
      Effect.mapError(gitErrorToProviderError),
    );
    console.info("[diff-data] git patch generated", {
      repoId: input.repo.key,
      number: input.number,
      headSha: prepared.headSha,
      cachePath: prepared.cachePath,
      length: patch.length,
    });
    return patch;
  });

  const getChangedFiles: DiffDataBackend["getChangedFiles"] = Effect.fn(
    "GitDiffBackend.getChangedFiles",
  )(function* (input) {
    const prepared = yield* prepareGitDiff(input, git, provideProviderDeps);
    const handle = { repo: input.repo, path: prepared.cachePath };
    const files = yield* git.diffNameStatus(
      handle,
      prepared.diffBaseSha,
      prepared.headSha,
      prepared.remoteSpec,
    ).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => logGitError("git changed files failed", error)),
      ),
      Effect.mapError(gitErrorToProviderError),
    );
    console.info("[diff-data] git changed files generated", {
      repoId: input.repo.key,
      number: input.number,
      headSha: prepared.headSha,
      cachePath: prepared.cachePath,
      count: files.length,
    });
    return files;
  });

  const getFileContents: DiffDataBackend["getFileContents"] = Effect.fn(
    "GitDiffBackend.getFileContents",
  )(function* (input) {
    const oldPath = input.oldPath.trim();
    const newPath = input.newPath.trim();

    if (!oldPath && input.changeType !== "new") {
      throw new ValidationError("Old file path is required");
    }
    if (!newPath && input.changeType !== "deleted") {
      throw new ValidationError("New file path is required");
    }

    const prepared = yield* prepareGitDiff(input, git, provideProviderDeps);
    const handle = { repo: input.repo, path: prepared.cachePath };
    let oldContent = "";
    let newContent = "";

    if (input.changeType !== "new") {
      oldContent = yield* git.showFile(
        handle,
        prepared.diffBaseSha,
        oldPath,
        prepared.remoteSpec,
      ).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => logGitError("git show old file failed", error)),
        ),
        Effect.mapError(gitErrorToProviderError),
      );
    }

    if (input.changeType !== "deleted") {
      newContent = yield* git.showFile(
        handle,
        prepared.headSha,
        newPath,
        prepared.remoteSpec,
      ).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => logGitError("git show new file failed", error)),
        ),
        Effect.mapError(gitErrorToProviderError),
      );
    }

    console.info("[diff-data] git file contents generated", {
      repoId: input.repo.key,
      number: input.number,
      oldPath,
      newPath,
      baseSha: prepared.diffBaseSha,
      headSha: prepared.headSha,
      cachePath: prepared.cachePath,
      oldLength: oldContent.length,
      newLength: newContent.length,
    });

    return {
      repoId: input.repo.key,
      oldPath,
      newPath,
      baseSha: prepared.diffBaseSha,
      headSha: prepared.headSha,
      oldContent,
      newContent,
    } satisfies PrFileContents;
  });

  return {
    getPatch,
    getChangedFiles,
    getFileContents,
  };
}

export { makeGitDiffBackend };
