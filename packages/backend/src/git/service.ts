import { Command, FileSystem } from '@effect/platform';
import { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Chunk, Duration, Effect, Fiber, Layer, Stream } from 'effect';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { DurationInput } from 'effect/Duration';
import { BackendConfig } from '../config.ts';
import type { GitRemoteSpec } from '../providers/types.ts';
import { repoIdentityCacheKey } from '../repo-id.ts';
import type { PrChangedFile, PrFileChangeType } from '@code-review-app/shared';
import {
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
  type GitError,
} from './errors.ts';

type GitCommandInput = {
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  auth?: GitRemoteSpec;
  timeout: DurationInput;
  stdin?: string;
  redactValues: string[];
  remoteUrl?: string;
  ref?: string;
  filePath?: string;
};

type GitCommandOutput = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type GitRepoHandle = {
  repo: { providerId: string; repoKey: string };
  path: string;
};

type GitServiceShape = {
  ensureRepo(
    repo: { providerId: string; repoKey: string },
    remoteSpec: GitRemoteSpec,
  ): Effect.Effect<GitRepoHandle, GitError>;
  fetchRefs(
    handle: GitRepoHandle,
    baseSha: string,
    headSha: string,
    remoteSpec: GitRemoteSpec,
  ): Effect.Effect<void, GitError>;
  mergeBase(
    handle: GitRepoHandle,
    baseSha: string,
    headSha: string,
    remoteSpec: GitRemoteSpec,
  ): Effect.Effect<string, GitError>;
  diffPatch(
    handle: GitRepoHandle,
    baseSha: string,
    headSha: string,
    remoteSpec: GitRemoteSpec,
    contextLines?: number,
  ): Effect.Effect<string, GitError>;
  diffNameOnly(
    handle: GitRepoHandle,
    baseSha: string,
    headSha: string,
    remoteSpec: GitRemoteSpec,
  ): Effect.Effect<string[], GitError>;
  diffNameStatus(
    handle: GitRepoHandle,
    baseSha: string,
    headSha: string,
    remoteSpec: GitRemoteSpec,
  ): Effect.Effect<PrChangedFile[], GitError>;
  showFile(
    handle: GitRepoHandle,
    ref: string,
    filePath: string,
    remoteSpec: GitRemoteSpec,
  ): Effect.Effect<string, GitError>;
};

class GitService extends Effect.Tag('GitService')<GitService, GitServiceShape>() {}

const COMMAND_TIMEOUT = '45 seconds';
const FULL_DIFF_CONTEXT_LINES = '1000000';
const decoder = new TextDecoder();

function gitCachePath(userDataPath: string, repo: { providerId: string; repoKey: string }) {
  const hash = createHash('sha256').update(repoIdentityCacheKey(repo)).digest('hex');
  return path.join(userDataPath, 'git-cache', `${hash}.git`);
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function askPassScriptContent(remoteSpec: GitRemoteSpec) {
  const askPass = remoteSpec.auth.askPass;
  if (!askPass) return null;

  if (process.platform === 'win32') {
    return [
      '@echo off',
      'echo %~1 | findstr /I "Username" >nul',
      'if %errorlevel%==0 (',
      `  echo ${askPass.username}`,
      ') else (',
      `  echo ${askPass.password}`,
      ')',
      '',
    ].join('\r\n');
  }

  return [
    '#!/bin/sh',
    'case "$1" in',
    `  *Username*) printf '%s\\n' ${shellSingleQuote(askPass.username)} ;;`,
    `  *) printf '%s\\n' ${shellSingleQuote(askPass.password)} ;;`,
    'esac',
    '',
  ].join('\n');
}

function authEnv(
  fileSystem: FileSystem.FileSystem,
  userDataPath: string,
  remoteSpec: GitRemoteSpec,
) {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_GLOBAL: path.join(userDataPath, 'git-cache', 'empty-global-gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: String(remoteSpec.auth.envConfig.length),
  };

  remoteSpec.auth.envConfig.forEach((entry, index) => {
    env[`GIT_CONFIG_KEY_${index}`] = entry.key;
    env[`GIT_CONFIG_VALUE_${index}`] = entry.value;
  });

  const script = askPassScriptContent(remoteSpec);
  if (!script) return Effect.succeed(env);

  return Effect.gen(function* () {
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: 'code-review-app-git-askpass-',
    });
    const askPassPath = path.join(
      directory,
      process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh',
    );
    yield* fileSystem
      .writeFileString(askPassPath, script)
      .pipe(
        Effect.mapError((error) => new GitUnknownCommandError({ args: [], originalError: error })),
      );
    if (process.platform !== 'win32') {
      yield* fileSystem
        .chmod(askPassPath, 0o700)
        .pipe(
          Effect.mapError(
            (error) => new GitUnknownCommandError({ args: [], originalError: error }),
          ),
        );
    }
    return {
      ...env,
      GIT_ASKPASS: askPassPath,
    };
  });
}

