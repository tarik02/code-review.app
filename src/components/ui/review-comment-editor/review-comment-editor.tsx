import type { EditorView } from "@codemirror/view";
import {
  MDXEditor,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  toolbarPlugin,
  type MDXEditorMethods,
  type RealmPlugin,
} from "@mdxeditor/editor";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ensureCodeMirrorStyles } from "../../../lib/ensure-codemirror-styles";
import { buildSuggestionBlock } from "../review-comment-editor-actions";
import {
  commentCodeMirrorDescriptor,
  commentCodeMirrorTheme,
  sourceCodeFormattingKeymap,
} from "./code-block-editor";
import { ReviewCommentEditorFooter } from "./footer";
import { getLanguageFromPath } from "./language";
import { ReviewCommentLinkDialog } from "./link-dialog";
import { createSourceEditorViewBridge } from "./source-editor-bridge";
import { suggestionCodeBlockDescriptor } from "./suggestion-code-block-editor";
import { SuggestionEditorContext } from "./suggestion-context";
import { ReviewCommentToolbar } from "./toolbar";
import type {
  ReviewCommentEditorProps,
  SuggestionEditorContextValue,
} from "./types";
import "../comment-markdown.css";
import "./styles.css";

type SerializedCursorPosition = NonNullable<
  ReviewCommentEditorProps["cursorPosition"]
>;

function getEditorContentElement(host: HTMLDivElement | null) {
  return (
    host?.querySelector<HTMLElement>(".rudu-comment-editor-content") ?? null
  );
}

function getNodePath(root: Node, node: Node) {
  const path: number[] = [];
  let currentNode: Node | null = node;

  while (currentNode && currentNode !== root) {
    const parentNode = currentNode.parentNode;
    if (!parentNode) {
      return null;
    }

    path.unshift(
      Array.prototype.indexOf.call(parentNode.childNodes, currentNode),
    );
    currentNode = parentNode;
  }

  return currentNode === root ? path : null;
}

function getNodeFromPath(root: Node, path: number[]) {
  let node: Node | null = root;

  for (const index of path) {
    node = node?.childNodes[index] ?? null;
    if (!node) {
      return null;
    }
  }

  return node;
}

function clampNodeOffset(node: Node, offset: number) {
  const maxOffset =
    node.nodeType === Node.TEXT_NODE
      ? (node.textContent ?? "").length
      : node.childNodes.length;

  return Math.min(Math.max(offset, 0), maxOffset);
}

function serializeCursorPosition(
  root: HTMLElement,
): SerializedCursorPosition | null {
  const selection = window.getSelection();
  if (
    !selection ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  ) {
    return null;
  }

  const anchorPath = getNodePath(root, selection.anchorNode);
  const focusPath = getNodePath(root, selection.focusNode);
  if (!anchorPath || !focusPath) {
    return null;
  }

  return {
    anchorOffset: selection.anchorOffset,
    anchorPath,
    focusOffset: selection.focusOffset,
    focusPath,
  };
}

function restoreCursorPosition(
  root: HTMLElement,
  cursorPosition: SerializedCursorPosition,
) {
  const anchorNode = getNodeFromPath(root, cursorPosition.anchorPath);
  const focusNode = getNodeFromPath(root, cursorPosition.focusPath);
  if (!anchorNode || !focusNode) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection) {
    return false;
  }

  selection.setBaseAndExtent(
    anchorNode,
    clampNodeOffset(anchorNode, cursorPosition.anchorOffset),
    focusNode,
    clampNodeOffset(focusNode, cursorPosition.focusOffset),
  );
  return true;
}

