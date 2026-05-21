import { Command, FileSystem } from '@effect/platform';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { Data, Effect, Option, ParseResult, Schema } from 'effect';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const iconPath = path.join(repoRoot, 'apps/electron/build/icons/128x128.png');
const builderConfigPath = path.join(repoRoot, 'apps/electron/electron-builder.yml');
const dataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local/share');
const desktopDir = path.join(dataHome, 'applications');
const desktopPath = path.join(desktopDir, 'code-review.app-dev.desktop');

const DesktopEntrySchema = Schema.Record({
  key: Schema.String,
  value: Schema.String,
});

const ElectronBuilderConfigSchema = Schema.Struct({
  productName: Schema.optional(Schema.String),
  linux: Schema.optional(
    Schema.Struct({
      desktop: Schema.optional(
        Schema.Struct({
          entry: Schema.optional(DesktopEntrySchema),
        }),
      ),
    }),
  ),
});

type DesktopEntry = Schema.Schema.Type<typeof DesktopEntrySchema>;
type ElectronBuilderConfig = Schema.Schema.Type<typeof ElectronBuilderConfigSchema>;

class InstallLinuxDevDesktopFileSystemError extends Data.TaggedError(
  'InstallLinuxDevDesktopFileSystemError',
)<{
  operation: string;
  path: string;
  cause: unknown;
}> {}

class InstallLinuxDevDesktopParseError extends Data.TaggedError(
  'InstallLinuxDevDesktopParseError',
)<{
  path: string;
  cause: unknown;
}> {}

class InstallLinuxDevDesktopConfigError extends Data.TaggedError(
  'InstallLinuxDevDesktopConfigError',
)<{
  path: string;
  message: string;
}> {}

class InstallLinuxDevDesktopElectronNotFoundError extends Data.TaggedError(
  'InstallLinuxDevDesktopElectronNotFoundError',
)<{
  candidates: ReadonlyArray<string>;
}> {}

class InstallLinuxDevDesktopUpdateDesktopDatabaseError extends Data.TaggedError(
  'InstallLinuxDevDesktopUpdateDesktopDatabaseError',
)<{
  command: string;
  cause: unknown;
}> {}

const fsError = (operation: string, filePath: string, cause: unknown) =>
  new InstallLinuxDevDesktopFileSystemError({
    operation,
    path: filePath,
    cause,
  });

const mapFsError = (operation: string, filePath: string) =>
  Effect.mapError((cause: unknown) => fsError(operation, filePath, cause));

function parseElectronBuilderConfig(source: string) {
  return Effect.try({
    try: () => parse(source) as unknown,
    catch: (cause) =>
      new InstallLinuxDevDesktopParseError({
        path: builderConfigPath,
        cause,
      }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknown(ElectronBuilderConfigSchema)),
    Effect.mapError(
      (cause) =>
        new InstallLinuxDevDesktopParseError({
          path: builderConfigPath,
          cause,
        }),
    ),
  );
}

function readDesktopEntry() {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const source = yield* fileSystem
      .readFileString(builderConfigPath)
      .pipe(mapFsError('readFileString', builderConfigPath));
    const config: ElectronBuilderConfig = yield* parseElectronBuilderConfig(source);
    const entry = config.linux?.desktop?.entry;

    if (!entry || Object.keys(entry).length === 0) {
      return yield* Effect.fail(
        new InstallLinuxDevDesktopConfigError({
          path: builderConfigPath,
          message: 'Missing linux.desktop.entry in apps/electron/electron-builder.yml',
        }),
      );
    }

    return {
      entry,
      productName: config.productName ?? 'code-review.app',
    };
  });
}

function quoteDesktopExecArgument(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

const electronCandidates = [
  process.env.ELECTRON_EXEC_PATH,
  '/usr/lib/electron41/electron',
  '/usr/bin/electron41',
  '/usr/bin/electron',
].filter((value): value is string => Boolean(value));
type DesktopEnvironment = Record<string, string>;

function inferElectronMajorVersion(electronPath: string) {
  const match = electronPath.match(/electron(\d+)(?:\/electron)?$/);
  return match?.[1] ?? process.env.ELECTRON_MAJOR_VER ?? null;
}

function resolveSystemElectronPath() {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    for (const candidate of electronCandidates) {
      const exists = yield* fileSystem.exists(candidate).pipe(mapFsError('exists', candidate));

      if (!exists) {
        continue;
      }

      const resolved = yield* fileSystem
        .realPath(candidate)
        .pipe(Effect.option, Effect.map(Option.getOrElse(() => candidate)));

      return resolved;
    }

    return yield* Effect.fail(
      new InstallLinuxDevDesktopElectronNotFoundError({
        candidates: electronCandidates,
      }),
    );
  });
}

