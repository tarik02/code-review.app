import { GitHubProvider } from "./github.ts";
import { GitLabProvider } from "./gitlab.ts";
import type { ForgeProviderKind } from "@code-review-app/shared";
import type { ForgeProvider } from "./types.ts";

const githubProvider = new GitHubProvider();
const gitlabProvider = new GitLabProvider();

function providerFor(provider: ForgeProviderKind): ForgeProvider {
  if (provider === "github") return githubProvider;
  return gitlabProvider;
}

export { providerFor };
