import { useCallback, useEffect, useMemo, useRef } from "react";
import type { GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FileStatsEntry } from "../../types/forge";
import { TopBar } from "./top-bar";

type ChangedFilesTreeProps = {
  files: string[];
  isLoading: boolean;
  error: string;
  hasSelection: boolean;
  showContainer?: boolean;
  onSelectFile?: (path: string) => void;
  selectedFilePath?: string | null;
  fileStats: Map<string, FileStatsEntry> | null;
  gitStatus: GitStatusEntry[] | undefined;
  isDark: boolean;
};

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function ChangedFilesTree({
  files,
  isLoading,
  error,
  hasSelection,
  showContainer = true,
  onSelectFile,
  selectedFilePath,
  fileStats,
  gitStatus,
  isDark,
}: ChangedFilesTreeProps) {
  const initialExpandedPaths = useMemo(() => {
    const expandedDirs = new Set<string>();

    for (const file of files) {
      const parts = file.split("/");
      for (let i = 1; i < parts.length; i += 1) {
        expandedDirs.add(parts.slice(0, i).join("/"));
      }
    }

    return Array.from(expandedDirs);
  }, [files]);

  const fileSet = useMemo(() => new Set(files), [files]);

  const totals = useMemo(() => {
    if (!fileStats) return null;
    let additions = 0;
    let deletions = 0;
    for (const entry of fileStats.values()) {
      additions += entry.additions;
      deletions += entry.deletions;
    }
    return { additions, deletions };
  }, [fileStats]);

  const onSelectFileRef = useRef(onSelectFile);
  const selectedFilePathRef = useRef(selectedFilePath);
  const fileSetRef = useRef(fileSet);

  useEffect(() => {
    onSelectFileRef.current = onSelectFile;
  }, [onSelectFile]);

  useEffect(() => {
    selectedFilePathRef.current = selectedFilePath;
  }, [selectedFilePath]);

  useEffect(() => {
    fileSetRef.current = fileSet;
  }, [fileSet]);

  const handleSelectionChange = useCallback((selectedPaths: readonly string[]) => {
    const selectedFile = [...selectedPaths].reverse().find((path) => fileSetRef.current.has(path));

    if (!selectedFile) return;
    if (selectedFile === selectedFilePathRef.current) return;

    onSelectFileRef.current?.(selectedFile);
  }, []);

  const selectedTreePaths = useMemo(
    () => (selectedFilePath && fileSet.has(selectedFilePath) ? [selectedFilePath] : []),
    [fileSet, selectedFilePath],
  );

  const { model } = useFileTree({
    id: "icon-set-tree",
    flattenEmptyDirectories: true,
    initialExpandedPaths,
    initialSelectedPaths: selectedTreePaths,
    gitStatus,
    onSelectionChange: handleSelectionChange,
    paths: files,
    density: "compact",
  });

  useEffect(() => {
    model.resetPaths(files, { initialExpandedPaths });
  }, [files, initialExpandedPaths, model]);

  useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

  useEffect(() => {
    const selectedPaths = model.getSelectedPaths();
    const nextSelectedPath = selectedTreePaths[0] ?? null;

    if (
      selectedPaths.length === (nextSelectedPath ? 1 : 0) &&
      selectedPaths[0] === nextSelectedPath
    ) {
      return;
    }

    for (const path of selectedPaths) {
      model.getItem(path)?.deselect();
    }

    if (nextSelectedPath) {
      model.getItem(nextSelectedPath)?.select();
      model.focusPath(nextSelectedPath);
    }
  }, [model, selectedTreePaths]);

  const fileTreeStyle = useMemo(
    () => ({
      height: "100%",
      colorScheme: (isDark ? "dark" : "light") as "dark" | "light",
      "--trees-bg-override": isDark ? "#18181b" : "#F7F7F3",
      "--trees-bg-muted-override": isDark ? "#27272a" : "#E6E4DD",
      "--trees-selected-bg-override": isDark ? "#27272a" : "#E6E4DD",
    }),
    [isDark],
  );

  return (
    <section
      className={
        showContainer
          ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-ink-200"
          : "flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      }
    >
      <TopBar
        position="right"
        className="sticky top-0 z-10 shrink-0 border-b border-ink-200 bg-surface text-xs text-ink-500 cursor-grab app-region-drag flex"
      >
        <div className="grow flex items-center justify-between px-3 py-2">
          <p className="text-sm text-ink-900">
            Changed files <span className="ml-2 text-ink-500">{files.length}</span>
          </p>
          <div className="flex items-center gap-2 font-mono font-bold">
            {totals ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-emerald-600 dark:text-emerald-300">
                  +{formatCount(totals.additions)}
                </span>
                <span className="text-red-500 dark:text-red-300">
                  −{formatCount(totals.deletions)}
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </TopBar>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-hidden">
        {!hasSelection ? (
          <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm text-ink-500">
            Select a pull request to load changed files.
          </div>
        ) : null}

        {hasSelection && isLoading ? (
          <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm text-ink-500">
            Loading file tree...
          </div>
        ) : null}

        {hasSelection && !isLoading && error ? (
          <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm text-danger-600">
            {error}
          </div>
        ) : null}

        {hasSelection && !isLoading && !error && files.length === 0 ? (
          <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm text-ink-500">
            No changed files found for this pull request.
          </div>
        ) : null}

        {hasSelection && !isLoading && !error && files.length > 0 ? (
          <FileTree className="h-full min-h-[220px]" model={model} style={fileTreeStyle} />
        ) : null}
      </div>
    </section>
  );
}

export { ChangedFilesTree };
export type { ChangedFilesTreeProps };
