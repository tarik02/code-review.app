import { Effect } from 'effect';
import { ProviderError, ValidationError } from '../../errors.ts';
import type { GitServiceShape } from '../../git/service.ts';
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
} from '../../git/errors.ts';
import type {
  AccountScopedForgeProvider,
  ForgeProviderRegistryShape,
} from '../../providers/registry.ts';
import type { PrFileContents } from '@code-review-app/shared';
import type { GitRemoteSpec, PullRequestRefs } from '../../providers/types.ts';
import { repoIdentityCacheKey, type ProviderRepoIdentity } from '../../repo-id.ts';
import type { DiffBackendFileContentsInput, DiffBackendInput, DiffDataBackend } from './types.ts';

type ResolvedRefs = {
  baseSha: string;
  headSha: string;
  source: 'input' | 'provider';
};

function gitErrorToProviderError(error: GitError) {
  if (error instanceof GitExecutableNotFound) {
    return new ProviderError('Git mode requires git to be installed and available on PATH.', {
      cause: error,
    });
  }
  if (error instanceof GitAuthenticationFailed) {
    return new ProviderError(
      'Git authentication failed for this repository. Sign in again or switch diff loading to Provider API.',
      { cause: error },
    );
  }
  if (error instanceof GitAuthorizationFailed) {
    return new ProviderError('Your account cannot fetch this repository with git.', {
      cause: error,
    });
  }
  if (error instanceof GitRepositoryNotFound) {
    return new ProviderError('Git could not find this repository.', { cause: error });
  }
  if (error instanceof GitRefNotFound) {
    return new ProviderError('Git could not fetch one of the PR refs.', { cause: error });
  }
  if (error instanceof GitPathNotFound) {
    return new ProviderError('Git could not find this file at the requested ref.', {
      cause: error,
    });
  }
  if (error instanceof GitPartialCloneUnsupported) {
    return new ProviderError('This git server does not support blobless partial clone.', {
      cause: error,
    });
  }
  if (error instanceof GitCommandTimedOut) {
    return new ProviderError('Git command timed out.', { cause: error });
  }
  if (error instanceof GitCommandFailed) {
    return new ProviderError(
      `Git command failed: ${firstLine(error.stderr) || 'unknown git error'}`,
      { cause: error },
    );
  }
  if (error instanceof GitUnknownCommandError) {
    return new ProviderError('Git command failed unexpectedly.', { cause: error });
  }
  return new ProviderError('Git command failed unexpectedly.', { cause: error });
}

function logGitError(context: string, error: GitError) {
  return Effect.logDebug('[diff-data] git backend error', {
    context,
    tag: error._tag,
    error: error instanceof GitUnknownCommandError ? { args: error.args } : error,
  });
}

function resolveRefs(
  repo: ProviderRepoIdentity,
  number: number,
  baseSha: string | null,
  headSha: string,
  provider: AccountScopedForgeProvider,
): Effect.Effect<ResolvedRefs, Error> {
  return Effect.gen(function* () {
    const trimmedHeadSha = headSha.trim();
    if (!trimmedHeadSha) throw new ValidationError('Head SHA is required');
    const trimmedBaseSha = baseSha?.trim() || null;
    if (trimmedBaseSha) {
      return {
        baseSha: trimmedBaseSha,
        headSha: trimmedHeadSha,
        source: 'input',
      } satisfies ResolvedRefs;
    }

    yield* Effect.logInfo('[diff-data] git base sha missing; fetching refs', {
      repo: repoIdentityCacheKey(repo),
      number,
      provider: repo.provider,
    });
    const refs: PullRequestRefs = yield* provider.fetchPullRequestRefs(repo, number);
    if (!refs.baseSha) {
      throw new ValidationError('Base SHA is required');
    }
    return {
      baseSha: refs.baseSha,
      headSha: trimmedHeadSha || refs.headSha || '',
      source: 'provider',
    } satisfies ResolvedRefs;
  });
}

function prepareGitDiff(
  input: DiffBackendInput | DiffBackendFileContentsInput,
  git: GitServiceShape,
  providers: ForgeProviderRegistryShape,
): Effect.Effect<
  { remoteSpec: GitRemoteSpec; diffBaseSha: string; headSha: string; cachePath: string },
  Error
