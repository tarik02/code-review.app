import type { Effect } from "effect";
import type {
  PrChangedFile,
  PrFileChangeType,
  PrFileContents,
} from "../../../shared/types";
import type { RepoId } from "../../repo-id";

type DiffBackendInput = {
  repo: RepoId;
  number: number;
  headSha: string;
  baseSha: string | null;
};

type DiffBackendFileContentsInput = {
  repo: RepoId;
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
  getFileContents(
    input: DiffBackendFileContentsInput,
  ): Effect.Effect<PrFileContents, Error>;
};

export type {
  DiffBackendFileContentsInput,
  DiffBackendInput,
  DiffBackendPatchOptions,
  DiffDataBackend,
};
