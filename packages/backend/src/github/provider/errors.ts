import { Data } from 'effect';
import { ProviderError } from '../../errors.ts';
import type { GitHubClientError } from '../client/errors.ts';

class GitHubProviderNotAuthenticated extends Data.TaggedError('GitHubProviderNotAuthenticated')<{
  message: string;
  cause: unknown;
}> {}

class GitHubProviderInvalidRepoInput extends Data.TaggedError('GitHubProviderInvalidRepoInput')<{
  message: string;
  input: string;
  cause: unknown;
}> {}

class GitHubProviderRepoHostMismatch extends Data.TaggedError('GitHubProviderRepoHostMismatch')<{
  message: string;
  expectedHost: string;
  actualHost: string;
  cause: unknown;
}> {}

class GitHubProviderViewerLoginUnavailable extends Data.TaggedError(
  'GitHubProviderViewerLoginUnavailable',
)<{
  message: string;
  cause: unknown;
}> {}

class GitHubProviderPullRequestNotFound extends Data.TaggedError(
  'GitHubProviderPullRequestNotFound',
)<{
  message: string;
  number: number;
  cause: unknown;
}> {}

class GitHubProviderNoApprovalToRemove extends Data.TaggedError(
  'GitHubProviderNoApprovalToRemove',
)<{
  message: string;
  number: number;
  viewerLogin: string;
  cause: unknown;
}> {}

class GitHubProviderUnsupportedOperation extends Data.TaggedError(
  'GitHubProviderUnsupportedOperation',
)<{
  message: string;
  cause: unknown;
}> {}

class GitHubProviderMutationFailed extends Data.TaggedError('GitHubProviderMutationFailed')<{
  message: string;
  cause: unknown;
}> {}

class GitHubProviderClientFailure extends Data.TaggedError('GitHubProviderClientFailure')<{
  message: string;
  operation: string;
  cause: GitHubClientError;
}> {}

type GitHubProviderError =
  | GitHubProviderClientFailure
  | GitHubProviderInvalidRepoInput
  | GitHubProviderMutationFailed
  | GitHubProviderNoApprovalToRemove
  | GitHubProviderNotAuthenticated
  | GitHubProviderPullRequestNotFound
  | GitHubProviderRepoHostMismatch
  | GitHubProviderUnsupportedOperation
  | GitHubProviderViewerLoginUnavailable;

const githubErrorToProviderError = (error: GitHubProviderError | GitHubClientError) =>
  new ProviderError(error.message, { cause: error });

export {
  GitHubProviderClientFailure,
  GitHubProviderInvalidRepoInput,
  GitHubProviderMutationFailed,
  GitHubProviderNoApprovalToRemove,
  GitHubProviderNotAuthenticated,
  GitHubProviderPullRequestNotFound,
  GitHubProviderRepoHostMismatch,
  GitHubProviderUnsupportedOperation,
  GitHubProviderViewerLoginUnavailable,
  githubErrorToProviderError,
};
export type { GitHubProviderError };
