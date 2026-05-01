import { useNavigate } from '@tanstack/react-router';
import {
  CheckIcon,
  FilterXIcon,
  GitPullRequestIcon,
  MessageSquareMoreIcon,
  PanelsTopLeftIcon,
  PaintbrushIcon,
  Settings2Icon,
  UserCircle2Icon,
} from 'lucide-react';
import {
  usePullRequestApprovalMutations,
  usePullRequestReviewCommentMutations,
} from '../hooks/use-forge-queries';
import { useEnabledProviderAccounts } from '../hooks/use-enabled-provider-accounts';
import { useMainAppViewStore } from '../stores/main-app-view-store';
import { usePatchViewerStore } from '../stores/patch-viewer-store';
import { useReviewCommentEditorStore } from '../stores/review-comment-editor-store';
import type {
  PendingReviewState,
  PullRequest,
  PullRequestApprovalState,
  PullRequestSummary,
  SelectedPullRequest,
} from '../types/forge';
import { Button } from '../components/ui/button';
import { CommandPalette, type CommandPaletteItem } from '../components/ui/command-palette';
import { ActiveBadge } from './items';
import { useCommandPaletteStore } from './store';
import type { SidebarPullRequestView } from './types';

type HomeWorkflowPaletteProps = {
  approvalState: PullRequestApprovalState | null;
  diffSessionKey: string | null;
  pendingReview: PendingReviewState;
  selectedPr: SelectedPullRequest | null;
  selectedPullRequestSummary: PullRequestSummary | null;
  selectedPrKey: string | null;
  sidebarView: SidebarPullRequestView;
  setSidebarView: (view: SidebarPullRequestView) => void;
};

function readReviewCapabilities(pullRequest: PullRequestSummary | PullRequest | null) {
  if (!pullRequest || !('canApprove' in pullRequest) || !('canRequestChanges' in pullRequest)) {
    return { canApprove: true, canRequestChanges: true };
  }

  return {
    canApprove: pullRequest.canApprove,
    canRequestChanges: pullRequest.canRequestChanges,
  };
}