function ReviewCommentEditor({
  defaultMode = "rich-text",
  initialValue = "",
  value,
  cursorPosition = null,
  placeholder = "Leave a comment",
  provider,
  suggestionContext = null,
  target = null,
  selectedText = "",
  submitLabel,
  cancelLabel = "Cancel",
  isPending = false,
  error = "",
  autoFocus = true,
  onChange,
  onCursorPositionChange,
  onCancel,
  onSubmit,
}: ReviewCommentEditorProps) {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const sourceEditorViewRef = useRef<EditorView | null>(null);
  const [initialViewMode] = useState(defaultMode);
  const [sourceEditorView, setSourceEditorView] = useState<EditorView | null>(
    null,
  );
  const [body, setBody] = useState(initialValue);
  const isControlled = value !== undefined;
  const currentBody = value ?? body;
  const lastMarkdownRef = useRef(value ?? initialValue);
  const cursorCaptureFrameRef = useRef<number | null>(null);
  const hasRestoredCursorPositionRef = useRef(false);
  const suggestion = useMemo(
    () => buildSuggestionBlock(provider, target, selectedText),
    [provider, selectedText, target],
  );
  const suggestionHighlightLanguage = useMemo(
    () => getLanguageFromPath(target?.path),
    [target?.path],
  );
  const suggestionEditorContext = useMemo<SuggestionEditorContextValue | null>(
    () =>
      target?.type === "line"
        ? {
            anchorLine: target.line,
            endLine: Math.max(target.startLine ?? target.line, target.line),
            language: suggestionHighlightLanguage,
            lines: suggestionContext?.lines ?? [],
            provider,
            sourceSide: target.side,
            startLine: Math.min(target.startLine ?? target.line, target.line),
          }
        : null,
    [provider, suggestionContext?.lines, suggestionHighlightLanguage, target],
  );
  const suggestionError =
    target?.type === "line" && suggestion.error ? suggestion.error : "";
  const canInsertSuggestion = !isPending && suggestion.block.length > 0;

  useLayoutEffect(() => {
    ensureCodeMirrorStyles(editorHostRef.current?.getRootNode() ?? null);
  }, []);

  const captureCursorPosition = useCallback(() => {
    if (!onCursorPositionChange) {
      return;
    }

    const contentElement = getEditorContentElement(editorHostRef.current);
    if (!contentElement) {
      return;
    }

    const nextCursorPosition = serializeCursorPosition(contentElement);
    if (nextCursorPosition) {
      onCursorPositionChange(nextCursorPosition);
    }
  }, [onCursorPositionChange]);

  const scheduleCursorPositionCapture = useCallback(() => {
    if (!onCursorPositionChange || typeof window === "undefined") {
      return;
    }

    if (cursorCaptureFrameRef.current !== null) {
      window.cancelAnimationFrame(cursorCaptureFrameRef.current);
    }

    cursorCaptureFrameRef.current = window.requestAnimationFrame(() => {
      cursorCaptureFrameRef.current = null;
      captureCursorPosition();
    });
  }, [captureCursorPosition, onCursorPositionChange]);

  useEffect(() => {
    return () => {
      if (cursorCaptureFrameRef.current !== null) {
        window.cancelAnimationFrame(cursorCaptureFrameRef.current);
        cursorCaptureFrameRef.current = null;
      }
      captureCursorPosition();
    };
  }, [captureCursorPosition]);

  useEffect(() => {
    if (!onCursorPositionChange) {
      return;
    }

    document.addEventListener("selectionchange", scheduleCursorPositionCapture);
    return () => {
      document.removeEventListener(
        "selectionchange",
        scheduleCursorPositionCapture,
      );
    };
  }, [onCursorPositionChange, scheduleCursorPositionCapture]);

  useEffect(() => {
    if (isControlled) {
      return;
    }

    lastMarkdownRef.current = initialValue;
    setBody(initialValue);
    editorRef.current?.setMarkdown(initialValue);
  }, [initialValue, isControlled]);

  useEffect(() => {
    if (!isControlled || value === lastMarkdownRef.current) {
      return;
    }

    const nextValue = value ?? "";
    lastMarkdownRef.current = nextValue;
    editorRef.current?.setMarkdown(nextValue);
  }, [isControlled, value]);

  useEffect(() => {
    if (
      !cursorPosition ||
      hasRestoredCursorPositionRef.current ||
      typeof window === "undefined"
    ) {
      return;
    }

    let frameId: number | null = null;
    let attempts = 0;
    let cancelled = false;

    const tryRestore = () => {
      if (cancelled) {
        return;
      }

      attempts += 1;
      const contentElement = getEditorContentElement(editorHostRef.current);
      if (
        contentElement &&
        restoreCursorPosition(contentElement, cursorPosition)
      ) {
        hasRestoredCursorPositionRef.current = true;
        return;
      }

      if (attempts < 5) {
        frameId = window.requestAnimationFrame(tryRestore);
      }
    };

    frameId = window.requestAnimationFrame(tryRestore);

    return () => {
      cancelled = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [cursorPosition]);

  const insertSuggestion = useCallback(() => {
    if (!suggestion.block || isPending) {
      return;
    }

    editorRef.current?.focus(
      () => {
        editorRef.current?.insertMarkdown(suggestion.block);
      },
      { defaultSelection: "rootEnd" },
    );
  }, [isPending, suggestion.block]);

  const sourceEditorBridgeExtension = useMemo(
    () =>
      createSourceEditorViewBridge(sourceEditorViewRef, setSourceEditorView),
    [],
  );

  const plugins = useMemo<RealmPlugin[]>(
    () => [
      headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4] }),
      quotePlugin(),
      listsPlugin(),
      linkPlugin(),
      linkDialogPlugin({
        LinkDialog: ReviewCommentLinkDialog,
        showLinkTitleField: false,
      }),
      codeBlockPlugin({
        codeBlockEditorDescriptors: [
          suggestionCodeBlockDescriptor,
          commentCodeMirrorDescriptor,
        ],
        defaultCodeBlockLanguage: "",
      }),
      codeMirrorPlugin({
        codeBlockLanguages: {
          "": "Plain text",
          bash: "Bash",
          css: "CSS",
          diff: "Diff",
          html: "HTML",
          js: "JavaScript",
          json: "JSON",
          md: "Markdown",
          sh: "Shell",
          ts: "TypeScript",
          tsx: "TSX",
        },
        codeMirrorExtensions: [commentCodeMirrorTheme],
      }),
      markdownShortcutPlugin(),
      diffSourcePlugin({
        viewMode: initialViewMode,
        codeMirrorExtensions: [
          sourceEditorBridgeExtension,
          commentCodeMirrorTheme,
          sourceCodeFormattingKeymap,
        ],
      }),
      toolbarPlugin({
        toolbarClassName: "rudu-comment-editor-toolbar",
        toolbarContents: () => (
          <ReviewCommentToolbar
            canInsertSuggestion={canInsertSuggestion}
            provider={provider}
            sourceEditorView={sourceEditorView}
            sourceEditorViewRef={sourceEditorViewRef}
            suggestionMarkdown={suggestion.block}
            onInsertSuggestion={insertSuggestion}
          />
        ),
      }),
    ],
    [
      canInsertSuggestion,
      initialViewMode,
      insertSuggestion,
      provider,
      sourceEditorBridgeExtension,
      sourceEditorView,
      suggestion.block,
    ],
  );

  async function handleSubmit() {
    const latestBody = editorRef.current?.getMarkdown() ?? currentBody;
    const trimmedBody = latestBody.trim();
    if (!trimmedBody) {
      return;
    }

    await onSubmit(trimmedBody);
  }

  function handleChange(markdown: string) {
    lastMarkdownRef.current = markdown;
    if (!isControlled) {
      setBody(markdown);
    }
    onChange?.(markdown);
    scheduleCursorPositionCapture();
  }

  return (
    <div className="font-sans">
      <div
        ref={editorHostRef}
        className="rudu-comment-editor-shell"
        onBlurCapture={captureCursorPosition}
        onKeyUpCapture={scheduleCursorPositionCapture}
        onMouseUpCapture={scheduleCursorPositionCapture}
        onPointerUpCapture={scheduleCursorPositionCapture}
      >
        <SuggestionEditorContext.Provider value={suggestionEditorContext}>
          <MDXEditor
            ref={editorRef}
            autoFocus={
              autoFocus
                ? { defaultSelection: "rootEnd", preventScroll: true }
                : false
            }
            className="rudu-comment-editor"
            contentEditableClassName="rudu-comment-editor-content rudu-comment-markdown"
            markdown={value ?? initialValue}
            onChange={handleChange}
            placeholder={placeholder}
            plugins={plugins}
            readOnly={isPending}
            suppressHtmlProcessing
            trim={false}
          />
        </SuggestionEditorContext.Provider>
        <ReviewCommentEditorFooter
          canSubmit={!isPending && currentBody.trim().length > 0}
          cancelLabel={cancelLabel}
          isPending={isPending}
          submitLabel={submitLabel}
          onCancel={onCancel}
          onSubmit={() => void handleSubmit()}
        />
      </div>
      {error || suggestionError ? (
        <div className="mt-2 text-sm text-danger-600">
          {error || suggestionError}
        </div>
      ) : null}
    </div>
  );
}

export { ReviewCommentEditor };
