import { Effect, Match } from 'effect';
import { ProviderError, ValidationError } from '../../errors.ts';
import type { GitServiceShape } from '../../git/service.ts';
import { firstLine, type GitError } from '../../git/errors.ts';
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

const MAX_GIT_OUTPUT_LENGTH = 6000;

function truncateGitOutput(value: string) {
  if (value.length <= MAX_GIT_OUTPUT_LENGTH) {
    return value;
  }

  const omitted = value.length - MAX_GIT_OUTPUT_LENGTH;
  return `${value.slice(0, MAX_GIT_OUTPUT_LENGTH)}\n... ${omitted} chars truncated`;
}

function getGitOutput(error: GitError) {
  return {
    args: 'args' in error && Array.isArray(error.args) ? error.args : [],
    stdout: 'stdout' in error && typeof error.stdout === 'string' ? error.stdout.trimEnd() : '',
    stderr: 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trimEnd() : '',
  };
}

function formatGitOutputDetails(error: GitError) {
  const { args, stdout, stderr } = getGitOutput(error);
  const sections: string[] = [];

  if (args.length > 0) {
    sections.push(`command:\ngit ${args.join(' ')}`);
  }

  if (stdout) {
    sections.push(`stdout:\n${truncateGitOutput(stdout)}`);
  }

  if (stderr) {
    sections.push(`stderr:\n${truncateGitOutput(stderr)}`);
  }

  if (sections.length === 0) {
    return '';
  }

  return `\n\nGit command output:\n${sections.join('\n\n')}`;
}

function gitProviderError(message: string, error: GitError) {
  return new ProviderError(`${message}${formatGitOutputDetails(error)}`, { cause: error });
}

function gitErrorToProviderError(error: GitError) {
  return Match.value(error).pipe(
    Match.tagsExhaustive({
      GitAuthenticationFailed: (gitError) =>
        gitProviderError(
          'Git authentication failed for this repository. Sign in again or switch diff loading to Provider API.',
          gitError,
        ),
      GitAuthorizationFailed: (gitError) =>
        gitProviderError('Your account cannot fetch this repository with git.', gitError),
      GitCommandFailed: (gitError) =>
        gitProviderError(
          `Git command failed: ${firstLine(gitError.stderr) || firstLine(gitError.stdout) || 'unknown git error'}`,
          gitError,
        ),
      GitCommandTimedOut: (gitError) => gitProviderError('Git command timed out.', gitError),
      GitExecutableNotFound: (gitError) =>
        new ProviderError('Git mode requires git to be installed and available on PATH.', {
          cause: gitError,
        }),
      GitPartialCloneUnsupported: (gitError) =>
        gitProviderError('This git server does not support blobless partial clone.', gitError),
      GitPathNotFound: (gitError) =>
        gitProviderError('Git could not find this file at the requested ref.', gitError),
      GitRefNotFound: (gitError) =>
        gitProviderError('Git could not fetch one of the PR refs.', gitError),
      GitRepositoryNotFound: (gitError) =>
        gitProviderError('Git could not find this repository.', gitError),
      GitUnknownCommandError: (gitError) =>
        new ProviderError('Git command failed unexpectedly.', { cause: gitError }),
    }),
  );
}

function logGitError(context: string, error: GitError) {
  const logDetails = Match.value(error).pipe(
    Match.tagsExhaustive({
      GitAuthenticationFailed: (gitError) => ({
        tag: 'GitAuthenticationFailed',
        error: gitError,
      }),
      GitAuthorizationFailed: (gitError) => ({
        tag: 'GitAuthorizationFailed',
        error: gitError,
      }),
      GitCommandFailed: (gitError) => ({ tag: 'GitCommandFailed', error: gitError }),
      GitCommandTimedOut: (gitError) => ({ tag: 'GitCommandTimedOut', error: gitError }),
      GitExecutableNotFound: (gitError) => ({ tag: 'GitExecutableNotFound', error: gitError }),
      GitPartialCloneUnsupported: (gitError) => ({
        tag: 'GitPartialCloneUnsupported',
        error: gitError,
      }),
      GitPathNotFound: (gitError) => ({ tag: 'GitPathNotFound', error: gitError }),
      GitRefNotFound: (gitError) => ({ tag: 'GitRefNotFound', error: gitError }),
      GitRepositoryNotFound: (gitError) => ({ tag: 'GitRepositoryNotFound', error: gitError }),
      GitUnknownCommandError: (gitError) => ({
        tag: 'GitUnknownCommandError',
        error: { args: gitError.args },
      }),
    }),
  );

  return Effect.logDebug('[diff-data] git backend error').pipe(
    Effect.annotateLogs({
      context,
      ...logDetails,
    }),
  );
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

    yield* Effect.logInfo('[diff-data] git base sha missing; fetching refs').pipe(
      Effect.annotateLogs({
        repo: repoIdentityCacheKey(repo),
        number,
        provider: repo.provider,
      }),
    );
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
    const refs = yield* resolveRefs(repo, input.number, input.baseSha, input.headSha, provider);
    yield* Effect.logInfo('[diff-data] git refs resolved').pipe(
      Effect.annotateLogs({
        repo: repoIdentityCacheKey(input.repo),
        number: input.number,
        source: refs.source,
        baseSha: refs.baseSha,
        headSha: refs.headSha,
      }),
    );

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

function makeGitDiffBackend(
  git: GitServiceShape,
  providers: ForgeProviderRegistryShape,
): DiffDataBackend {
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
      yield* Effect.logInfo('[diff-data] git patch generated').pipe(
        Effect.annotateLogs({
          repo: repoIdentityCacheKey(input.repo),
          number: input.number,
          headSha: prepared.headSha,
          cachePath: prepared.cachePath,
          length: patch.length,
        }),
      );
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
    yield* Effect.logInfo('[diff-data] git changed files generated').pipe(
      Effect.annotateLogs({
        repo: repoIdentityCacheKey(input.repo),
        number: input.number,
        headSha: prepared.headSha,
        cachePath: prepared.cachePath,
        count: files.length,
      }),
    );
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

    yield* Effect.logInfo('[diff-data] git file contents generated').pipe(
      Effect.annotateLogs({
        repo: repoIdentityCacheKey(input.repo),
        number: input.number,
        oldPath,
        newPath,
        baseSha: prepared.diffBaseSha,
        headSha: prepared.headSha,
        cachePath: prepared.cachePath,
        oldLength: oldContent.length,
        newLength: newContent.length,
      }),
    );

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
