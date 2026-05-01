import { Link } from '@tanstack/react-router';
import { Cog6ToothIcon } from '@heroicons/react/20/solid';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { repoIdentityKey } from '../../lib/repo-identity';
import type {
  OverviewPullRequestSummary,
  PullRequestSummary,
  RepoSummary,
} from '../../types/forge';
import { AppUpdater } from './app-updater';
import { CommandPaletteLaunchers } from '../../command-palette/Launchers';
import { PullRequestListCard, getRepoLabel } from './pull-request-list-card';
import { PullRequestTrackButton } from './pull-request-track-button';
import { ScrollArea } from './scroll-area';
import { TopBar } from './top-bar';
import { TrackedPullRequestList } from './tracked-pull-request-list';

type SidebarPullRequestView = 'overview' | 'recent' | 'tracked';

type RepoSidebarProps = {
  activeFilters?: Array<{
    id: string;
    label: string;
    onClear: () => void;
  }>;
  repos: RepoSummary[];
  repoErrors: Record<string, string>;
  overviewPullRequests: OverviewPullRequestSummary[];
  recentPullRequests: OverviewPullRequestSummary[];
  trackedPullRequests: OverviewPullRequestSummary[];
  overviewErrors: string[];
  isOverviewLoading: boolean;
  overviewStatusMessage: string | null;
  pinnedEntry: OverviewPullRequestSummary | null;
  view: SidebarPullRequestView;
  selectedPrKey: string | null;
  trackedRepoCount: number;
  trackedPullRequestNumbersByRepo: Record<string, Set<number>>;
  emptyState?: ReactNode;
  onViewChange: (view: SidebarPullRequestView) => void;
  onSelectPr: (repo: RepoSummary, pullRequest: PullRequestSummary) => void;
  onTrackPr: (repo: RepoSummary, pullRequest: PullRequestSummary) => void;
  onRemovePr: (repo: RepoSummary, pullRequest: PullRequestSummary) => void;
  onReorderTrackedPullRequests: (entries: OverviewPullRequestSummary[]) => void | Promise<void>;
};

function toTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function RepoSidebar({
  repos,
  activeFilters = [],
  repoErrors,
  overviewPullRequests,
  recentPullRequests,
  trackedPullRequests,
  overviewErrors,
  isOverviewLoading,
  overviewStatusMessage,
  pinnedEntry,
  view,
  selectedPrKey,
  trackedRepoCount,
  trackedPullRequestNumbersByRepo,
  emptyState,
  onViewChange,
  onSelectPr,
  onTrackPr,
  onRemovePr,
  onReorderTrackedPullRequests,
}: RepoSidebarProps) {
  const noDragRegionStyle = {
    WebkitAppRegion: 'no-drag',
  } as CSSProperties & { WebkitAppRegion: string };
  const sortedOverviewPullRequests = useMemo(
    () =>
      [...overviewPullRequests].sort(
        (a, b) => toTimestamp(b.pullRequest.updatedAt) - toTimestamp(a.pullRequest.updatedAt),
      ),
    [overviewPullRequests],
  );
  const sortedRecentPullRequests = useMemo(
    () =>
      [...recentPullRequests].sort(
        (a, b) => toTimestamp(b.pullRequest.updatedAt) - toTimestamp(a.pullRequest.updatedAt),
      ),
    [recentPullRequests],
  );
  const repoErrorEntries = useMemo(
    () =>
      repos.flatMap((repo) => {
        const error = repoErrors[repoIdentityKey(repo)];
        return error ? [{ repo, error }] : [];
      }),
    [repoErrors, repos],
  );
  const isOverview = view === 'overview';
  const isRecent = view === 'recent';

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-ink-300 bg-canvas md:border-b-0">
      <div className="sticky top-0 z-10 flex flex-col">
        <TopBar position="left" className="cursor-grab app-region-drag flex">
          <div className="grow flex items-center justify-between gap-2.5 px-3">
            <div style={noDragRegionStyle}>
              <CommandPaletteLaunchers scope="home" />
            </div>

            <div className="flex items-center gap-2.5" style={noDragRegionStyle}>
              <div>
                <AppUpdater
                  buttonClassName="rounded-md border-0 bg-transparent px-2 py-1 text-xs font-medium hover:bg-canvasDark dark:bg-transparent dark:hover:bg-canvasDark"
                  buttonLabel="Update now"
                  containerClassName="flex-row items-center gap-0"
                  showFeedback={false}
                />
              </div>
              <Link
                aria-label="Settings"
                className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
                style={noDragRegionStyle}
                to="/settings/appearance"
              >
                <Cog6ToothIcon className="size-5 shrink-0" />
              </Link>
            </div>
          </div>
        </TopBar>

        <div className="border-b border-neutral-300 bg-canvas px-3 py-2 dark:border-neutral-700">
          <div
            className="grid grid-cols-3 rounded-md bg-canvasDark p-0.5 text-xs font-medium text-ink-600"
            style={noDragRegionStyle}
          >
            {(['overview', 'recent', 'tracked'] as const).map((candidate) => {
              const isSelected = view === candidate;
              return (
                <button
                  aria-pressed={isSelected}
                  className={[
                    'rounded px-2 py-1.5 transition',
                    isSelected
                      ? 'bg-surface text-ink-800 shadow-sm'
                      : 'text-ink-500 hover:text-ink-800',
                  ].join(' ')}
                  key={candidate}
                  onClick={() => onViewChange(candidate)}
                  type="button"
                >
                  {candidate}
                </button>
              );
            })}
          </div>
          {activeFilters.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5" style={noDragRegionStyle}>
              {activeFilters.map((filter) => (
                <button
                  className="inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-surface px-2 py-1 text-[11px] font-medium text-ink-700 transition hover:border-neutral-400 dark:border-neutral-700"
                  key={filter.id}
                  onClick={filter.onClear}
                  type="button"
                >
                  <span>{filter.label}</span>
                  <span aria-hidden="true" className="text-ink-500">
                    x
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <ScrollArea
        className="min-h-0 flex-1"
        contentClassName="min-h-full"
        orientation="vertical"
        viewportClassName="bg-canvas"
      >
        {view === 'tracked' &&
        trackedRepoCount === 0 &&
        trackedPullRequests.length === 0 &&
        !pinnedEntry ? (
          (emptyState ?? null)
        ) : isOverview || isRecent ? (
          <div className="flex flex-col">
            {pinnedEntry ? (
              <div className="mb-2">
                <PullRequestListCard
                  className="border-b border-t border-neutral-300/70 dark:border-neutral-700/70"
                  repo={pinnedEntry.repo}
                  pullRequest={pinnedEntry.pullRequest}
                  selectedPrKey={selectedPrKey}
                  repoLabel={getRepoLabel(pinnedEntry.repo)}
                  trailingActions={
                    <PullRequestTrackButton
                      tracked={
                        trackedPullRequestNumbersByRepo[repoIdentityKey(pinnedEntry.repo)]?.has(
                          pinnedEntry.pullRequest.number,
                        ) ?? false
                      }
                      onClick={() => {
                        const isTracked =
                          trackedPullRequestNumbersByRepo[repoIdentityKey(pinnedEntry.repo)]?.has(
                            pinnedEntry.pullRequest.number,
                          ) ?? false;

                        if (isTracked) {
                          onRemovePr(pinnedEntry.repo, pinnedEntry.pullRequest);
                          return;
                        }

                        onTrackPr(pinnedEntry.repo, pinnedEntry.pullRequest);
                      }}
                    />
                  }
                  trailingActionsAlwaysVisible
                  onSelectPr={onSelectPr}
                />
              </div>
            ) : null}
            {(isOverview ? sortedOverviewPullRequests : sortedRecentPullRequests).length === 0 &&
            (!isOverview || overviewErrors.length === 0) &&
            repoErrorEntries.length === 0 &&
            (!isOverview || !isOverviewLoading) ? (
              <div className="px-3 py-2.5 text-sm text-ink-500">
                {isOverview
                  ? (overviewStatusMessage ?? 'No open PRs or MRs.')
                  : 'No recent PRs or MRs.'}
              </div>
            ) : null}
            {isOverview && sortedOverviewPullRequests.length === 0 && isOverviewLoading ? (
              <div className="px-3 py-2.5 text-sm text-ink-500">Loading pull requests...</div>
            ) : null}
            {(isOverview ? sortedOverviewPullRequests : sortedRecentPullRequests).map(
              ({ repo, pullRequest }) => (
                <PullRequestListCard
                  key={`${repoIdentityKey(repo)}#${pullRequest.number}`}
                  repo={repo}
                  pullRequest={pullRequest}
                  selectedPrKey={selectedPrKey}
                  repoLabel={getRepoLabel(repo)}
                  onSelectPr={onSelectPr}
                  trailingActions={
                    <PullRequestTrackButton
                      tracked={
                        trackedPullRequestNumbersByRepo[repoIdentityKey(repo)]?.has(
                          pullRequest.number,
                        ) ?? false
                      }
                      onClick={() => {
                        const isTracked =
                          trackedPullRequestNumbersByRepo[repoIdentityKey(repo)]?.has(
                            pullRequest.number,
                          ) ?? false;

                        if (isTracked) {
                          onRemovePr(repo, pullRequest);
                          return;
                        }

                        onTrackPr(repo, pullRequest);
                      }}
                    />
                  }
                  trailingActionsAlwaysVisible
                />
              ),
            )}
            {isOverview
              ? overviewErrors.map((error, index) => (
                  <div className="px-3 py-2.5 text-sm text-danger-600" key={`${index}:${error}`}>
                    {error}
                  </div>
                ))
              : null}
            {isOverview
              ? repoErrorEntries.map(({ repo, error }) => (
                  <div className="px-3 py-2.5 text-sm text-danger-600" key={repoIdentityKey(repo)}>
                    {getRepoLabel(repo)}: {error}
                  </div>
                ))
              : null}
          </div>
        ) : (
          <div className="flex flex-col">
            {pinnedEntry ? (
              <div className="mb-2">
                <PullRequestListCard
                  className="border-b border-t border-neutral-300/70 dark:border-neutral-700/70"
                  repo={pinnedEntry.repo}
                  pullRequest={pinnedEntry.pullRequest}
                  selectedPrKey={selectedPrKey}
                  repoLabel={getRepoLabel(pinnedEntry.repo)}
                  trailingActions={
                    <PullRequestTrackButton
                      tracked={
                        trackedPullRequestNumbersByRepo[repoIdentityKey(pinnedEntry.repo)]?.has(
                          pinnedEntry.pullRequest.number,
                        ) ?? false
                      }
                      onClick={() => {
                        const isTracked =
                          trackedPullRequestNumbersByRepo[repoIdentityKey(pinnedEntry.repo)]?.has(
                            pinnedEntry.pullRequest.number,
                          ) ?? false;

                        if (isTracked) {
                          onRemovePr(pinnedEntry.repo, pinnedEntry.pullRequest);
                          return;
                        }

                        onTrackPr(pinnedEntry.repo, pinnedEntry.pullRequest);
                      }}
                    />
                  }
                  trailingActionsAlwaysVisible
                  onSelectPr={onSelectPr}
                />
              </div>
            ) : null}
            <TrackedPullRequestList
              entries={trackedPullRequests}
              repoErrors={repoErrorEntries}
              selectedPrKey={selectedPrKey}
              trackedPullRequestNumbersByRepo={trackedPullRequestNumbersByRepo}
              onRemovePr={onRemovePr}
              onTrackPr={onTrackPr}
              onReorder={onReorderTrackedPullRequests}
              onSelectPr={onSelectPr}
            />
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}

export { RepoSidebar };
export type { RepoSidebarProps, RepoSummary, SidebarPullRequestView };
