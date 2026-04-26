import { GitHubProvider } from "./github";
import { GitLabProvider } from "./gitlab";
import type { ForgeProviderKind } from "../../shared/types";
import type { ForgeProvider } from "./types";

const githubProvider = new GitHubProvider();
const gitlabProvider = new GitLabProvider();

function providerFor(provider: ForgeProviderKind): ForgeProvider {
  if (provider === "github") return githubProvider;
  return gitlabProvider;
}

export { providerFor };