function HomeWorkflowPalette({
  approvalState,
  diffSessionKey,
  pendingReview,
  selectedPr,
  selectedPullRequestSummary,
  selectedPrKey,
  sidebarView,
  setSidebarView,
}: HomeWorkflowPaletteProps) {
  const navigate = useNavigate();
  const { enabledAccountIds } = useEnabledProviderAccounts();
  const openBrowse = useCommandPaletteStore((state) => state.openBrowse);
  const open = useCommandPaletteStore((state) => state.workflowOpen);
  const openNewEditor = useReviewCommentEditorStore((state) => state.openNewEditor);
  const requestNavigationIntent = usePatchViewerStore((state) => state.requestNavigationIntent);
  const setWorkflowOpen = useCommandPaletteStore((state) => state.setWorkflowOpen);
  const clearProfileFilter = useMainAppViewStore((state) => state.clearProfileFilter);
  const clearRepoFilter = useMainAppViewStore((state) => state.clearRepoFilter);
  const profileFilterAccountId = useMainAppViewStore((state) => state.profileFilterAccountId);
  const repoFilterKey = useMainAppViewStore((state) => state.repoFilterKey);
  const { approveMutation, removeApprovalMutation } = usePullRequestApprovalMutations(selectedPr);
  const { discardPendingReviewMutation, publishPendingReviewMutation } =
    usePullRequestReviewCommentMutations(selectedPr);
  const submitReviewMode = useCommandPaletteStore((state) => state.workflowSubmitReviewMode);
  const setSubmitReviewMode = useCommandPaletteStore((state) => state.setWorkflowSubmitReviewMode);
  const submitAction = useCommandPaletteStore((state) => state.workflowSubmitAction);
  const setSubmitAction = useCommandPaletteStore((state) => state.setWorkflowSubmitAction);
  const submitSummary = useCommandPaletteStore((state) => state.workflowSubmitSummary);
  const setSubmitSummary = useCommandPaletteStore((state) => state.setWorkflowSubmitSummary);
  const workflowQuery = useCommandPaletteStore((state) => state.workflowQuery);
  const setWorkflowQuery = useCommandPaletteStore((state) => state.setWorkflowQuery);
  const { canApprove, canRequestChanges } = readReviewCapabilities(selectedPullRequestSummary);
  const effectiveSubmitAction =
    submitAction === 'approve' && !canApprove
      ? 'comment'
      : submitAction === 'request_changes' && !canRequestChanges
        ? 'comment'
        : submitAction;

  const items = (() => {
    if (submitReviewMode) {
      return [
        {
          id: 'submit-review-comment',
          group: 'Review type',
          title: 'Comment',
          badge:
            effectiveSubmitAction === 'comment' ? <CheckIcon className="size-3.5" /> : undefined,
          icon: <MessageSquareMoreIcon className="size-4" />,
          onSelect: () => setSubmitAction('comment'),
        },
        {
          id: 'submit-review-approve',
          group: 'Review type',
          title: 'Approve',
          badge:
            effectiveSubmitAction === 'approve' ? <CheckIcon className="size-3.5" /> : undefined,
          disabled: !canApprove,
          icon: <CheckIcon className="size-4" />,
          onSelect: () => setSubmitAction('approve'),
        },
        {
          id: 'submit-review-request-changes',
          group: 'Review type',
          title: 'Request changes',
          badge:
            effectiveSubmitAction === 'request_changes' ? (
              <CheckIcon className="size-3.5" />
            ) : undefined,
          disabled: !canRequestChanges,
          icon: <FilterXIcon className="size-4" />,
          onSelect: () => setSubmitAction('request_changes'),
        },
      ] satisfies CommandPaletteItem[];
    }

    const nextItems: CommandPaletteItem[] = [
      {
        id: 'section-overview',
        group: 'Sections',
        title: 'Overview',
        icon: <PanelsTopLeftIcon className="size-4" />,
        badge: sidebarView === 'overview' ? <ActiveBadge /> : undefined,
        onSelect: () => {
          setSidebarView('overview');
          setWorkflowOpen(false);
        },
      },
      {
        id: 'section-tracked',
        group: 'Sections',
        title: 'Tracked items',
        icon: <GitPullRequestIcon className="size-4" />,
        badge: sidebarView === 'tracked' ? <ActiveBadge /> : undefined,
        onSelect: () => {
          setSidebarView('tracked');
          setWorkflowOpen(false);
        },
      },
      {
        id: 'section-recent',
        group: 'Sections',
        title: 'Recent items',
        icon: <GitPullRequestIcon className="size-4" />,
        badge: sidebarView === 'recent' ? <ActiveBadge /> : undefined,
        onSelect: () => {
          setSidebarView('recent');
          setWorkflowOpen(false);
        },
      },
      {
        id: 'section-settings',
        group: 'Sections',
        title: 'Settings',
        icon: <Settings2Icon className="size-4" />,
        onSelect: () => {
          void navigate({ to: '/settings/appearance' });
          setWorkflowOpen(false);
        },
      },
      {
        id: 'section-appearance',
        group: 'Sections',
        title: 'Appearance',
        icon: <PaintbrushIcon className="size-4" />,
        onSelect: () => {
          void navigate({ to: '/settings/appearance' });
          setWorkflowOpen(false);
        },
      },
      {
        id: 'section-profiles',
        group: 'Sections',
        title: 'Profiles',
        icon: <UserCircle2Icon className="size-4" />,
        onSelect: () => {
          void navigate({ to: '/settings/profiles' });
          setWorkflowOpen(false);
        },
      },
      {
        id: 'section-review',
        group: 'Sections',
        title: 'Review',
        icon: <MessageSquareMoreIcon className="size-4" />,
        onSelect: () => {
          void navigate({ to: '/settings/review' });
          setWorkflowOpen(false);
        },
      },
      {
        id: 'action-add-tracked-pr',
        group: 'Actions',
        title: 'Add tracked PR/MR',
        icon: <GitPullRequestIcon className="size-4" />,
        shortcut: 'Mod+K',
        onSelect: () => {
          openBrowse(enabledAccountIds);
        },
      },
    ];

    if (profileFilterAccountId) {
      nextItems.push({
        id: 'action-clear-profile-filter',
        group: 'Actions',
        title: 'Clear profile filter',
        icon: <FilterXIcon className="size-4" />,
        onSelect: () => {
          clearProfileFilter();
          setWorkflowOpen(false);
        },
      });
    }

    if (repoFilterKey) {
      nextItems.push({
        id: 'action-clear-repo-filter',
        group: 'Actions',
        title: 'Clear repo filter',
        icon: <FilterXIcon className="size-4" />,
        onSelect: () => {
          clearRepoFilter();
          setWorkflowOpen(false);
        },
      });
    }

    if (selectedPr && canApprove && !approvalState?.viewerApproved) {
      nextItems.push({
        id: 'action-approve',
        group: 'Actions',
        title: 'Approve current PR/MR',
        icon: <CheckIcon className="size-4" />,
        onSelect: () => {
          void approveMutation.mutateAsync(selectedPr).then(() => setWorkflowOpen(false));
        },
      });
    }

    if (selectedPr && approvalState?.viewerApproved) {
      nextItems.push({
        id: 'action-remove-approval',
        group: 'Actions',
        title: 'Remove approval',
        icon: <FilterXIcon className="size-4" />,
        onSelect: () => {
          void removeApprovalMutation.mutateAsync(selectedPr).then(() => setWorkflowOpen(false));
        },
      });
    }

    if (selectedPr && selectedPrKey && diffSessionKey) {
      nextItems.push({
        id: 'action-new-global-comment',
        group: 'Actions',
        title: 'New global comment',
        icon: <MessageSquareMoreIcon className="size-4" />,
        onSelect: () => {
          openNewEditor(selectedPrKey, { type: 'global' });
          requestNavigationIntent(diffSessionKey, {
            kind: 'global-comments',
          });
          setWorkflowOpen(false);
        },
      });
    }

    if (selectedPr && pendingReview.comments.length > 0) {
      nextItems.push(
        {
          id: 'action-discard-review',
          group: 'Actions',
          title: 'Discard pending review',
          icon: <FilterXIcon className="size-4" />,
          onSelect: () => {
            void discardPendingReviewMutation
              .mutateAsync(selectedPr)
              .then(() => setWorkflowOpen(false));
          },
        },
        {
          id: 'action-submit-review',
          group: 'Actions',
          title: 'Submit pending review',
          icon: <CheckIcon className="size-4" />,
          onSelect: () => setSubmitReviewMode(true),
        },
      );
    }

    return nextItems;
  })();

  return (
    <CommandPalette
      emptyTitle="No sections or actions available"
      filterMode={submitReviewMode ? 'none' : 'fuse'}
      footer={
        submitReviewMode ? (
          <div className="flex items-center justify-between gap-3">
            <Button
              className="justify-center"
              size="sm"
              variant="ghost"
              onClick={() => setSubmitReviewMode(false)}
              type="button"
            >
              Back
            </Button>
            <Button
              className="justify-center"
              size="sm"
              onClick={() => {
                if (!selectedPr) {
                  return;
                }

                void publishPendingReviewMutation
                  .mutateAsync({
                    ...selectedPr,
                    action: effectiveSubmitAction,
                    summary: submitSummary.trim() || undefined,
                  })
                  .then(() => setWorkflowOpen(false));
              }}
              type="button"
            >
              Confirm submit
            </Button>
          </div>
        ) : null
      }
      items={items}
      open={open}
      onOpenChange={setWorkflowOpen}
      placeholder={submitReviewMode ? 'Optional notes' : 'Jump to sections and actions'}
      query={submitReviewMode ? submitSummary : workflowQuery}
      onQueryChange={submitReviewMode ? setSubmitSummary : setWorkflowQuery}
    />
  );
}

export { HomeWorkflowPalette };
export type { HomeWorkflowPaletteProps };
