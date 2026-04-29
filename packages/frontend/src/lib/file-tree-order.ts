import { prepareFileTreeInput } from '@pierre/trees';

function sortByFileTreePathOrder<T>(items: readonly T[], getPath: (item: T) => string): T[] {
  const decoratedItems = items.map((item, index) => ({
    index,
    item,
    path: getPath(item),
  }));

  const preparedInput = prepareFileTreeInput(
    decoratedItems.map((entry) => entry.path),
    { flattenEmptyDirectories: true },
  );
  const pathOrder = new Map<string, number>();

  preparedInput.paths.forEach((path, index) => {
    if (!pathOrder.has(path)) {
      pathOrder.set(path, index);
    }
  });

  return [...decoratedItems]
    .sort((left, right) => {
      const leftOrder = pathOrder.get(left.path);
      const rightOrder = pathOrder.get(right.path);

      if (leftOrder !== undefined && rightOrder !== undefined) {
        return leftOrder === rightOrder ? left.index - right.index : leftOrder - rightOrder;
      }

      if (leftOrder !== undefined) return -1;
      if (rightOrder !== undefined) return 1;
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

export { sortByFileTreePathOrder };
