import { HttpClient } from "@effect/platform";
import { Effect, Layer } from "effect";
import { ValidationError } from "../errors.ts";
import { createRepoIdentityFromParts } from "../repo-id.ts";
import { providerFor } from "../providers/registry.ts";
import { AuthTokenStore } from "../auth/token-store.ts";
import type {
  ForgeProviderKind,
  PullRequestQualityReport,
  RepoIdentity,
} from "@code-review-app/shared";

type PullRequestQualityServiceShape = {
  get(
    repo: RepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<PullRequestQualityReport, Error>;
};

class PullRequestQualityService extends Effect.Tag("PullRequestQualityService")<
  PullRequestQualityService,
  PullRequestQualityServiceShape
>() {}

function requireRepo(repo: RepoIdentity) {
  if (!repo.providerId.trim() || !repo.repoKey.trim()) {
    throw new ValidationError("Repo is required");
  }

  return repo;
}

function qualityProviderLabel(provider: ForgeProviderKind) {
  return provider === "github" ? "GitHub checks" : "GitLab code quality";
}

function unavailableQualityReport(
  provider: ForgeProviderKind,
  repo: RepoIdentity,
  number: number,
  headSha: string,
  message: string,
): PullRequestQualityReport {
  return {
    provider,
    repoKey: repo.repoKey,
    number,
    headSha,
    status: "unavailable",
    summary: {
      totalFindings: 0,
      inlineFindings: 0,
      fileOnlyFindings: 0,
      providerLabel: qualityProviderLabel(provider),
      notes: [message],
    },
    findings: [],
    fetchedAt: new Date().toISOString(),
    sourceMetadata: {
      error: message,
    },
  };
}

const makePullRequestQualityService = Effect.gen(function* () {
  const tokenStore = yield* AuthTokenStore;
  const httpClient = yield* HttpClient.HttpClient;

  const provideProviderDeps = <A, E>(
    effect: Effect.Effect<A, E, AuthTokenStore | HttpClient.HttpClient>,
  ) =>
    effect.pipe(
      Effect.provideService(AuthTokenStore, tokenStore),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );

  const get: PullRequestQualityServiceShape["get"] = Effect.fn("PullRequestQualityService.get")(
    function* (repoInput, number, headSha) {
      const repoIdentity = requireRepo(repoInput);
      const repo = createRepoIdentityFromParts(repoIdentity.providerId, repoIdentity.repoKey);

      return yield* provideProviderDeps(
        providerFor(repo.provider).getPullRequestQualityReport({
          repo,
          number,
          headSha,
        }),
      ).pipe(
        Effect.catchAll((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[pull-request-quality] failed to load quality report", {
            provider: repo.provider,
            repo: repo.path,
            number,
            headSha,
            message,
          });
          return Effect.succeed(
            unavailableQualityReport(repo.provider, repoIdentity, number, headSha, message),
          );
        }),
      );
    },
  );

  return {
    get,
  } satisfies PullRequestQualityServiceShape;
});

const PullRequestQualityServiceLive = Layer.effect(
  PullRequestQualityService,
  makePullRequestQualityService,
);

export { PullRequestQualityService, PullRequestQualityServiceLive };
