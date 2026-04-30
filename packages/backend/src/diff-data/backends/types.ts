import type { Effect } from 'effect';
import type { PrChangedFile, PrFileChangeType, PrFileContents } from '@code-review-app/shared';
import type { ProviderRepoIdentity } from '../../repo-id.ts';

type DiffBackendInput = {
  repo: ProviderRepoIdentity;
  number: number;
  headSha: string;
  baseSha: string | null;
};

type DiffBackendFileContentsInput = {
  repo: ProviderRepoIdentity;
  number: number;
  oldPath: string;
  newPath: string;
  baseSha: string | null;
  headSha: string;
  changeType: PrFileChangeType;
};

type DiffBackendPatchOptions = {
  contextLines?: number;
};

type DiffDataBackend = {
  getPatch(
    input: DiffBackendInput,
    options?: DiffBackendPatchOptions,
  ): Effect.Effect<string, Error>;
  getChangedFiles(input: DiffBackendInput): Effect.Effect<PrChangedFile[], Error>;
  getFileContents(input: DiffBackendFileContentsInput): Effect.Effect<PrFileContents, Error>;
};

export type {
  DiffBackendFileContentsInput,
  DiffBackendInput,
  DiffBackendPatchOptions,
  DiffDataBackend,
};