function redactValues(remoteSpec: GitRemoteSpec) {
  return [
    ...remoteSpec.auth.envConfig.map((entry) => entry.value),
    remoteSpec.auth.askPass?.password,
  ].filter((value): value is string => Boolean(value));
}

function sanitize(value: string, secrets: string[]) {
  return secrets.reduce((current, secret) => {
    if (!secret) return current;
    return current.split(secret).join('[redacted]');
  }, value);
}

function decodeChunks(chunks: Chunk.Chunk<Uint8Array>) {
  const values = Chunk.toArray(chunks);
  const length = values.reduce((total, value) => total + value.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    bytes.set(value, offset);
    offset += value.byteLength;
  }
  return decoder.decode(bytes);
}

function isExecutableMissing(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: unknown })?.message ?? error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('enoent') ||
    normalized.includes('not found') ||
    normalized.includes('no such file or directory')
  );
}

function refFromArgs(args: string[], fallback?: string) {
  const showArg = args.find((arg) => arg.includes(':'));
  if (showArg) return showArg.slice(0, showArg.indexOf(':'));
  const refs = args.filter((arg) => /^[0-9a-f]{7,64}$/i.test(arg));
  return fallback ?? refs.at(-1) ?? '';
}

function pathFromShowArgs(args: string[], fallback?: string) {
  const showArg = args.find((arg) => arg.includes(':'));
  if (!showArg) return fallback ?? '';
  return fallback ?? showArg.slice(showArg.indexOf(':') + 1);
}

function changeTypeFromGitStatus(status: string): PrFileChangeType {
  if (status.startsWith('A')) return 'new';
  if (status.startsWith('D')) return 'deleted';
  if (status.startsWith('R')) return 'rename-changed';
  return 'change';
}

function parseGitNameStatus(stdout: string): PrChangedFile[] {
  const fields = stdout.split('\0').filter(Boolean);
  const files: PrChangedFile[] = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++] ?? '';
    const changeType = changeTypeFromGitStatus(status);
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = fields[index++]?.trim() ?? '';
      const newPath = fields[index++]?.trim() ?? '';
      if (newPath || oldPath) {
        files.push({
          path: newPath || oldPath,
          oldPath,
          newPath,
          changeType,
        });
      }
      continue;
    }

    const path = fields[index++]?.trim() ?? '';
    if (!path) {
      continue;
    }
    files.push({
      path,
      oldPath: changeType === 'new' ? '' : path,
      newPath: changeType === 'deleted' ? '' : path,
      changeType,
    });
  }
  return files;
}