function resolveMisePath() {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    if (process.env.MISE_BIN) {
      const candidate = process.env.MISE_BIN;

      if (yield* fileSystem.exists(candidate)) {
        return yield* fileSystem
          .realPath(candidate)
          .pipe(Effect.option, Effect.map(Option.getOrElse(() => candidate)));
      }
    }

    return yield* Command.make('which', 'mise').pipe(
      Command.string,
      Effect.map((value) => value.trim()),
      Effect.flatMap((value) => (value.length > 0 ? Effect.succeed(value) : Effect.fail(null))),
      Effect.option,
      Effect.map(Option.getOrNull),
    );
  });
}

function buildDesktopEnvironment(electronExecPath: string): DesktopEnvironment {
  const majorVersion = inferElectronMajorVersion(electronExecPath);
  const environment: DesktopEnvironment = {
    CODE_REVIEW_APP_DISABLE_UPDATER: '1',
    ELECTRON_EXEC_PATH: electronExecPath,
  };

  if (majorVersion !== null) {
    environment.ELECTRON_MAJOR_VER = majorVersion;
  }

  return environment;
}

function renderDesktopEnvironment(environment: DesktopEnvironment) {
  return Object.entries(environment).map(
    ([key, value]) => `${key}=${quoteDesktopExecArgument(value)}`,
  );
}

function buildDesktopExec(electronExecPath: string, misePath: string | null) {
  const args = [
    '/usr/bin/env',
    '-u',
    'ELECTRON_RUN_AS_NODE',
    ...renderDesktopEnvironment(buildDesktopEnvironment(electronExecPath)),
  ];

  if (misePath) {
    args.push(
      quoteDesktopExecArgument(misePath),
      'x',
      '--cd',
      quoteDesktopExecArgument(repoRoot),
      '--',
    );
  }

  args.push(
    'pnpm',
    '--filter',
    '@code-review-app/electron',
    'exec',
    'electron-vite',
    'dev',
    '--',
    '%U',
  );

  return args.join(' ');
}

function renderDesktopEntry(entry: DesktopEntry) {
  const lines = ['[Desktop Entry]'];
  for (const [key, value] of Object.entries(entry)) {
    lines.push(`${key}=${String(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

function updateDesktopDatabase() {
  return Command.make('update-desktop-database', desktopDir).pipe(
    Command.exitCode,
    Effect.mapError(
      (cause) =>
        new InstallLinuxDevDesktopUpdateDesktopDatabaseError({
          command: `update-desktop-database ${desktopDir}`,
          cause,
        }),
    ),
    Effect.flatMap((exitCode) =>
      exitCode === 0
        ? Effect.void
        : Effect.fail(
            new InstallLinuxDevDesktopUpdateDesktopDatabaseError({
              command: `update-desktop-database ${desktopDir}`,
              cause: `exited with code ${exitCode}`,
            }),
          ),
    ),
  );
}

const program = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const { entry, productName } = yield* readDesktopEntry();
  const electronExecPath = yield* resolveSystemElectronPath();
  const misePath = yield* resolveMisePath();

  const devEntry = { ...entry };
  devEntry.Name = `${devEntry.Name ?? productName} (dev)`;
  devEntry.Comment = `Local dev launcher for ${productName}`;
  devEntry.Exec = buildDesktopExec(electronExecPath, misePath);
  devEntry.Icon = iconPath;
  devEntry.Path = repoRoot;

  yield* fileSystem
    .makeDirectory(desktopDir, { recursive: true })
    .pipe(mapFsError('makeDirectory', desktopDir));
  yield* fileSystem
    .writeFileString(desktopPath, renderDesktopEntry(devEntry))
    .pipe(mapFsError('writeFileString', desktopPath));

  yield* updateDesktopDatabase().pipe(
    Effect.tapErrorTag('InstallLinuxDevDesktopUpdateDesktopDatabaseError', (error) =>
      Effect.logWarning(`Failed to run ${error.command}: ${String(error.cause)}`),
    ),
    Effect.catchTag('InstallLinuxDevDesktopUpdateDesktopDatabaseError', () => Effect.void),
  );

  yield* Effect.logInfo(`installed ${desktopPath}`);
}).pipe(
  Effect.tapErrorTag('InstallLinuxDevDesktopFileSystemError', (error) =>
    Effect.logError(`${error.operation} failed for ${error.path}: ${String(error.cause)}`),
  ),
  Effect.tapErrorTag('InstallLinuxDevDesktopParseError', (error) =>
    Effect.logError(
      `Failed to parse ${error.path}: ${
        ParseResult.isParseError(error.cause)
          ? ParseResult.TreeFormatter.formatErrorSync(error.cause)
          : String(error.cause)
      }`,
    ),
  ),
  Effect.tapErrorTag('InstallLinuxDevDesktopConfigError', (error) =>
    Effect.logError(error.message),
  ),
  Effect.tapErrorTag('InstallLinuxDevDesktopElectronNotFoundError', (error) =>
    Effect.logError(
      `No system Electron binary found. Checked: ${error.candidates.join(', ')}. Set ELECTRON_EXEC_PATH before running install-linux-dev-desktop.ts.`,
    ),
  ),
  Effect.provide(NodeContext.layer),
);

NodeRuntime.runMain(program, {
  disableErrorReporting: true,
});
