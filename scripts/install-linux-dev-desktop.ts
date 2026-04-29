import { Command, FileSystem } from "@effect/platform";
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import {
  desktopDir,
  desktopPath,
  formatError,
  iconPath,
  provideNodeContext,
  readDesktopEntry,
  repoRoot,
  type DesktopEntry,
} from "./shared.ts";

function quoteDesktopExecArgument(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

const electronCandidates = [
  process.env.ELECTRON_EXEC_PATH,
  "/usr/lib/electron41/electron",
  "/usr/bin/electron41",
  "/usr/bin/electron",
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
      if (!(yield* fileSystem.exists(candidate))) {
        continue;
      }

      const resolved = yield* fileSystem
        .realPath(candidate)
        .pipe(Effect.catchAll(() => Effect.succeed(candidate)));

      return resolved;
    }

    return yield* Effect.fail(
      new Error(
        "No system Electron binary found. Set ELECTRON_EXEC_PATH before running install-linux-dev-desktop.ts.",
      ),
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
          .pipe(Effect.catchAll(() => Effect.succeed(candidate)));
      }
    }

    return yield* Command.make("which", "mise").pipe(
      Command.string,
      Effect.map((value) => value.trim()),
      Effect.filterOrFail(
        (value) => value.length > 0,
        () => new Error("which mise returned an empty path"),
      ),
      Effect.catchAll(() => Effect.succeed(null)),
    );
  });
}

function buildDesktopEnvironment(electronExecPath: string): DesktopEnvironment {
  const majorVersion = inferElectronMajorVersion(electronExecPath);
  const environment: DesktopEnvironment = {
    CODE_REVIEW_APP_DISABLE_UPDATER: "1",
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
    "/usr/bin/env",
    "-u",
    "ELECTRON_RUN_AS_NODE",
    ...renderDesktopEnvironment(buildDesktopEnvironment(electronExecPath)),
  ];

  if (misePath) {
    args.push(
      quoteDesktopExecArgument(misePath),
      "x",
      "--cd",
      quoteDesktopExecArgument(repoRoot),
      "--",
    );
  }

  args.push(
    "pnpm",
    "--filter",
    "@code-review-app/electron",
    "exec",
    "electron-vite",
    "dev",
    "--",
    "%U",
  );

  return args.join(" ");
}

function renderDesktopEntry(entry: DesktopEntry) {
  const lines = ["[Desktop Entry]"];
  for (const [key, value] of Object.entries(entry)) {
    lines.push(`${key}=${String(value)}`);
  }
  return `${lines.join("\n")}\n`;
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

  yield* fileSystem.makeDirectory(desktopDir, { recursive: true });
  yield* fileSystem.writeFileString(desktopPath, renderDesktopEntry(devEntry));

  yield* Command.make("update-desktop-database", desktopDir).pipe(
    Command.exitCode,
    Effect.asVoid,
    Effect.catchAll(() => Effect.void),
  );

  yield* Effect.sync(() => {
    console.log(`installed ${desktopPath}`);
  });
}).pipe(
  Effect.tapError((error) =>
    Effect.sync(() => {
      console.error(formatError(error));
    }),
  ),
  provideNodeContext,
);

NodeRuntime.runMain(program, {
  disableErrorReporting: true,
  disablePrettyLogger: true,
});
