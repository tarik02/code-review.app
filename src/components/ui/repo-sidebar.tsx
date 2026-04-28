import { Link } from "@tanstack/react-router";
import { Cog6ToothIcon, PlusIcon } from "@heroicons/react/20/solid";
import { Accordion } from "./accordion";
import { AppUpdater } from "./app-updater";
import {
  PullRequestSidebarRow,
  RepoSidebarItem,
  type PullRequestSummary,
  type SidebarPullRequestView,
} from "./repo-sidebar-item";
import type {
  OverviewPullRequestSummary,
  RepoSummary,
} from "../../types/forge";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { TopBar } from "./top-bar";

type RepoSidebarProps = {
  repos: RepoSummary[];
  prsByRepo: Record<string, PullRequestSummary[]>;
  repoErrors: Record<string, string>;
  overviewPullRequests: OverviewPullRequestSummary[];
  overviewErrors: string[];
  isOverviewLoading: boolean;
  overviewStatusMessage: string | null;
  openValues: string[];
  view: SidebarPullRequestView;
  selectedPrKey: string | null;
  trackedPullRequestNumbersByRepo: Record<string, Set<number>>;
  emptyState?: ReactNode;
  onAddRepo: () => void;
  onAddPr: (repo: string) => void;
  onViewChange: (view: SidebarPullRequestView) => void;
  onSelectPr: (repo: string, pullRequest: PullRequestSummary) => void;
  onTrackPr: (repo: string, pullRequest: PullRequestSummary) => void;
  onRemovePr: (repo: string, pullRequest: PullRequestSummary) => void;
  onRepoOpenChange: (repo: string, open: boolean) => void;
};

function toTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getRepoLabel(repo: RepoSummary) {
  if (repo.host === "github.com") {
    return repo.nameWithOwner;
  }
  return `${repo.nameWithOwner} · ${repo.host}`;
}

