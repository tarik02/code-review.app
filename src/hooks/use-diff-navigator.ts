import { useCallback, useEffect, useMemo, useRef } from "react";
import { normalizePath } from "../lib/review-threads";
import {
  getPatchViewerSessionState,
  usePatchViewerStore,
} from "../stores/patch-viewer-store";

type UseDiffNavigatorArgs = {
  sessionKey: string | null;
  prKey: string | null;
  isDiffReady: boolean;
  hasDiffError: boolean;
};

type UseDiffNavigatorResult = {
  tree: {
    selectedFilePath: string | null;
    onSelectFile(path: string): void;
  };
  diff: {
    selectedFilePath: string | null;
    registerDiffNode(path: string, node: HTMLDivElement | null): void;
  };
  actions: {
    notifyDiffContentChanged(): void;
  };
};

type ScrollableDiffNode = Pick<HTMLDivElement, "scrollIntoView">;

type DiffNavigatorControllerState = {
  selectedFilePath: string | null;
  pendingScrollPath: string | null;
};

type DiffNavigatorController = {
  setPrKey(prKey: string | null): void;
  setReadiness(isDiffReady: boolean, hasDiffError: boolean): void;
  onSelectFile(path: string): void;
  registerDiffNode(path: string, node: ScrollableDiffNode | null): void;
  notifyDiffContentChanged(): void;
  getState(): DiffNavigatorControllerState;
};

type DiffNavigatorStateAdapter = {
  getSelectedFilePath(): string | null;
  setSelectedFilePath(path: string | null): void;
  getPendingScrollPath(): string | null;
  setPendingScrollPath(path: string | null): void;
};

type CreateDiffNavigatorControllerArgs = {
  prKey: string | null;
  isDiffReady: boolean;
  hasDiffError: boolean;
} & DiffNavigatorStateAdapter;

function createDiffNavigatorController({
  prKey: initialPrKey,
  isDiffReady: initialIsDiffReady,
  hasDiffError: initialHasDiffError,
  getSelectedFilePath,
  setSelectedFilePath,
  getPendingScrollPath,
  setPendingScrollPath,
}: CreateDiffNavigatorControllerArgs): DiffNavigatorController {
  const diffNodeMap = new Map<string, ScrollableDiffNode>();
  let prKey = initialPrKey;
  let isDiffReady = initialIsDiffReady;
  let hasDiffError = initialHasDiffError;

  function updateSelectedFilePath(next: string | null) {
    if (getSelectedFilePath() === next) return;
    setSelectedFilePath(next);
  }

  function canScroll() {
    return isDiffReady && !hasDiffError;
  }

  function findMatchingNode(path: string) {
    const directMatch = diffNodeMap.get(path);
    if (directMatch) return directMatch;

    const normalizedTargetPath = normalizePath(path);
    for (const [nodePath, node] of diffNodeMap) {
      if (normalizePath(nodePath) === normalizedTargetPath) {
        return node;
      }
    }

    return null;
  }

  function hasMatchingNode(path: string) {
    return findMatchingNode(path) !== null;
  }

  function tryScroll(path: string) {
    if (!canScroll()) {
      return false;
    }

    const node = findMatchingNode(path);
    if (!node) {
      return false;
    }

    node.scrollIntoView({
      behavior: "auto",
      block: "start",
      inline: "nearest",
    });
    return true;
  }

  function flushPendingScroll() {
    const pendingScrollPath = getPendingScrollPath();
    if (!pendingScrollPath) return false;

    if (tryScroll(pendingScrollPath)) {
      setPendingScrollPath(null);
      return true;
    }

    return false;
  }

  return {
    setPrKey(nextPrKey) {
      if (nextPrKey === prKey) return;

      prKey = nextPrKey;
      diffNodeMap.clear();
      setPendingScrollPath(getSelectedFilePath());
    },

    setReadiness(nextIsDiffReady, nextHasDiffError) {
      isDiffReady = nextIsDiffReady;
      hasDiffError = nextHasDiffError;
      flushPendingScroll();
    },

    onSelectFile(path) {
      updateSelectedFilePath(path);
      setPendingScrollPath(path);
      flushPendingScroll();
    },

    registerDiffNode(path, node) {
      if (node) {
        diffNodeMap.set(path, node);
      } else {
        diffNodeMap.delete(path);
      }

      flushPendingScroll();
    },

    notifyDiffContentChanged() {
      const selectedFilePath = getSelectedFilePath();
      if (!selectedFilePath) return;

      if (diffNodeMap.size > 0 && !hasMatchingNode(selectedFilePath)) {
        setPendingScrollPath(null);
        updateSelectedFilePath(null);
        return;
      }

      setPendingScrollPath(selectedFilePath);
      flushPendingScroll();
    },

    getState() {
      return {
        selectedFilePath: getSelectedFilePath(),
        pendingScrollPath: getPendingScrollPath(),
      };
    },
  };
}

