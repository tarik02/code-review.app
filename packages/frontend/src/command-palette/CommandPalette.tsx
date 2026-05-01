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
  };

function HomeCommandPalettes(props: HomeCommandPalettesProps) {
  const openContent = useCommandPaletteStore((state) => state.openContent);
  const openWorkflow = useCommandPaletteStore((state) => state.openWorkflow);

  useHotkey('Mod+P', (event) => {
    event.preventDefault();
    openContent();
  });

  useHotkey('Mod+Shift+P', (event) => {
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
        pendingReview={props.pendingReview}
        selectedPr={props.selectedPr}
        selectedPrKey={props.selectedPrKey}
        sidebarView={props.sidebarView}
        setSidebarView={props.setSidebarView}
      />
      <BrowsePalette localPullRequests={props.localPullRequests} />
    </>
  );
}

function SettingsCommandPalettes({ handleBackToPrs }: SettingsCommandPalettesProps) {
  const openWorkflow = useCommandPaletteStore((state) => state.openWorkflow);

  useHotkey('Mod+Shift+P', (event) => {
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
