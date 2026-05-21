import { useHotkey } from '@tanstack/react-hotkeys';
import type { OverviewPullRequestSummary } from '../types/forge';
import type { PullRequestContentPaletteProps } from './PullRequestContentPalette';
import { PullRequestContentPalette } from './PullRequestContentPalette';
import { BrowsePalette } from './BrowsePalette';
import { HomeWorkflowPalette, type HomeWorkflowPaletteProps } from './HomeWorkflowPalette';
import {
  SettingsWorkflowPalette,
  type SettingsCommandPalettesProps,
} from './SettingsWorkflowPalette';
import { useCommandPaletteStore } from './store';

type HomeCommandPalettesProps = PullRequestContentPaletteProps &
  HomeWorkflowPaletteProps & {
    localPullRequests: OverviewPullRequestSummary[];
    trackedPullRequestNumbersByRepo: Record<string, Set<number>>;
    onToggleTrackedPullRequest: (
      entry: OverviewPullRequestSummary,
      tracked: boolean,
    ) => void | Promise<void>;
  };

function HomeCommandPalettes(props: HomeCommandPalettesProps) {
  const openContent = useCommandPaletteStore((state) => state.openContent);
  const openWorkflow = useCommandPaletteStore((state) => state.openWorkflow);

  useHotkey('Mod+P', (event) => {
    event.preventDefault();
    openContent();
  });

  useHotkey('/', (event) => {
    event.preventDefault();
    openWorkflow();
  });

  return (
    <>
      <PullRequestContentPalette
        changedFiles={props.changedFiles}
        patchViewerSessionKey={props.patchViewerSessionKey}
        reviewThreads={props.reviewThreads}
        selectedPr={props.selectedPr}
      />
      <HomeWorkflowPalette
        approvalState={props.approvalState}
        diffSessionKey={props.diffSessionKey}
        isRefreshingPullRequest={props.isRefreshingPullRequest}
        pendingReview={props.pendingReview}
        selectedPr={props.selectedPr}
        selectedPullRequestSummary={props.selectedPullRequestSummary}
        selectedPrKey={props.selectedPrKey}
        sidebarView={props.sidebarView}
        onApproveError={props.onApproveError}
        onRefreshPullRequest={props.onRefreshPullRequest}
        setSidebarView={props.setSidebarView}
      />
      <BrowsePalette
        localPullRequests={props.localPullRequests}
        trackedPullRequestNumbersByRepo={props.trackedPullRequestNumbersByRepo}
        onToggleTrackedPullRequest={props.onToggleTrackedPullRequest}
      />
    </>
  );
}

function SettingsCommandPalettes({ handleBackToPrs }: SettingsCommandPalettesProps) {
  const openWorkflow = useCommandPaletteStore((state) => state.openWorkflow);

  useHotkey('/', (event) => {
    event.preventDefault();
    openWorkflow();
  });

  return (
    <>
      <SettingsWorkflowPalette handleBackToPrs={handleBackToPrs} />
      <BrowsePalette />
    </>
  );
}

export { HomeCommandPalettes, SettingsCommandPalettes };
