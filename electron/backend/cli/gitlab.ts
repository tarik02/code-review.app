import { normalizeHost } from "../repo-id";
import { runCommand, runCommandStatus } from "./command";

const GLAB_STATUS_TIMEOUT_MS = 8_000;
const GLAB_API_TIMEOUT_MS = 15_000;

function glabCommandCandidates() {
  const candidates: string[] = [];
  const configured = process.env.RUDU_GLAB_PATH?.trim();
  if (configured) candidates.push(configured);
  candidates.push("glab");
  if (process.platform === "darwin") {
    candidates.push("/opt/homebrew/bin/glab", "/usr/local/bin/glab");
  }
  return candidates;
}

async function runGlab(args: string[], timeoutMs?: number) {
  const output = await runCommand(glabCommandCandidates(), args, {
    commandName: "glab",
    timeoutMs,
  });
  return output.stdout;
}

async function runGlabWithTimeout(args: string[], timeoutMs = GLAB_STATUS_TIMEOUT_MS) {
  return runCommandStatus(glabCommandCandidates(), args, {
    commandName: "glab",
    timeoutMs,
  });
}

async function runGlabApi(host: string, endpoint: string) {
  return runGlab(["api", "--hostname", normalizeHost(host), endpoint], GLAB_API_TIMEOUT_MS);
}

async function runGlabApiMethod(
  host: string,
  method: string,
  endpoint: string,
  forms: Array<[string, string]>,
) {
  const args = [
    "api",
    "--hostname",
    normalizeHost(host),
    "--method",
    method,
    endpoint,
  ];
  for (const [key, value] of forms) {
    args.push("--form", `${key}=${value}`);
  }
  return runGlab(args, GLAB_API_TIMEOUT_MS);
}

export { runGlab, runGlabApi, runGlabApiMethod, runGlabWithTimeout };
