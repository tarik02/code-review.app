import type { Effect } from 'effect';
import type { PrChangedFile, PrFileChangeType, PrFileContents } from '@code-review-app/shared';
import type { RepoIdentity } from '../../repo-id.ts';

type DiffBackendInput = {
  repo: RepoIdentity;
  number: number;
  headSha: string;
  baseSha: string | null;
};

type DiffBackendFileContentsInput = {
  repo: RepoIdentity;
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
