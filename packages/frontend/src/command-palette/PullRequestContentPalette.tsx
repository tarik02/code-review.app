import type { ReviewThread } from '../lib/review-threads';
import { usePatchViewerStore } from '../stores/patch-viewer-store';
import type { SelectedPullRequest } from '../types/forge';
import { CommandPalette } from '../components/ui/command-palette';
import { useCommandPaletteStore } from './store';
import { buildPullRequestContentPaletteItems } from './items';

type PullRequestContentPaletteProps = {
  changedFiles: string[];
  patchViewerSessionKey: string | null;
  reviewThreads: ReviewThread[];
  selectedPr: SelectedPullRequest | null;
};

function PullRequestContentPalette({
  changedFiles,
  patchViewerSessionKey,
  reviewThreads,
  selectedPr,
}: PullRequestContentPaletteProps) {
  const open = useCommandPaletteStore((state) => state.contentOpen);
  const contentQuery = useCommandPaletteStore((state) => state.contentQuery);
  const requestNavigationIntent = usePatchViewerStore((state) => state.requestNavigationIntent);
  const setContentOpen = useCommandPaletteStore((state) => state.setContentOpen);
  const setContentQuery = useCommandPaletteStore((state) => state.setContentQuery);
  const items = selectedPr
    ? buildPullRequestContentPaletteItems({
        changedFiles,
        patchViewerSessionKey,
        requestNavigationIntent,
        reviewThreads,
      }).map((item) => ({
        ...item,
        onSelect: () => {
          item.onSelect();
          setContentOpen(false);
        },
      }))
    : [];

  return (
    <CommandPalette
      emptyDescription={
        selectedPr
          ? 'No files or comments matched the current query.'
          : 'Select a pull request or merge request first.'
      }
      emptyTitle={selectedPr ? 'No matches' : 'No pull request selected'}
      items={items}
      numberedShortcuts
      open={open}
      onOpenChange={setContentOpen}
      placeholder="Search files and comments"
      query={contentQuery}
      onQueryChange={setContentQuery}
      searchKeys={[
        { name: 'title', weight: 0.8 },
        { name: 'keywords', weight: 0.5 },
        { name: 'subtitle', weight: 0.3 },
      ]}
    />
  );
}

export { PullRequestContentPalette };
export type { PullRequestContentPaletteProps };
