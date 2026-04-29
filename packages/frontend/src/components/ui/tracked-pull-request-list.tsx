import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { Bars3Icon } from "@heroicons/react/20/solid";
import { ArchiveBoxXMarkIcon } from "@heroicons/react/24/outline";
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { pointerOutsideOfPreview } from "@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { reorder } from "@atlaskit/pragmatic-drag-and-drop/reorder";
import { cx } from "../../lib/cx";
import {
  toTrackedPullRequestOrderEntry,
  trackedPullRequestOrderEntryKey,
  type TrackedPullRequestListEntry,
} from "../../lib/tracked-pull-request-order";
import type { PullRequestSummary, RepoSummary } from "../../types/forge";
import { PullRequestListCard, getRepoLabel } from "./pull-request-list-card";

type TrackedPullRequestListProps = {
  entries: TrackedPullRequestListEntry[];
  repoErrors: Array<{ repo: RepoSummary; error: string }>;
  selectedPrKey: string | null;
  emptyState?: string;
  onSelectPr: (repo: RepoSummary, pullRequest: PullRequestSummary) => void;
  onRemovePr: (repo: RepoSummary, pullRequest: PullRequestSummary) => void;
  onReorder: (entries: TrackedPullRequestListEntry[]) => void | Promise<void>;
};

const trackedPullRequestListItemKey = Symbol("trackedPullRequestListItem");

type TrackedPullRequestListItemData = {
  [trackedPullRequestListItemKey]: true;
  entryKey: string;
  index: number;
  instanceId: symbol;
};

function getTrackedPullRequestListItemData(args: {
  entry: TrackedPullRequestListEntry;
  index: number;
  instanceId: symbol;
}): TrackedPullRequestListItemData {
  return {
    [trackedPullRequestListItemKey]: true,
    entryKey: trackedPullRequestOrderEntryKey(toTrackedPullRequestOrderEntry(args.entry)),
    index: args.index,
    instanceId: args.instanceId,
  };
}

function isTrackedPullRequestListItemData(
  data: Record<string | symbol, unknown>,
): data is TrackedPullRequestListItemData {
  return data[trackedPullRequestListItemKey] === true;
}

function DropIndicator({ edge }: { edge: Edge }) {
  return (
    <div
      className={cx(
        "pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-ink-400",
        edge === "top" ? "top-0" : "bottom-0",
      )}
    />
  );
}

type TrackedPullRequestListItemProps = {
  entry: TrackedPullRequestListEntry;
  index: number;
  instanceId: symbol;
  selectedPrKey: string | null;
  onSelectPr: (repo: RepoSummary, pullRequest: PullRequestSummary) => void;
  onRemovePr: (repo: RepoSummary, pullRequest: PullRequestSummary) => void;
};

type DraggableState =
  | { type: "idle" }
  | { type: "preview"; container: HTMLElement; width: number }
  | { type: "dragging" };

const idleDraggableState: DraggableState = { type: "idle" };
const draggingDraggableState: DraggableState = { type: "dragging" };

