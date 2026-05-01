import { Data } from 'effect';

class GitExecutableNotFound extends Data.TaggedError('GitExecutableNotFound')<{
  command: string;
  cause: unknown;
}> {}

class GitAuthenticationFailed extends Data.TaggedError('GitAuthenticationFailed')<{
  args: string[];
  stdout: string;
  stderr: string;
  remoteUrl: string;
}> {}

class GitAuthorizationFailed extends Data.TaggedError('GitAuthorizationFailed')<{
  args: string[];
  stdout: string;
  stderr: string;
  remoteUrl: string;
}> {}

class GitRepositoryNotFound extends Data.TaggedError('GitRepositoryNotFound')<{
  args: string[];
  stdout: string;
  stderr: string;
  remoteUrl: string;
}> {}

class GitRefNotFound extends Data.TaggedError('GitRefNotFound')<{
  args: string[];
  ref: string;
  stdout: string;
  stderr: string;
}> {}

class GitPathNotFound extends Data.TaggedError('GitPathNotFound')<{
  args: string[];
  ref: string;
  path: string;
  stdout: string;
  stderr: string;
}> {}

class GitPartialCloneUnsupported extends Data.TaggedError('GitPartialCloneUnsupported')<{
  args: string[];
  stdout: string;
  stderr: string;
  remoteUrl: string;
}> {}

class GitCommandTimedOut extends Data.TaggedError('GitCommandTimedOut')<{
  args: string[];
  timeoutMs: number;
  stdout: string;
  stderr: string;
}> {}

class GitCommandFailed extends Data.TaggedError('GitCommandFailed')<{
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {}

class GitUnknownCommandError extends Data.TaggedError('GitUnknownCommandError')<{
  args: string[];
  originalError: unknown;
}> {}

type GitError =
  | GitExecutableNotFound
  | GitAuthenticationFailed
  | GitAuthorizationFailed
  | GitRepositoryNotFound
  | GitRefNotFound
  | GitPathNotFound
  | GitPartialCloneUnsupported
  | GitCommandTimedOut
  | GitCommandFailed
  | GitUnknownCommandError;

function firstLine(value: string) {
  return (
    value
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ''
  );
}

export {
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
};
export type { GitError };
