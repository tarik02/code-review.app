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
  RepoIdentity,
  RepoSummary,
} from "../../types/forge";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { TopBar } from "./top-bar";
import {
  repoIdentity,
  repoIdentityKey,
} from "../../lib/repo-identity";

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
  onAddPr: (repo: RepoIdentity) => void;
  onViewChange: (view: SidebarPullRequestView) => void;
  onSelectPr: (repo: RepoIdentity, pullRequest: PullRequestSummary) => void;
  onTrackPr: (repo: RepoIdentity, pullRequest: PullRequestSummary) => void;
  onRemovePr: (repo: RepoIdentity, pullRequest: PullRequestSummary) => void;
  onRepoOpenChange: (repo: RepoIdentity, open: boolean) => void;
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
        const error = repoErrors[repoIdentityKey(repo)];
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
                key={`${repoIdentityKey(repo)}#${pullRequest.number}`}
                repo={repoIdentity(repo)}
                provider={repo.provider}
                pullRequest={pullRequest}
                selectedPrKey={selectedPrKey}
                isTrackedView={false}
                isTracked={
                  trackedPullRequestNumbersByRepo[repoIdentityKey(repo)]?.has(
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
                key={repoIdentityKey(repo)}
              >
                {getRepoLabel(repo)}: {error}
              </div>
            ))}
          </div>
        ) : (
          <Accordion multiple value={openValues}>
            {repos.map((repo) => (
              <RepoSidebarItem
                key={repoIdentityKey(repo)}
                value={repoIdentityKey(repo)}
                repo={repoIdentity(repo)}
                provider={repo.provider}
                avatarUrl={repo.avatarUrl}
                host={repo.host}
                nameWithOwner={repo.nameWithOwner}
                pullRequests={prsByRepo[repoIdentityKey(repo)]}
                error={repoErrors[repoIdentityKey(repo)]}
                view={view}
                selectedPrKey={selectedPrKey}
                trackedPullRequestNumbers={
                  trackedPullRequestNumbersByRepo[repoIdentityKey(repo)]
                }
                onSelectPr={(identity, pr) => onSelectPr(identity, pr)}
                onAddPr={(identity) => onAddPr(identity)}
                onTrackPr={(identity, pr) => onTrackPr(identity, pr)}
                onRemovePr={(identity, pr) => onRemovePr(identity, pr)}
                onOpenChange={(open) => onRepoOpenChange(repo, open)}
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
