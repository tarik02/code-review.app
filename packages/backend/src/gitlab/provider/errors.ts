import { Data } from 'effect';
import { ProviderError } from '../../errors.ts';
import type { GitLabClientError } from '../client/errors.ts';

class GitLabProviderNotAuthenticated extends Data.TaggedError('GitLabProviderNotAuthenticated')<{
  message: string;
  cause: unknown;
}> {}

class GitLabProviderInvalidRepoInput extends Data.TaggedError('GitLabProviderInvalidRepoInput')<{
  message: string;
  input: string;
  cause: unknown;
}> {}

class GitLabProviderRepoHostMismatch extends Data.TaggedError('GitLabProviderRepoHostMismatch')<{
  message: string;
  expectedHost: string;
  actualHost: string;
  cause: unknown;
}> {}

class GitLabProviderMissingDiffVersion extends Data.TaggedError(
  'GitLabProviderMissingDiffVersion',
)<{
  message: string;
  number: number;
  cause: unknown;
}> {}

class GitLabProviderUnsupportedOperation extends Data.TaggedError(
  'GitLabProviderUnsupportedOperation',
)<{
  message: string;
  cause: unknown;
}> {}

class GitLabProviderClientFailure extends Data.TaggedError('GitLabProviderClientFailure')<{
  message: string;
  operation: string;
  cause: GitLabClientError;
}> {}

type GitLabProviderError =
  | GitLabProviderClientFailure
  | GitLabProviderInvalidRepoInput
  | GitLabProviderMissingDiffVersion
  | GitLabProviderNotAuthenticated
  | GitLabProviderRepoHostMismatch
  | GitLabProviderUnsupportedOperation;

const gitlabErrorToProviderError = (error: GitLabProviderError | GitLabClientError) =>
  new ProviderError(error.message, { cause: error });

export {
  GitLabProviderClientFailure,
  GitLabProviderInvalidRepoInput,
  GitLabProviderMissingDiffVersion,
  GitLabProviderNotAuthenticated,
  GitLabProviderRepoHostMismatch,
  GitLabProviderUnsupportedOperation,
  gitlabErrorToProviderError,
};
export type { GitLabProviderError };