function classifyGitResult(
  input: GitCommandInput,
  output: GitCommandOutput,
): GitCommandOutput | GitError {
  if (output.exitCode === 0) return output;

  const stderr = sanitize(output.stderr, input.redactValues);
  const stdout = sanitize(output.stdout, input.redactValues);
  const combined = `${stderr}\n${stdout}`.toLowerCase();
  const remoteUrl = input.remoteUrl ?? '';

  if (
    combined.includes('authentication failed') ||
    combined.includes('could not read username') ||
    combined.includes('terminal prompts disabled') ||
    combined.includes('invalid username or password') ||
    combined.includes('http basic: access denied') ||
    /\b401\b/.test(combined)
  ) {
    return new GitAuthenticationFailed({ stderr, remoteUrl });
  }

  if (
    combined.includes('the requested url returned error: 403') ||
    combined.includes('403 forbidden') ||
    combined.includes('not permitted') ||
    (combined.includes('permission denied') && combined.includes('http'))
  ) {
    return new GitAuthorizationFailed({ stderr, remoteUrl });
  }

  if (
    combined.includes('repository not found') ||
    combined.includes('project not found') ||
    combined.includes('the requested url returned error: 404') ||
    /repository .* not found/.test(combined)
  ) {
    return new GitRepositoryNotFound({ stderr, remoteUrl });
  }

  if (
    combined.includes('filtering not recognized by server') ||
    combined.includes('filter capability not advertised') ||
    combined.includes('filter-spec')
  ) {
    return new GitPartialCloneUnsupported({ stderr, remoteUrl });
  }

  if (
    input.args.includes('show') &&
    (combined.includes('exists on disk, but not in') ||
      combined.includes('does not exist in') ||
      combined.includes('fatal: path') ||
      combined.includes('invalid object name'))
  ) {
    return new GitPathNotFound({
      ref: refFromArgs(input.args, input.ref),
      path: pathFromShowArgs(input.args, input.filePath),
      stderr,
    });
  }

  if (
    combined.includes("couldn't find remote ref") ||
    combined.includes('fatal: bad object') ||
    combined.includes('fatal: not a valid object name') ||
    combined.includes('unknown revision or path not in the working tree')
  ) {
    return new GitRefNotFound({
      ref: refFromArgs(input.args, input.ref),
      stderr,
    });
  }

  return new GitCommandFailed({
    args: input.args,
    exitCode: output.exitCode,
    stdout,
    stderr,
  });
}

function normalizeCommandError(input: GitCommandInput, error: unknown): GitError {
  if (
    error instanceof GitAuthenticationFailed ||
    error instanceof GitAuthorizationFailed ||
    error instanceof GitCommandFailed ||
    error instanceof GitCommandTimedOut ||
    error instanceof GitExecutableNotFound ||
    error instanceof GitPartialCloneUnsupported ||
    error instanceof GitPathNotFound ||
    error instanceof GitRefNotFound ||
    error instanceof GitRepositoryNotFound ||
    error instanceof GitUnknownCommandError
  ) {
    return error;
  }

  if (isExecutableMissing(error)) {
    return new GitExecutableNotFound({ command: 'git', cause: error });
  }

  return new GitUnknownCommandError({ args: input.args, originalError: error });
}

function ensureDirectory(fileSystem: FileSystem.FileSystem, directory: string) {
  return fileSystem
    .makeDirectory(directory, { recursive: true })
    .pipe(
      Effect.mapError((error) => new GitUnknownCommandError({ args: [], originalError: error })),
    );
}

function pathExists(fileSystem: FileSystem.FileSystem, filePath: string) {
  return fileSystem.exists(filePath).pipe(Effect.catchAll(() => Effect.succeed(false)));
}

