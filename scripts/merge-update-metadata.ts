import { FileSystem } from '@effect/platform';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { Data, Effect, ParseResult, Schema } from 'effect';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const UpdateFileSchema = Schema.Struct({
  url: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  sha512: Schema.optional(Schema.String),
  size: Schema.optional(Schema.Number),
});

const WindowsPackageInfoSchema = Schema.Struct({
  path: Schema.String,
  sha512: Schema.optional(Schema.String),
  blockMapSize: Schema.optional(Schema.Number),
  size: Schema.optional(Schema.Number),
});

const UpdateMetadataSchema = Schema.Struct({
  version: Schema.optional(Schema.String),
  releaseDate: Schema.optional(Schema.String),
  releaseName: Schema.optional(Schema.String),
  releaseNotes: Schema.optional(Schema.Union(Schema.String, Schema.Array(Schema.Unknown))),
  stagingPercentage: Schema.optional(Schema.Number),
  files: Schema.optional(Schema.Array(UpdateFileSchema)),
  packages: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: WindowsPackageInfoSchema,
    }),
  ),
});

type UpdateFile = Schema.Schema.Type<typeof UpdateFileSchema>;
type UpdateMetadata = Schema.Schema.Type<typeof UpdateMetadataSchema>;

class MergeMetadataFileSystemError extends Data.TaggedError('MergeMetadataFileSystemError')<{
  operation: string;
  path: string;
  cause: unknown;
}> {}

class MergeMetadataParseError extends Data.TaggedError('MergeMetadataParseError')<{
  path: string;
  cause: unknown;
}> {}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const defaultInputDir = path.join(repoRoot, 'release-artifacts');
const defaultOutputDir = path.join(repoRoot, 'release-assets');

const fsError = (operation: string, filePath: string, cause: unknown) =>
  new MergeMetadataFileSystemError({
    operation,
    path: filePath,
    cause,
  });

const mapFsError = (operation: string, filePath: string) =>
  Effect.mapError((cause: unknown) => fsError(operation, filePath, cause));

const getArgValue = (flag: string, fallback: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};

const getFileKey = (file: UpdateFile) => file.url ?? file.path ?? JSON.stringify(file);

const mergeFiles = (
  baseFiles: ReadonlyArray<UpdateFile> | undefined,
  extraFiles: ReadonlyArray<UpdateFile> | undefined,
) => {
  const files = new Map<string, UpdateFile>();

  for (const file of baseFiles ?? []) {
    files.set(getFileKey(file), file);
  }

  for (const file of extraFiles ?? []) {
    files.set(getFileKey(file), file);
  }

  return [...files.values()];
};

const mergeMetadata = (base: UpdateMetadata, extra: UpdateMetadata): UpdateMetadata => ({
  version: base.version,
  releaseDate: base.releaseDate,
  releaseName: base.releaseName,
  releaseNotes: base.releaseNotes,
  stagingPercentage: base.stagingPercentage,
  files: mergeFiles(base.files, extra.files),
  packages: {
    ...base.packages,
    ...extra.packages,
  },
});

const parseMetadata = (source: string, filePath: string) =>
  Effect.try({
    try: () => parse(source) as unknown,
    catch: (cause) => new MergeMetadataParseError({ path: filePath, cause }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknown(UpdateMetadataSchema)),
    Effect.mapError((cause) => new MergeMetadataParseError({ path: filePath, cause })),
  );

const readMetadata = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const source = yield* fileSystem
      .readFileString(filePath)
      .pipe(mapFsError('readFileString', filePath));
    return yield* parseMetadata(source, filePath);
  });

const writeMetadata = (filePath: string, metadata: UpdateMetadata) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem
      .writeFileString(filePath, stringify(metadata))
      .pipe(mapFsError('writeFileString', filePath));
  });

const ensureMetadataFile = (inputDir: string, artifactDir: string, fileName: string) => {
  const filePath = path.join(inputDir, artifactDir, fileName);
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.stat(filePath).pipe(mapFsError('stat', filePath));
    return filePath;
  });
};

const findOptionalMetadataFile = (inputDir: string, artifactDir: string, fileName: string) => {
  const filePath = path.join(inputDir, artifactDir, fileName);
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const exists = yield* fileSystem.exists(filePath).pipe(mapFsError('exists', filePath));
    return exists ? filePath : null;
  });
};

const loadMetadata = (inputDir: string, artifactDir: string, fileName: string) =>
  Effect.gen(function* () {
    const filePath = yield* ensureMetadataFile(inputDir, artifactDir, fileName);
    return yield* readMetadata(filePath);
  });

