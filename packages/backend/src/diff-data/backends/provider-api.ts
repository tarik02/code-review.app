import { Effect } from 'effect';
import { ValidationError } from '../../errors.ts';
import type { ForgeProviderRegistryShape } from '../../providers/registry.ts';
import { repoIdentityCacheKey } from '../../repo-id.ts';
import type { PrChangedFile, PrFileContents } from '@code-review-app/shared';
import type { DiffDataBackend } from './types.ts';

function makeProviderApiDiffBackend(providers: ForgeProviderRegistryShape): DiffDataBackend {
  const getPatch: DiffDataBackend['getPatch'] = Effect.fn('ProviderApiDiffBackend.getPatch')(
    function* (input, _options) {
      const { provider, repo } = yield* providers.forRepo(input.repo);
      return yield* provider.fetchPatch(repo, input.number);
    },
  );

  const getChangedFiles: DiffDataBackend['getChangedFiles'] = Effect.fn(
    'ProviderApiDiffBackend.getChangedFiles',
  )(function* (input) {
    const { provider, repo } = yield* providers.forRepo(input.repo);
    const files = yield* provider.fetchChangedFiles(repo, input.number);
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
  });

  const getFileContents: DiffDataBackend['getFileContents'] = Effect.fn(
    'ProviderApiDiffBackend.getFileContents',
  )(function* (input) {
    const oldPath = input.oldPath.trim();
    const newPath = input.newPath.trim();
    let baseSha = input.baseSha?.trim() || null;
    const { provider, repo } = yield* providers.forRepo(input.repo);

    if (!oldPath && input.changeType !== 'new') {
      throw new ValidationError('Old file path is required');
    }
    if (!newPath && input.changeType !== 'deleted') {
      throw new ValidationError('New file path is required');
    }

    if (!baseSha && input.changeType !== 'new') {
      yield* Effect.logInfo('[diff-data] provider api base sha missing; fetching refs').pipe(
        Effect.annotateLogs({
          repo: repoIdentityCacheKey(input.repo),
          number: input.number,
          provider: repo.provider,
        }),
      );
      const refs = yield* provider.fetchPullRequestRefs(repo, input.number);
      baseSha = refs.baseSha;
      yield* Effect.logInfo('[diff-data] provider api resolved refs').pipe(
        Effect.annotateLogs({
          repo: repoIdentityCacheKey(input.repo),
          number: input.number,
          baseSha,
          headSha: refs.headSha,
        }),
      );
    }
    if (!baseSha && input.changeType !== 'new') {
      throw new ValidationError('Base SHA is required');
    }

    let oldContent = '';
    let newContent = '';

    if (input.changeType !== 'new') {
      oldContent = yield* provider.fetchFileContent(repo, oldPath, baseSha ?? '');
    }

    if (input.changeType !== 'deleted') {
      newContent = yield* provider.fetchFileContent(repo, newPath, input.headSha);
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
  });

  return {
    getPatch,
    getChangedFiles,
    getFileContents,
  };
}

export { makeProviderApiDiffBackend };