> {
  return Effect.gen(function* () {
    const { provider, repo } = yield* providers.forRepo(input.repo);
    const refs = yield* resolveRefs(
      repo,
      input.number,
      input.baseSha,
      input.headSha,
      provider,
    );
    yield* Effect.logInfo('[diff-data] git refs resolved', {
      repo: repoIdentityCacheKey(input.repo),
      number: input.number,
      source: refs.source,
      baseSha: refs.baseSha,
      headSha: refs.headSha,
    });

    const remoteSpec = yield* provider.gitRemote(repo);
    const handle = yield* git.ensureRepo(input.repo, remoteSpec).pipe(
      Effect.tapError((error) => logGitError('git ensure repo failed', error)),
      Effect.mapError(gitErrorToProviderError),
    );

    yield* git.fetchRefs(handle, refs.baseSha, refs.headSha, remoteSpec).pipe(
      Effect.tapError((error) => logGitError('git fetch refs failed', error)),
      Effect.mapError(gitErrorToProviderError),
    );
    const diffBaseSha = yield* git.mergeBase(handle, refs.baseSha, refs.headSha, remoteSpec).pipe(
      Effect.tapError((error) => logGitError('git merge-base failed', error)),
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

function makeGitDiffBackend(git: GitServiceShape, providers: ForgeProviderRegistryShape): DiffDataBackend {
  const getPatch: DiffDataBackend['getPatch'] = Effect.fn('GitDiffBackend.getPatch')(
    function* (input, options) {
      const prepared = yield* prepareGitDiff(input, git, providers);
      const handle = { repo: input.repo, path: prepared.cachePath };
      const patch = yield* git
        .diffPatch(
          handle,
          prepared.diffBaseSha,
          prepared.headSha,
          prepared.remoteSpec,
          options?.contextLines,
        )
        .pipe(
          Effect.tapError((error) => logGitError('git diff patch failed', error)),
          Effect.mapError(gitErrorToProviderError),
        );
      yield* Effect.logInfo('[diff-data] git patch generated', {
        repo: repoIdentityCacheKey(input.repo),
        number: input.number,
        headSha: prepared.headSha,
        cachePath: prepared.cachePath,
        length: patch.length,
      });
      return patch;
    },
  );

  const getChangedFiles: DiffDataBackend['getChangedFiles'] = Effect.fn(
    'GitDiffBackend.getChangedFiles',
  )(function* (input) {
    const prepared = yield* prepareGitDiff(input, git, providers);
    const handle = { repo: input.repo, path: prepared.cachePath };
    const files = yield* git
      .diffNameStatus(handle, prepared.diffBaseSha, prepared.headSha, prepared.remoteSpec)
      .pipe(
        Effect.tapError((error) => logGitError('git changed files failed', error)),
        Effect.mapError(gitErrorToProviderError),
      );
    yield* Effect.logInfo('[diff-data] git changed files generated', {
      repo: repoIdentityCacheKey(input.repo),
      number: input.number,
      headSha: prepared.headSha,
      cachePath: prepared.cachePath,
      count: files.length,
    });
    return files;
  });

  const getFileContents: DiffDataBackend['getFileContents'] = Effect.fn(
    'GitDiffBackend.getFileContents',
  )(function* (input) {
    const oldPath = input.oldPath.trim();
    const newPath = input.newPath.trim();

    if (!oldPath && input.changeType !== 'new') {
      throw new ValidationError('Old file path is required');
    }
    if (!newPath && input.changeType !== 'deleted') {
      throw new ValidationError('New file path is required');
    }

    const prepared = yield* prepareGitDiff(input, git, providers);
    const handle = { repo: input.repo, path: prepared.cachePath };
    let oldContent = '';
    let newContent = '';

    if (input.changeType !== 'new') {
      oldContent = yield* git
        .showFile(handle, prepared.diffBaseSha, oldPath, prepared.remoteSpec)
        .pipe(
          Effect.tapError((error) => logGitError('git show old file failed', error)),
          Effect.mapError(gitErrorToProviderError),
        );
    }

    if (input.changeType !== 'deleted') {
      newContent = yield* git.showFile(handle, prepared.headSha, newPath, prepared.remoteSpec).pipe(
        Effect.tapError((error) => logGitError('git show new file failed', error)),
        Effect.mapError(gitErrorToProviderError),
      );
    }

    yield* Effect.logInfo('[diff-data] git file contents generated', {
      repo: repoIdentityCacheKey(input.repo),
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
      providerId: input.repo.providerId,
      repoKey: input.repo.repoKey,
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