function TrackedPullRequestListItem({
  entry,
  index,
  instanceId,
  selectedPrKey,
  onSelectPr,
  onRemovePr,
}: TrackedPullRequestListItemProps) {
  const itemRef = useRef<HTMLDivElement | null>(null);
  const dragHandleRef = useRef<HTMLButtonElement | null>(null);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);
  const [draggableState, setDraggableState] = useState<DraggableState>(idleDraggableState);

  const dragHandle = (
    <button
      aria-label={`Reorder ${getRepoLabel(entry.repo)} #${entry.pullRequest.number}`}
      className="cursor-grab rounded p-1 text-ink-400 transition hover:bg-surface hover:text-ink-700 active:cursor-grabbing"
      ref={dragHandleRef}
      type="button"
    >
      <Bars3Icon className="size-4 shrink-0" />
    </button>
  );
  const removeAction = (
    <button
      aria-label={`Remove PR #${entry.pullRequest.number}`}
      className="rounded p-1 text-ink-500 opacity-0 transition hover:bg-surface hover:text-ink-700 group-hover:opacity-100"
      onClick={() => onRemovePr(entry.repo, entry.pullRequest)}
      type="button"
    >
      <ArchiveBoxXMarkIcon className="size-4 shrink-0" />
    </button>
  );

  useEffect(() => {
    const element = itemRef.current;
    const dragHandle = dragHandleRef.current;
    if (!element || !dragHandle) {
      return;
    }

    const data = getTrackedPullRequestListItemData({ entry, index, instanceId });

    function onChange(args: {
      source: { data: Record<string | symbol, unknown> };
      self: { data: Record<string | symbol, unknown> };
    }) {
      if (!isTrackedPullRequestListItemData(args.source.data)) {
        return;
      }

      if (args.source.data.entryKey === data.entryKey) {
        setClosestEdge(null);
        return;
      }

      const nextClosestEdge = extractClosestEdge(args.self.data);
      const sourceIndex = args.source.data.index;
      const isItemBeforeSource = index === sourceIndex - 1;
      const isItemAfterSource = index === sourceIndex + 1;
      const isDropIndicatorHidden =
        (isItemBeforeSource && nextClosestEdge === "bottom") ||
        (isItemAfterSource && nextClosestEdge === "top");

      setClosestEdge(isDropIndicatorHidden ? null : nextClosestEdge);
    }

    return combine(
      draggable({
        element: dragHandle,
        getInitialData: () => data,
        onGenerateDragPreview({ nativeSetDragImage }) {
          setCustomNativeDragPreview({
            nativeSetDragImage,
            getOffset: pointerOutsideOfPreview({
              x: 12,
              y: 8,
            }),
            render({ container }) {
              setDraggableState({
                type: "preview",
                container,
                width: Math.max(element.clientWidth, 240),
              });

              return () => setDraggableState(draggingDraggableState);
            },
          });
        },
        onDragStart: () => setDraggableState(draggingDraggableState),
        onDrop: () => setDraggableState(idleDraggableState),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          isTrackedPullRequestListItemData(source.data) && source.data.instanceId === instanceId,
        getData: ({ input }) =>
          attachClosestEdge(data, {
            element,
            input,
            allowedEdges: ["top", "bottom"],
          }),
        onDragEnter: onChange,
        onDrag: onChange,
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    );
  }, [entry, index, instanceId]);

  return (
    <div className="relative" ref={itemRef}>
      {closestEdge ? <DropIndicator edge={closestEdge} /> : null}
      <PullRequestListCard
        repo={entry.repo}
        pullRequest={entry.pullRequest}
        selectedPrKey={selectedPrKey}
        repoLabel={getRepoLabel(entry.repo)}
        isDimmed={draggableState.type === "dragging"}
        onSelectPr={onSelectPr}
        leadingActions={dragHandle}
        trailingActions={removeAction}
      />
      {draggableState.type === "preview"
        ? ReactDOM.createPortal(
            <div
              className="overflow-hidden rounded-md shadow-lg"
              style={{ width: draggableState.width }}
            >
              <PullRequestListCard
                repo={entry.repo}
                pullRequest={entry.pullRequest}
                selectedPrKey={selectedPrKey}
                repoLabel={getRepoLabel(entry.repo)}
                onSelectPr={() => {}}
                leadingActions={
                  <div className="rounded p-1 text-ink-400">
                    <Bars3Icon className="size-4 shrink-0" />
                  </div>
                }
                trailingActions={
                  <div className="rounded p-1 text-ink-500 opacity-0">
                    <ArchiveBoxXMarkIcon className="size-4 shrink-0" />
                  </div>
                }
              />
            </div>,
            draggableState.container,
          )
        : null}
    </div>
  );
}

function TrackedPullRequestList({
  entries,
  repoErrors,
  selectedPrKey,
  emptyState = "No tracked PRs or MRs yet. Add one with +.",
  onSelectPr,
  onRemovePr,
  onReorder,
}: TrackedPullRequestListProps) {
  const [instanceId] = useState(() => Symbol("tracked-pull-request-list"));

  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) =>
        isTrackedPullRequestListItemData(source.data) && source.data.instanceId === instanceId,
      onDrop: ({ location, source }) => {
        const target = location.current.dropTargets[0];
        if (!target) {
          return;
        }

        if (
          !isTrackedPullRequestListItemData(source.data) ||
          !isTrackedPullRequestListItemData(target.data)
        ) {
          return;
        }

        const indexOfTarget = entries.findIndex(
          (entry) =>
            trackedPullRequestOrderEntryKey(toTrackedPullRequestOrderEntry(entry)) ===
            target.data.entryKey,
        );
        if (indexOfTarget < 0) {
          return;
        }

        const finishIndex = getReorderDestinationIndex({
          startIndex: source.data.index,
          indexOfTarget,
          closestEdgeOfTarget: extractClosestEdge(target.data),
          axis: "vertical",
        });

        if (finishIndex === source.data.index) {
          return;
        }

        void onReorder(
          reorder({
            list: entries,
            startIndex: source.data.index,
            finishIndex,
          }),
        );
      },
    });
  }, [entries, instanceId, onReorder]);

  return (
    <div className="flex flex-col">
      {entries.length === 0 && repoErrors.length === 0 ? (
        <div className="px-3 py-2.5 text-sm text-ink-500">{emptyState}</div>
      ) : null}
      {entries.map((entry, index) => (
        <TrackedPullRequestListItem
          entry={entry}
          index={index}
          instanceId={instanceId}
          key={trackedPullRequestOrderEntryKey(toTrackedPullRequestOrderEntry(entry))}
          selectedPrKey={selectedPrKey}
          onRemovePr={onRemovePr}
          onSelectPr={onSelectPr}
        />
      ))}
      {repoErrors.map(({ repo, error }) => (
        <div className="px-3 py-2.5 text-sm text-danger-600" key={repo.providerId + repo.repoKey}>
          {getRepoLabel(repo)}: {error}
        </div>
      ))}
    </div>
  );
}

export { TrackedPullRequestList };
export type { TrackedPullRequestListProps };
