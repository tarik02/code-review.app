import type {
  OverviewPullRequestSummary,
  PullRequestSummary,
  RepoIdentity,
  TrackedPullRequestOrderEntry,
} from "../types/forge";

type TrackedPullRequestListEntry = OverviewPullRequestSummary;

function trackedPullRequestOrderEntryKey(entry: TrackedPullRequestOrderEntry) {
  return `${entry.providerId}:${entry.repoKey}#${entry.number}`;
}

function toTrackedPullRequestOrderEntry(input: {
  repo: RepoIdentity;
  pullRequest: PullRequestSummary;
}): TrackedPullRequestOrderEntry {
  return {
    providerId: input.repo.providerId,
    repoKey: input.repo.repoKey,
    number: input.pullRequest.number,
  };
}

function dedupeTrackedPullRequestOrder(
  entries: TrackedPullRequestOrderEntry[],
): TrackedPullRequestOrderEntry[] {
  const deduped = new Map<string, TrackedPullRequestOrderEntry>();

  for (const entry of entries) {
    const key = trackedPullRequestOrderEntryKey(entry);
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }

  return [...deduped.values()];
}

function prependTrackedPullRequestOrderEntry(
  order: TrackedPullRequestOrderEntry[],
  entry: TrackedPullRequestOrderEntry,
): TrackedPullRequestOrderEntry[] {
  const entryKey = trackedPullRequestOrderEntryKey(entry);
  return [entry, ...order.filter((candidate) => trackedPullRequestOrderEntryKey(candidate) !== entryKey)];
}

function removeTrackedPullRequestOrderEntry(
  order: TrackedPullRequestOrderEntry[],
  entry: TrackedPullRequestOrderEntry,
): TrackedPullRequestOrderEntry[] {
  const entryKey = trackedPullRequestOrderEntryKey(entry);
  return order.filter((candidate) => trackedPullRequestOrderEntryKey(candidate) !== entryKey);
}

function toTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortTrackedPullRequestEntries(
  entries: TrackedPullRequestListEntry[],
  order: TrackedPullRequestOrderEntry[],
): TrackedPullRequestListEntry[] {
  const normalizedOrder = dedupeTrackedPullRequestOrder(order);
  const orderIndex = new Map(
    normalizedOrder.map((entry, index) => [trackedPullRequestOrderEntryKey(entry), index]),
  );

  const ordered: TrackedPullRequestListEntry[] = [];
  const unordered: TrackedPullRequestListEntry[] = [];

  for (const entry of entries) {
    const orderEntry = toTrackedPullRequestOrderEntry(entry);
    if (orderIndex.has(trackedPullRequestOrderEntryKey(orderEntry))) {
      ordered.push(entry);
      continue;
    }
    unordered.push(entry);
  }

  ordered.sort((left, right) => {
    const leftIndex = orderIndex.get(trackedPullRequestOrderEntryKey(toTrackedPullRequestOrderEntry(left))) ?? 0;
    const rightIndex =
      orderIndex.get(trackedPullRequestOrderEntryKey(toTrackedPullRequestOrderEntry(right))) ?? 0;
    return leftIndex - rightIndex;
  });

  unordered.sort((left, right) => {
    const updatedAtDiff =
      toTimestamp(right.pullRequest.updatedAt) - toTimestamp(left.pullRequest.updatedAt);
    if (updatedAtDiff !== 0) {
      return updatedAtDiff;
    }

    return trackedPullRequestOrderEntryKey(toTrackedPullRequestOrderEntry(left)).localeCompare(
      trackedPullRequestOrderEntryKey(toTrackedPullRequestOrderEntry(right)),
    );
  });

  return [...ordered, ...unordered];
}

function mergeTrackedVisibleSubsetIntoOrder(args: {
  currentOrder: TrackedPullRequestOrderEntry[];
  visibleEntries: TrackedPullRequestListEntry[];
  reorderedVisibleEntries: TrackedPullRequestListEntry[];
}): TrackedPullRequestOrderEntry[] {
  const currentOrder = dedupeTrackedPullRequestOrder(args.currentOrder);
  const visibleKeys = new Set(
    args.visibleEntries.map((entry) =>
      trackedPullRequestOrderEntryKey(toTrackedPullRequestOrderEntry(entry)),
    ),
  );
  const reorderedVisibleOrder = dedupeTrackedPullRequestOrder(
    args.reorderedVisibleEntries.map((entry) => toTrackedPullRequestOrderEntry(entry)),
  );
  const hiddenOrder = currentOrder.filter(
    (entry) => !visibleKeys.has(trackedPullRequestOrderEntryKey(entry)),
  );
  const firstVisibleIndex = currentOrder.findIndex((entry) =>
    visibleKeys.has(trackedPullRequestOrderEntryKey(entry)),
  );

  if (firstVisibleIndex === -1) {
    return [...reorderedVisibleOrder, ...hiddenOrder];
  }

  return [
    ...hiddenOrder.slice(0, firstVisibleIndex),
    ...reorderedVisibleOrder,
    ...hiddenOrder.slice(firstVisibleIndex),
  ];
}

export {
  dedupeTrackedPullRequestOrder,
  mergeTrackedVisibleSubsetIntoOrder,
  prependTrackedPullRequestOrderEntry,
  removeTrackedPullRequestOrderEntry,
  sortTrackedPullRequestEntries,
  toTrackedPullRequestOrderEntry,
  trackedPullRequestOrderEntryKey,
};
export type { TrackedPullRequestListEntry };
