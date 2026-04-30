import { Data } from 'effect';

class GitLabClientTokenStoreError extends Data.TaggedError('GitLabClientTokenStoreError')<{
  message: string;
  accountId: string;
  cause: unknown;
}> {}

class GitLabClientNotAuthenticated extends Data.TaggedError('GitLabClientNotAuthenticated')<{
  message: string;
  accountId: string;
  cause: unknown;
}> {}

class GitLabClientAccessTokenError extends Data.TaggedError('GitLabClientAccessTokenError')<{
  message: string;
  accountId: string;
  cause: unknown;
}> {}

class GitLabClientViewerLoginPersistenceError extends Data.TaggedError(
  'GitLabClientViewerLoginPersistenceError',
)<{
  message: string;
  accountId: string;
  login: string;
  cause: unknown;
}> {}

class GitLabClientSchemaDecodeError extends Data.TaggedError('GitLabClientSchemaDecodeError')<{
  message: string;
  cause: unknown;
}> {}

class GitLabClientResponseError extends Data.TaggedError('GitLabClientResponseError')<{
  message: string;
  url: string;
  status: number;
  cause: unknown;
}> {}

class GitLabClientTransportError extends Data.TaggedError('GitLabClientTransportError')<{
  message: string;
  cause: unknown;
}> {}

class GitLabClientRequestTimeoutError extends Data.TaggedError('GitLabClientRequestTimeoutError')<{
  message: string;
  url: string;
  timeout: string;
  cause: unknown;
}> {}

class GitLabClientGraphqlError extends Data.TaggedError('GitLabClientGraphqlError')<{
  message: string;
  messages: ReadonlyArray<string>;
  cause: unknown;
}> {}

type GitLabClientError =
  | GitLabClientAccessTokenError
  | GitLabClientGraphqlError
  | GitLabClientNotAuthenticated
  | GitLabClientRequestTimeoutError
  | GitLabClientResponseError
  | GitLabClientSchemaDecodeError
  | GitLabClientTokenStoreError
  | GitLabClientTransportError
  | GitLabClientViewerLoginPersistenceError;

const isGitLabClientError = (error: unknown): error is GitLabClientError =>
  error instanceof GitLabClientTokenStoreError ||
  error instanceof GitLabClientNotAuthenticated ||
  error instanceof GitLabClientAccessTokenError ||
  error instanceof GitLabClientViewerLoginPersistenceError ||
  error instanceof GitLabClientSchemaDecodeError ||
  error instanceof GitLabClientResponseError ||
  error instanceof GitLabClientTransportError ||
  error instanceof GitLabClientRequestTimeoutError ||
  error instanceof GitLabClientGraphqlError;

export {
  GitLabClientAccessTokenError,
  GitLabClientGraphqlError,
  GitLabClientNotAuthenticated,
  GitLabClientRequestTimeoutError,
  GitLabClientResponseError,
  GitLabClientSchemaDecodeError,
  GitLabClientTokenStoreError,
  GitLabClientTransportError,
  GitLabClientViewerLoginPersistenceError,
  isGitLabClientError,
};
export type { GitLabClientError };
