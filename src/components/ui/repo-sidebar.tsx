import { Link } from "@tanstack/react-router";
import { Cog6ToothIcon, MoonIcon, PlusIcon, SunIcon } from "@heroicons/react/20/solid";
import { AccountFilterMenu, type AccountFilterMenuProps } from "./account-filter-menu";
import { Accordion } from "./accordion";
import { AppUpdater } from "./app-updater";
import { RepoSidebarItem, type PullRequestSummary } from "./repo-sidebar-item";
import { trpc } from "../../lib/trpc";
import type { RepoSummary } from "../../types/forge";
import type { CSSProperties, ReactNode } from "react";
import { TopBar } from "./top-bar";

type RepoSidebarProps = {
  repos: RepoSummary[];
  prsByRepo: Record<string, PullRequestSummary[]>;
  repoErrors: Record<string, string>;
  openValues: string[];
  selectedPrKey: string | null;
  isDark: boolean;
  accountFilter: AccountFilterMenuProps;
  emptyState?: ReactNode;
  onAddRepo: () => void;
  onAddPr: (repo: string) => void;
  onToggleTheme: () => void;
  onSelectPr: (repo: string, pullRequest: PullRequestSummary) => void;
  onRemovePr: (repo: string, pullRequest: PullRequestSummary) => void;
  onRepoOpenChange: (repo: string, open: boolean) => void;
};

function RepoSidebar({
  repos,
  prsByRepo,
  repoErrors,
  openValues,
  selectedPrKey,
  isDark,
  accountFilter,
  emptyState,
  onAddRepo,
  onAddPr,
  onToggleTheme,
  onSelectPr,
  onRemovePr,
  onRepoOpenChange,
}: RepoSidebarProps) {
  const dragRegionStyle = {
    WebkitAppRegion: "drag",
  } as CSSProperties & { WebkitAppRegion: string };
  const noDragRegionStyle = {
    WebkitAppRegion: "no-drag",
  } as CSSProperties & { WebkitAppRegion: string };

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-ink-300 bg-canvas md:border-b-0">
      <div className="sticky top-0 z-10 flex flex-col">
        <TopBar position="left">
          <div className="flex items-center gap-2.5 px-3 py-2.5 justify-end">
            <button
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
              onClick={onToggleTheme}
              style={noDragRegionStyle}
              type="button"
            >
              {isDark ? (
                <SunIcon className="size-5 shrink-0" />
              ) : (
                <MoonIcon className="size-5 shrink-0" />
              )}
            </button>
            <Link
              aria-label="Settings"
              className="inline-flex items-center justify-center rounded p-1 text-ink-500 transition hover:bg-canvasDark hover:text-ink-700"
              style={noDragRegionStyle}
              to="/settings/profiles"
            >
              <Cog6ToothIcon className="size-5 shrink-0" />
            </Link>
          </div>
          </TopBar>

        <div className="flex items-center gap-2.5 border-b border-neutral-300 dark:border-neutral-700 bg-canvas px-3 py-2.5 text-sm font-medium">
          Repositories
          <div className="ml-auto flex items-center gap-1.5">
            <AppUpdater
              buttonClassName="rounded-md border-0 bg-transparent px-2 py-1 text-xs font-medium hover:bg-canvasDark dark:bg-transparent dark:hover:bg-canvasDark"
              buttonLabel="Update now"
              containerClassName="flex-row items-center gap-0"
              showFeedback={false}
            />
            <AccountFilterMenu {...accountFilter} />
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hidden">
        {repos.length === 0 ? (
          emptyState ?? null
        ) : (
          <Accordion multiple value={openValues}>
            {repos.map((repo) => (
              <RepoSidebarItem
                key={repo.id}
                value={repo.id}
                avatarUrl={repo.avatarUrl}
                host={repo.host}
                nameWithOwner={repo.nameWithOwner}
                pullRequests={prsByRepo[repo.id]}
                error={repoErrors[repo.id]}
                selectedPrKey={selectedPrKey}
                onSelectPr={(name, pr) => onSelectPr(name, pr)}
                onAddPr={(name) => onAddPr(name)}
                onRemovePr={(name, pr) => onRemovePr(name, pr)}
                onOpenChange={(open) =>
                  onRepoOpenChange(repo.id, open)
                }
              />
            ))}
          </Accordion>
        )}
      </div>
    </aside>
  );
}

export { RepoSidebar };
export type { RepoSidebarProps, RepoSummary };
