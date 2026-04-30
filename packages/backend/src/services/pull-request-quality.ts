import { Effect, Layer } from 'effect';
import { ValidationError, summarizeError } from '../errors.ts';
import { ForgeProviderRegistry } from '../providers/registry.ts';
import type {
  ForgeProviderKind,
  PullRequestQualityReport,
  RepoIdentity,
} from '@code-review-app/shared';

type PullRequestQualityServiceShape = {
  get(
    repo: RepoIdentity,
    number: number,
    headSha: string,
  ): Effect.Effect<PullRequestQualityReport, Error>;
};

class PullRequestQualityService extends Effect.Tag('PullRequestQualityService')<
  PullRequestQualityService,
  PullRequestQualityServiceShape
>() {}

function requireRepo(repo: RepoIdentity) {
  if (!repo.providerId.trim() || !repo.repoKey.trim()) {
    throw new ValidationError('Repo is required');
  }

  return repo;
}

function qualityProviderLabel(provider: ForgeProviderKind) {
  return provider === 'github' ? 'GitHub checks' : 'GitLab code quality';
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
    status: 'unavailable',
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
  const providers = yield* ForgeProviderRegistry;

  const get: PullRequestQualityServiceShape['get'] = Effect.fn('PullRequestQualityService.get')(
    function* (repoInput, number, headSha) {
      const repoIdentity = requireRepo(repoInput);
      const { provider, repo } = yield* providers.forRepo(repoIdentity);

      return yield* provider
        .getPullRequestQualityReport({
          repo,
          number,
          headSha,
        })
        .pipe(
          Effect.catchAll((error) => {
            const message = error instanceof Error ? error.message : String(error);
            return Effect.logWarning('[pull-request-quality] failed to load quality report').pipe(
              Effect.annotateLogs({
                provider: repo.provider,
                repo: repo.path,
                number,
                headSha,
                message,
                error: summarizeError(error),
              }),
              Effect.zipRight(
                Effect.succeed(
                  unavailableQualityReport(repo.provider, repoIdentity, number, headSha, message),
                ),
              ),
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
