import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect, ParseResult, Schema } from "effect";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const DesktopEntrySchema = Schema.Record({
  key: Schema.String,
  value: Schema.String,
});

const ElectronPackageJsonSchema = Schema.Struct({
  build: Schema.optional(
    Schema.Struct({
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
    }),
  ),
});

type DesktopEntry = Schema.Schema.Type<typeof DesktopEntrySchema>;
type ElectronPackageJson = Schema.Schema.Type<typeof ElectronPackageJsonSchema>;

const repoRoot = path.resolve(scriptDir, "..");
const iconPath = path.join(repoRoot, "apps/electron/build/icons/128x128.png");
const packageJsonPath = path.join(repoRoot, "apps/electron/package.json");
const dataHome =
  process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local/share");
const desktopDir = path.join(dataHome, "applications");
const desktopPath = path.join(desktopDir, "code-review.app-dev.desktop");

function formatError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return String(error);
}

function parseElectronPackageJson(source: string) {
  return Effect.try({
    try: () => JSON.parse(source),
    catch: (error) =>
      new Error(`Failed to parse ${packageJsonPath}: ${formatError(error)}`),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknown(ElectronPackageJsonSchema)),
    Effect.mapError((error) => {
      if (ParseResult.isParseError(error)) {
        return new Error(ParseResult.TreeFormatter.formatErrorSync(error));
      }

      return new Error(formatError(error));
    }),
    Effect.mapError(
      (error) =>
        new Error(
          `Invalid desktop metadata in ${packageJsonPath}: ${formatError(error)}`,
        ),
    ),
  );
}

function readElectronPackageJson() {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const source = yield* fileSystem.readFileString(packageJsonPath);
    return yield* parseElectronPackageJson(source);
  });
}

function readDesktopEntry() {
  return Effect.gen(function* () {
    const packageJson: ElectronPackageJson = yield* readElectronPackageJson();
    const entry = packageJson.build?.linux?.desktop?.entry;

    if (!entry || Object.keys(entry).length === 0) {
      return yield* Effect.fail(
        new Error("Missing build.linux.desktop.entry in apps/electron/package.json"),
      );
    }

    return {
      entry,
      productName: packageJson.build?.productName ?? "code-review.app",
    };
  });
}

function provideNodeContext<A, E>(effect: Effect.Effect<A, E>) {
  return effect.pipe(Effect.provide(NodeContext.layer));
}

export {
  desktopDir,
  desktopPath,
  formatError,
  iconPath,
  provideNodeContext,
  readDesktopEntry,
  repoRoot,
};
export type { DesktopEntry };
