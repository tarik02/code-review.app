import { Data } from 'effect';

class GitHubClientTokenStoreError extends Data.TaggedError('GitHubClientTokenStoreError')<{
  message: string;
  accountId: string;
  cause: unknown;
}> {}

class GitHubClientNotAuthenticated extends Data.TaggedError('GitHubClientNotAuthenticated')<{
  message: string;
  accountId: string;
  cause: unknown;
}> {}

class GitHubClientAccessTokenError extends Data.TaggedError('GitHubClientAccessTokenError')<{
  message: string;
  accountId: string;
  cause: unknown;
}> {}

class GitHubClientViewerLoginPersistenceError extends Data.TaggedError(
  'GitHubClientViewerLoginPersistenceError',
)<{
  message: string;
  accountId: string;
  login: string;
  cause: unknown;
}> {}

class GitHubClientSchemaDecodeError extends Data.TaggedError('GitHubClientSchemaDecodeError')<{
  message: string;
  cause: unknown;
}> {}

class GitHubClientResponseError extends Data.TaggedError('GitHubClientResponseError')<{
  message: string;
  url: string;
  status: number;
  cause: unknown;
}> {}

class GitHubClientTransportError extends Data.TaggedError('GitHubClientTransportError')<{
  message: string;
  cause: unknown;
}> {}

class GitHubClientRequestTimeoutError extends Data.TaggedError('GitHubClientRequestTimeoutError')<{
  message: string;
  url: string;
  timeout: string;
  cause: unknown;
}> {}

class GitHubClientGraphqlError extends Data.TaggedError('GitHubClientGraphqlError')<{
  message: string;
  messages: ReadonlyArray<string>;
  cause: unknown;
}> {}

class GitHubClientUnexpectedResponseError extends Data.TaggedError(
  'GitHubClientUnexpectedResponseError',
)<{
  message: string;
  cause: unknown;
}> {}

type GitHubClientError =
  | GitHubClientAccessTokenError
  | GitHubClientGraphqlError
  | GitHubClientNotAuthenticated
  | GitHubClientRequestTimeoutError
  | GitHubClientResponseError
  | GitHubClientSchemaDecodeError
  | GitHubClientTokenStoreError
  | GitHubClientTransportError
  | GitHubClientUnexpectedResponseError
  | GitHubClientViewerLoginPersistenceError;

export {
  GitHubClientAccessTokenError,
  GitHubClientGraphqlError,
  GitHubClientNotAuthenticated,
  GitHubClientRequestTimeoutError,
  GitHubClientResponseError,
  GitHubClientSchemaDecodeError,
  GitHubClientTokenStoreError,
  GitHubClientTransportError,
  GitHubClientUnexpectedResponseError,
  GitHubClientViewerLoginPersistenceError,
};
export type { GitHubClientError };
