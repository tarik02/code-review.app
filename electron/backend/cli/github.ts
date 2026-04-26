import { runCommand, runCommandStatus } from "./command";

const CLI_STATUS_TIMEOUT_MS = 8_000;

function ghCommandCandidates() {
  const candidates: string[] = [];
  const configured = process.env.RUDU_GH_PATH?.trim();
  if (configured) candidates.push(configured);
  candidates.push("gh");
  if (process.platform === "darwin") {
    candidates.push("/opt/homebrew/bin/gh", "/usr/local/bin/gh");
  }
  return candidates;
}

async function runGh(args: string[]) {
  const output = await runCommand(ghCommandCandidates(), args, {
    commandName: "gh",
  });
  return output.stdout;
}

async function runGhWithTimeout(args: string[], timeoutMs = CLI_STATUS_TIMEOUT_MS) {
  return runCommandStatus(ghCommandCandidates(), args, {
    commandName: "gh",
    timeoutMs,
  });
}

export { ghCommandCandidates, runGh, runGhWithTimeout };
