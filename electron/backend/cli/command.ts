import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { CliExecutionError, CliMissingError } from "../errors";

type CommandOutput = {
  stdout: string;
  stderr: string;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function outputMessage(output: {
  stdout: string;
  stderr: string;
  status?: number | null;
}) {
  const stderr = output.stderr.trim();
  const stdout = output.stdout.trim();
  if (stderr.length > 0) return stderr;
  if (stdout.length > 0) return stdout;
  return `command exited with status ${output.status ?? "unknown"}`;
}

async function executableExists(command: string) {
  if (!command.includes("/")) return true;
  try {
    await access(command, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  candidates: string[],
  args: string[],
  options: { timeoutMs?: number; commandName: string } = { commandName: candidates[0] ?? "command" },
): Promise<CommandOutput> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const missingErrors: Error[] = [];

  for (const candidate of candidates) {
    if (!(await executableExists(candidate))) {
      missingErrors.push(new Error(`${candidate} not found`));
      continue;
    }

    const result = await new Promise<
      | { type: "ok"; stdout: string; stderr: string; status: number | null }
      | { type: "missing"; error: Error }
      | { type: "error"; error: Error }
    >((resolve) => {
      const child = spawn(candidate, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill();
        resolve({
          type: "error",
          error: new CliExecutionError(
            `${options.commandName} timed out after ${Math.round(timeoutMs / 1000)} seconds`,
          ),
        });
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(timeout);
        if (error.code === "ENOENT") {
          resolve({ type: "missing", error });
          return;
        }
        resolve({ type: "error", error });
      });
      child.on("close", (status) => {
        clearTimeout(timeout);
        resolve({ type: "ok", stdout, stderr, status });
      });
    });

    if (result.type === "missing") {
      missingErrors.push(result.error);
      continue;
    }

    if (result.type === "error") {
      throw new CliExecutionError(
        `Failed to execute ${options.commandName}: ${result.error.message}`,
      );
    }

    if (result.status === 0) {
      return { stdout: result.stdout, stderr: result.stderr };
    }

    throw new CliExecutionError(outputMessage(result));
  }

  throw new CliMissingError(
    missingErrors.at(-1)?.message ??
      `${options.commandName} is not installed or could not be located`,
  );
}

async function runCommandStatus(
  candidates: string[],
  args: string[],
  options: { timeoutMs?: number; commandName: string },
) {
  try {
    const output = await runCommand(candidates, args, options);
    return { ok: true as const, ...output };
  } catch (error) {
    if (error instanceof CliMissingError) {
      return { ok: false as const, kind: "missing" as const, message: error.message };
    }
    return {
      ok: false as const,
      kind: "error" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export { outputMessage, runCommand, runCommandStatus };
export type { CommandOutput };