const copyMetadataFile = (
  inputDir: string,
  artifactDir: string,
  fileName: string,
  outputFilePath: string,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const sourcePath = yield* ensureMetadataFile(inputDir, artifactDir, fileName);
    yield* fileSystem
      .copyFile(sourcePath, outputFilePath)
      .pipe(mapFsError('copyFile', `${sourcePath} -> ${outputFilePath}`));
  });

const shouldSkipMetadataFile = (fileName: string) =>
  fileName === 'latest.yml' || fileName === 'latest-mac.yml' || fileName.startsWith('latest-linux');

const copyReleaseAssets = (inputDir: string, outputDir: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const artifactDirs = yield* fileSystem
      .readDirectory(inputDir)
      .pipe(mapFsError('readDirectory', inputDir));

    for (const artifactDir of artifactDirs) {
      const artifactDirPath = path.join(inputDir, artifactDir);
      const artifactStats = yield* fileSystem
        .stat(artifactDirPath)
        .pipe(mapFsError('stat', artifactDirPath));

      if (artifactStats.type !== 'Directory') {
        continue;
      }

      const entries = yield* fileSystem
        .readDirectory(artifactDirPath)
        .pipe(mapFsError('readDirectory', artifactDirPath));

      for (const fileName of entries) {
        if (shouldSkipMetadataFile(fileName)) {
          continue;
        }

        const source = path.join(artifactDirPath, fileName);
        const sourceStats = yield* fileSystem.stat(source).pipe(mapFsError('stat', source));

        if (sourceStats.type !== 'File') {
          continue;
        }

        const destination = path.join(outputDir, fileName);
        yield* fileSystem
          .copyFile(source, destination)
          .pipe(mapFsError('copyFile', `${source} -> ${destination}`));
      }
    }
  });

const copyLinuxMetadata = (inputDir: string, outputDir: string) =>
  Effect.all([
    copyMetadataFile(
      inputDir,
      'release-linux-x64',
      'latest-linux.yml',
      path.join(outputDir, 'latest-linux.yml'),
    ),
    copyMetadataFile(
      inputDir,
      'release-linux-arm64',
      'latest-linux-arm64.yml',
      path.join(outputDir, 'latest-linux-arm64.yml'),
    ),
  ]);

const mergeWindowsMetadata = (inputDir: string, outputDir: string) =>
  Effect.gen(function* () {
    const x64 = yield* loadMetadata(inputDir, 'release-win-x64', 'latest.yml');
    const arm64Path = yield* findOptionalMetadataFile(inputDir, 'release-win-arm64', 'latest.yml');

    if (arm64Path === null) {
      yield* writeMetadata(path.join(outputDir, 'latest.yml'), x64);
      return;
    }

    const arm64 = yield* readMetadata(arm64Path);
    yield* writeMetadata(path.join(outputDir, 'latest.yml'), mergeMetadata(x64, arm64));
  });

const mergeMacMetadata = (inputDir: string, outputDir: string) =>
  Effect.gen(function* () {
    const [x64, arm64] = yield* Effect.all([
      loadMetadata(inputDir, 'release-mac-x64', 'latest-mac.yml'),
      loadMetadata(inputDir, 'release-mac-arm64', 'latest-mac.yml'),
    ]);

    yield* writeMetadata(path.join(outputDir, 'latest-mac.yml'), mergeMetadata(x64, arm64));
  });

const program = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const inputDir = getArgValue('--input-dir', defaultInputDir);
  const outputDir = getArgValue('--output-dir', defaultOutputDir);

  yield* fileSystem
    .remove(outputDir, { recursive: true, force: true })
    .pipe(mapFsError('remove', outputDir));
  yield* fileSystem
    .makeDirectory(outputDir, { recursive: true })
    .pipe(mapFsError('makeDirectory', outputDir));
  yield* copyReleaseAssets(inputDir, outputDir);
  yield* Effect.all([
    mergeWindowsMetadata(inputDir, outputDir),
    mergeMacMetadata(inputDir, outputDir),
    copyLinuxMetadata(inputDir, outputDir),
  ]);
}).pipe(
  Effect.tapErrorTag('MergeMetadataFileSystemError', (error) =>
    Effect.logError(`${error.operation} failed for ${error.path}: ${String(error.cause)}`),
  ),
  Effect.tapErrorTag('MergeMetadataParseError', (error) =>
    Effect.logError(
      `Failed to parse ${error.path}: ${
        ParseResult.isParseError(error.cause)
          ? ParseResult.TreeFormatter.formatErrorSync(error.cause)
          : String(error.cause)
      }`,
    ),
  ),
  Effect.provide(NodeContext.layer),
);

NodeRuntime.runMain(program, {
  disableErrorReporting: true,
});