function scheduleNextFrame(callback: () => void) {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    const frameId = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frameId);
  }

  const timeoutId = setTimeout(callback, 0);
  return () => clearTimeout(timeoutId);
}

function useDiffNavigator({
  sessionKey,
  prKey,
  isDiffReady,
  hasDiffError,
}: UseDiffNavigatorArgs): UseDiffNavigatorResult {
  const navigatorKey = sessionKey ?? prKey;
  const selectedFilePath = usePatchViewerStore((state) =>
    getPatchViewerSessionState(state, sessionKey).selectedFilePath,
  );
  const setSelectedFilePath = usePatchViewerStore(
    (state) => state.setSelectedFilePath,
  );
  const setPendingScrollPath = usePatchViewerStore(
    (state) => state.setPendingScrollPath,
  );
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;
  const cancelNotifyRef = useRef<(() => void) | null>(null);

  const controllerRef = useRef<DiffNavigatorController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createDiffNavigatorController({
      prKey: navigatorKey,
      isDiffReady,
      hasDiffError,
      getSelectedFilePath: () =>
        getPatchViewerSessionState(
          usePatchViewerStore.getState(),
          sessionKeyRef.current,
        ).selectedFilePath,
      setSelectedFilePath: (path) =>
        setSelectedFilePath(sessionKeyRef.current, path),
      getPendingScrollPath: () =>
        getPatchViewerSessionState(
          usePatchViewerStore.getState(),
          sessionKeyRef.current,
        ).pendingScrollPath,
      setPendingScrollPath: (path) =>
        setPendingScrollPath(sessionKeyRef.current, path),
    });
  }

  useEffect(() => {
    return () => {
      if (!cancelNotifyRef.current) return;
      cancelNotifyRef.current();
      cancelNotifyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setPrKey(navigatorKey);
    controller.setReadiness(isDiffReady, hasDiffError);
  }, [navigatorKey, isDiffReady, hasDiffError]);

  const onSelectFile = useCallback((path: string) => {
    controllerRef.current?.onSelectFile(path);
  }, []);

  const registerDiffNode = useCallback(
    (path: string, node: HTMLDivElement | null) => {
      controllerRef.current?.registerDiffNode(path, node);
    },
    [],
  );

  const notifyDiffContentChanged = useCallback(() => {
    if (cancelNotifyRef.current) {
      cancelNotifyRef.current();
      cancelNotifyRef.current = null;
    }

    cancelNotifyRef.current = scheduleNextFrame(() => {
      controllerRef.current?.notifyDiffContentChanged();
      cancelNotifyRef.current = null;
    });
  }, []);

  const tree = useMemo(
    () => ({
      selectedFilePath,
      onSelectFile,
    }),
    [onSelectFile, selectedFilePath],
  );

  const diff = useMemo(
    () => ({
      selectedFilePath,
      registerDiffNode,
    }),
    [registerDiffNode, selectedFilePath],
  );

  const actions = useMemo(
    () => ({
      notifyDiffContentChanged,
    }),
    [notifyDiffContentChanged],
  );

  return { tree, diff, actions };
}

export {
  createDiffNavigatorController,
  useDiffNavigator,
};
export type {
  DiffNavigatorController,
  DiffNavigatorControllerState,
  UseDiffNavigatorArgs,
  UseDiffNavigatorResult,
};