function RepoSidebar({
  repos,
  prsByRepo,
  repoErrors,
  overviewPullRequests,
  overviewErrors,
  isOverviewLoading,
  overviewStatusMessage,
  openValues,
  view,
  selectedPrKey,
  trackedPullRequestNumbersByRepo,
  emptyState,
  onAddRepo,
  onAddPr,
  onViewChange,
  onSelectPr,
  onTrackPr,
  onRemovePr,
  onRepoOpenChange,
}: RepoSidebarProps) {
  const noDragRegionStyle = {
    WebkitAppRegion: "no-drag",
  } as CSSProperties & { WebkitAppRegion: string };
  const sortedOverviewPullRequests = useMemo(
    () =>
      [...overviewPullRequests].sort(
        (a, b) =>
          toTimestamp(b.pullRequest.updatedAt) -
          toTimestamp(a.pullRequest.updatedAt),
      ),
    [overviewPullRequests],
  );
  const repoErrorEntries = useMemo(
    () =>
      repos.flatMap((repo) => {
        const error = repoErrors[repo.id];
        return error ? [{ repo, error }] : [];
      }),
    [repoErrors, repos],
  );
  const isOverview = view === "overview";

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-ink-300 bg-canvas md:border-b-0">
      <div className="sticky top-0 z-10 flex flex-col">
        <TopBar
          position="left"
          className="cursor-grab app-region-drag flex items-center justify-between gap-2.5 px-3"
        >
          <div>code-review.app</div>

          <div className="flex items-center gap-2.5">
            <Link
              aria-label="Settings"
              className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
              style={noDragRegionStyle}
              to="/settings/appearance"
            >
              <Cog6ToothIcon className="size-5 shrink-0" />
            </Link>
          </div>
        </TopBar>

        <div className="flex items-center gap-2.5 border-b border-neutral-300 dark:border-neutral-700 bg-canvas px-3 py-2.5 text-sm font-medium">
          {isOverview ? "Pull requests" : "Repositories"}
          <div className="ml-auto flex items-center gap-1.5">
            <AppUpdater
              buttonClassName="rounded-md border-0 bg-transparent px-2 py-1 text-xs font-medium hover:bg-canvasDark dark:bg-transparent dark:hover:bg-canvasDark"
              buttonLabel="Update now"
              containerClassName="flex-row items-center gap-0"
              showFeedback={false}
            />
          </div>
          <button
            aria-label="Add repo"
            className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
            onClick={onAddRepo}
            style={noDragRegionStyle}
            type="button"
          >
            <PlusIcon className="size-5 shrink-0" />
          </button>
        </div>
        <div className="border-b border-neutral-300 bg-canvas px-3 py-2 dark:border-neutral-700">
          <div
            className="grid grid-cols-2 rounded-md bg-canvasDark p-0.5 text-xs font-medium text-ink-600"
            style={noDragRegionStyle}
          >
            {(["overview", "tracked"] as const).map((candidate) => {
              const isSelected = view === candidate;
              return (
                <button
                  aria-pressed={isSelected}
                  className={[
                    "rounded px-2 py-1.5 transition",
                    isSelected
                      ? "bg-surface text-ink-800 shadow-sm"
                      : "text-ink-500 hover:text-ink-800",
                  ].join(" ")}
                  key={candidate}
                  onClick={() => onViewChange(candidate)}
                  type="button"
                >
                  {candidate}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hidden">
        {!isOverview && repos.length === 0 ? (
          (emptyState ?? null)
        ) : isOverview ? (
          <div className="flex flex-col">
            {sortedOverviewPullRequests.length === 0 &&
            overviewErrors.length === 0 &&
            repoErrorEntries.length === 0 &&
            !isOverviewLoading ? (
              <div className="px-3 py-2.5 text-sm text-ink-500">
                {overviewStatusMessage ?? "No open PRs or MRs."}
              </div>
            ) : null}
            {sortedOverviewPullRequests.length === 0 && isOverviewLoading ? (
              <div className="px-3 py-2.5 text-sm text-ink-500">
                Loading pull requests...
              </div>
            ) : null}
            {sortedOverviewPullRequests.map(({ repo, pullRequest }) => (
              <PullRequestSidebarRow
                key={`${repo.id}#${pullRequest.number}`}
                repoId={repo.id}
                provider={repo.provider}
                pullRequest={pullRequest}
                selectedPrKey={selectedPrKey}
                isTrackedView={false}
                isTracked={
                  trackedPullRequestNumbersByRepo[repo.id]?.has(
                    pullRequest.number,
                  ) ?? false
                }
                repoLabel={getRepoLabel(repo)}
                onSelectPr={onSelectPr}
                onTrackPr={onTrackPr}
                onRemovePr={onRemovePr}
              />
            ))}
            {overviewErrors.map((error, index) => (
              <div
                className="px-3 py-2.5 text-sm text-danger-600"
                key={`${index}:${error}`}
              >
                {error}
              </div>
            ))}
            {repoErrorEntries.map(({ repo, error }) => (
              <div
                className="px-3 py-2.5 text-sm text-danger-600"
                key={repo.id}
              >
                {getRepoLabel(repo)}: {error}
              </div>
            ))}
          </div>
        ) : (
          <Accordion multiple value={openValues}>
            {repos.map((repo) => (
              <RepoSidebarItem
                key={repo.id}
                value={repo.id}
                provider={repo.provider}
                avatarUrl={repo.avatarUrl}
                host={repo.host}
                nameWithOwner={repo.nameWithOwner}
                pullRequests={prsByRepo[repo.id]}
                error={repoErrors[repo.id]}
                view={view}
                selectedPrKey={selectedPrKey}
                trackedPullRequestNumbers={
                  trackedPullRequestNumbersByRepo[repo.id]
                }
                onSelectPr={(name, pr) => onSelectPr(name, pr)}
                onAddPr={(name) => onAddPr(name)}
                onTrackPr={(name, pr) => onTrackPr(name, pr)}
                onRemovePr={(name, pr) => onRemovePr(name, pr)}
                onOpenChange={(open) => onRepoOpenChange(repo.id, open)}
              />
            ))}
          </Accordion>
        )}
      </div>
    </aside>
  );
}

export { RepoSidebar };
export type { RepoSidebarProps, RepoSummary, SidebarPullRequestView };