const makeGitService = Effect.gen(function* () {
  const commandExecutor = yield* CommandExecutor;
  const fileSystem = yield* FileSystem.FileSystem;
  const config = yield* BackendConfig;

  const runGit = (input: GitCommandInput): Effect.Effect<GitCommandOutput, GitError> => {
    return Effect.scoped(
      Effect.gen(function* () {
        const inputAuthEnv = input.auth
          ? yield* authEnv(fileSystem, config.userDataPath, input.auth)
          : {};
        const inputEnv = {
          ...input.env,
          ...inputAuthEnv,
        };
        let gitCommand = Command.make('git', ...input.args).pipe(
          Command.stdout('pipe'),
          Command.stderr('pipe'),
        );
        if (input.cwd) {
          gitCommand = gitCommand.pipe(Command.workingDirectory(input.cwd));
        }
        gitCommand = gitCommand.pipe(Command.env(inputEnv));
        if (input.stdin) {
          gitCommand = gitCommand.pipe(Command.feed(input.stdin));
        }
        const process = yield* Command.start(gitCommand);
        const stdoutFiber = yield* Stream.runCollect(process.stdout).pipe(Effect.fork);
        const stderrFiber = yield* Stream.runCollect(process.stderr).pipe(Effect.fork);
        const exitCode = yield* process.exitCode;
        const stdout = decodeChunks(yield* Fiber.join(stdoutFiber));
        const stderr = decodeChunks(yield* Fiber.join(stderrFiber));
        const result = classifyGitResult(input, {
          stdout,
          stderr,
          exitCode: Number(exitCode),
        });
        if (result instanceof Error) return yield* Effect.fail(result);
        return result;
      }),
    ).pipe(
      Effect.provideService(CommandExecutor, commandExecutor),
      Effect.timeoutFail({
        duration: input.timeout,
        onTimeout: () =>
          new GitCommandTimedOut({
            args: input.args,
            timeoutMs: Duration.toMillis(input.timeout),
            stderr: '',
          }),
      }),
      Effect.mapError((error) => normalizeCommandError(input, error)),
    );
  };

  const ensureRepo: GitServiceShape['ensureRepo'] = Effect.fn('GitService.ensureRepo')(
    function* (repo, remoteSpec) {
      const cachePath = gitCachePath(config.userDataPath, repo);
      const exists = yield* pathExists(fileSystem, cachePath);
      yield* ensureDirectory(fileSystem, path.dirname(cachePath));

      yield* Effect.logInfo('[git] ensure repo').pipe(
        Effect.annotateLogs({
          repo: repoIdentityCacheKey(repo),
          cachePath,
          exists,
        }),
      );

      if (!exists) {
        yield* runGit({
          args: ['init', '--bare', cachePath],
          timeout: COMMAND_TIMEOUT,
          redactValues: redactValues(remoteSpec),
          remoteUrl: remoteSpec.url,
        });
        yield* runGit({
          args: ['-C', cachePath, 'remote', 'add', 'origin', remoteSpec.url],
          timeout: COMMAND_TIMEOUT,
          redactValues: redactValues(remoteSpec),
          remoteUrl: remoteSpec.url,
        });
      } else {
        const currentUrl = yield* runGit({
          args: ['-C', cachePath, 'config', '--get', 'remote.origin.url'],
          timeout: COMMAND_TIMEOUT,
          redactValues: redactValues(remoteSpec),
          remoteUrl: remoteSpec.url,
        }).pipe(
          Effect.map((output) => output.stdout.trim()),
          Effect.catchTag('GitCommandFailed', () => Effect.succeed('')),
        );

        if (!currentUrl) {
          yield* runGit({
            args: ['-C', cachePath, 'remote', 'add', 'origin', remoteSpec.url],
            timeout: COMMAND_TIMEOUT,
            redactValues: redactValues(remoteSpec),
            remoteUrl: remoteSpec.url,
          });
        } else if (currentUrl !== remoteSpec.url) {
          yield* runGit({
            args: ['-C', cachePath, 'remote', 'set-url', 'origin', remoteSpec.url],
            timeout: COMMAND_TIMEOUT,
            redactValues: redactValues(remoteSpec),
            remoteUrl: remoteSpec.url,
          });
        }
      }

      yield* runGit({
        args: ['-C', cachePath, 'config', 'remote.origin.promisor', 'true'],
        timeout: COMMAND_TIMEOUT,
        redactValues: redactValues(remoteSpec),
        remoteUrl: remoteSpec.url,
      });
      yield* runGit({
        args: ['-C', cachePath, 'config', 'remote.origin.partialclonefilter', 'blob:none'],
        timeout: COMMAND_TIMEOUT,
        redactValues: redactValues(remoteSpec),
        remoteUrl: remoteSpec.url,
      });

      return { repo, path: cachePath };
    },
  );

  const fetchRefs: GitServiceShape['fetchRefs'] = Effect.fn('GitService.fetchRefs')(
    function* (handle, baseSha, headSha, remoteSpec) {
      yield* Effect.logInfo('[git] fetch refs start').pipe(
        Effect.annotateLogs({
          repo: repoIdentityCacheKey(handle.repo),
          cachePath: handle.path,
          baseSha,
          headSha,
        }),
      );
      yield* runGit({
        args: [
          '-C',
          handle.path,
          'fetch',
          '--filter=blob:none',
          '--no-tags',
          'origin',
          baseSha,
          headSha,
        ],
        auth: remoteSpec,
        timeout: COMMAND_TIMEOUT,
        redactValues: redactValues(remoteSpec),
        remoteUrl: remoteSpec.url,
        ref: headSha,
      });
      yield* Effect.logInfo('[git] fetch refs finished').pipe(
        Effect.annotateLogs({
          repo: repoIdentityCacheKey(handle.repo),
          cachePath: handle.path,
          baseSha,
          headSha,
        }),
      );
    },
  );

  const mergeBase: GitServiceShape['mergeBase'] = Effect.fn('GitService.mergeBase')(
    function* (handle, baseSha, headSha, remoteSpec) {
      const output = yield* runGit({
        args: ['-C', handle.path, 'merge-base', baseSha, headSha],
        auth: remoteSpec,
        timeout: COMMAND_TIMEOUT,
        redactValues: redactValues(remoteSpec),
        remoteUrl: remoteSpec.url,
        ref: baseSha,
      });
      const resolved = output.stdout.trim();
      if (!resolved) {
        return yield* Effect.fail(
          new GitRefNotFound({ ref: baseSha, stderr: 'merge-base returned no output' }),
        );
      }
      return resolved;
    },
  );

  const diffNameOnly: GitServiceShape['diffNameOnly'] = Effect.fn('GitService.diffNameOnly')(
    function* (handle, baseSha, headSha, remoteSpec) {
      const output = yield* runGit({
        args: ['-C', handle.path, 'diff', '--name-only', '-z', '--find-renames', baseSha, headSha],
        auth: remoteSpec,
        timeout: COMMAND_TIMEOUT,
        redactValues: redactValues(remoteSpec),
        remoteUrl: remoteSpec.url,
        ref: headSha,
      });
      return output.stdout
        .split('\0')
        .map((file) => file.trim())
        .filter(Boolean);
    },
  );

  const diffPatch: GitServiceShape['diffPatch'] = Effect.fn('GitService.diffPatch')(
    function* (handle, baseSha, headSha, remoteSpec, contextLines) {
      const context = String(contextLines ?? FULL_DIFF_CONTEXT_LINES);
      const output = yield* runGit({
        args: [
          '-C',
          handle.path,
          'diff',
          '--no-color',
          '--no-ext-diff',
          '--find-renames',
          `--unified=${context}`,
          `--inter-hunk-context=${context}`,
          baseSha,
          headSha,
        ],
        auth: remoteSpec,
        timeout: COMMAND_TIMEOUT,
        redactValues: redactValues(remoteSpec),
        remoteUrl: remoteSpec.url,
        ref: headSha,
      });
      return output.stdout;
    },
  );

  const diffNameStatus: GitServiceShape['diffNameStatus'] = Effect.fn('GitService.diffNameStatus')(
    function* (handle, baseSha, headSha, remoteSpec) {
      const output = yield* runGit({
        args: [
          '-C',
          handle.path,
          'diff',
          '--name-status',
          '-z',
          '--find-renames',
          baseSha,
          headSha,
        ],
        auth: remoteSpec,
        timeout: COMMAND_TIMEOUT,
        redactValues: redactValues(remoteSpec),
        remoteUrl: remoteSpec.url,
        ref: headSha,
      });
      return parseGitNameStatus(output.stdout);
    },
  );

  const showFile: GitServiceShape['showFile'] = Effect.fn('GitService.showFile')(
    function* (handle, ref, filePath, remoteSpec) {
      const output = yield* runGit({
        args: ['-C', handle.path, 'show', `${ref}:${filePath}`],
        auth: remoteSpec,
        timeout: COMMAND_TIMEOUT,
        redactValues: redactValues(remoteSpec),
        remoteUrl: remoteSpec.url,
        ref,
        filePath,
      });
      return output.stdout;
    },
  );

  return {
    ensureRepo,
    fetchRefs,
    mergeBase,
    diffPatch,
    diffNameOnly,
    diffNameStatus,
    showFile,
  } satisfies GitServiceShape;
});

const GitServiceLive = Layer.effect(GitService, makeGitService);

export { GitService, GitServiceLive, gitCachePath, sanitize };
export type { GitCommandInput, GitCommandOutput, GitRepoHandle, GitServiceShape };
