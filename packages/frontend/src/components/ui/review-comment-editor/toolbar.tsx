import type { EditorView } from "@codemirror/view";
import {
  IS_BOLD,
  IS_CODE,
  IS_ITALIC,
  applyFormat$,
  applyListType$,
  currentFormat$,
  currentListType$,
  insertCodeBlock$,
  openLinkEditDialog$,
  useTranslation,
  viewMode$,
  type ViewMode,
} from "@mdxeditor/editor";
import { useCellValues, usePublisher } from "@mdxeditor/gurx";
import {
  Bold,
  Code,
  Code2,
  FileText,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Pencil,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../tooltip";
import { CommentBlockTypeSelect } from "./block-type-select";
import {
  insertSourceCodeBlock,
  insertSourceLink,
  insertSourceMarkdown,
  toggleSourceInlineMarker,
  toggleSourceList,
  type MarkdownListType,
} from "./source-markdown-actions";
import type { ForgeProviderKind } from "../../../types/forge";

type ReviewCommentToolbarProps = {
  canInsertSuggestion: boolean;
  provider: ForgeProviderKind;
  sourceEditorView: EditorView | null;
  suggestionMarkdown: string;
  onInsertSuggestion: () => void;
};

type ToolbarButtonProps = {
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: ReactNode;
  onClick: () => void;
};

function ToolbarButton({
  active = false,
  disabled = false,
  title,
  children,
  onClick,
}: ToolbarButtonProps) {
  return (
    <Tooltip disabled={disabled}>
      <TooltipTrigger
        render={
          <Button
            aria-label={title}
            className="rudu-comment-editor-toolbar-button"
            data-active={active ? "true" : undefined}
            disabled={disabled}
            onClick={onClick}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function ToolbarSeparator() {
  return <div aria-hidden className="rudu-comment-editor-toolbar-separator" />;
}

function ReviewCommentToolbar({
  canInsertSuggestion,
  provider,
  sourceEditorView,
  suggestionMarkdown,
  onInsertSuggestion,
}: ReviewCommentToolbarProps) {
  const [viewMode, currentFormat, currentListType] = useCellValues(
    viewMode$,
    currentFormat$,
    currentListType$,
  );
  const setViewMode = usePublisher(viewMode$);
  const applyFormat = usePublisher(applyFormat$);
  const applyListType = usePublisher(applyListType$);
  const openLinkEditDialog = usePublisher(openLinkEditDialog$);
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const t = useTranslation();
  const isSourceMode = viewMode === "source";

  function runSourceAction(action: (view: EditorView) => void) {
    if (!sourceEditorView) {
      return;
    }

    action(sourceEditorView);
  }

  function handleFormat(format: "bold" | "italic" | "code") {
    if (isSourceMode) {
      const marker = format === "bold" ? "**" : format === "italic" ? "*" : "`";
      runSourceAction((view) => toggleSourceInlineMarker(view, marker));
      return;
    }

    applyFormat(format);
  }

  function handleList(type: MarkdownListType) {
    if (isSourceMode) {
      runSourceAction((view) => toggleSourceList(view, type));
      return;
    }

    applyListType(currentListType === type ? "" : type);
  }

  function handleLink() {
    if (isSourceMode) {
      runSourceAction(insertSourceLink);
      return;
    }

    openLinkEditDialog();
  }

  function handleCodeBlock() {
    if (isSourceMode) {
      runSourceAction(insertSourceCodeBlock);
      return;
    }

    insertCodeBlock({});
  }

  function handleSuggestion() {
    if (isSourceMode) {
      runSourceAction((view) => insertSourceMarkdown(view, suggestionMarkdown));
      return;
    }

    onInsertSuggestion();
  }

  function handleModeChange(nextMode: ViewMode) {
    setViewMode(nextMode);
  }

  const suggestionTitle =
    provider === "gitlab" ? "Insert GitLab suggestion" : "Insert GitHub suggestion";

  return (
    <TooltipProvider delay={500} closeDelay={0}>
      <div className="rudu-comment-editor-toolbar-actions">
        <CommentBlockTypeSelect disabled={isSourceMode} />
        <ToolbarButton
          active={!isSourceMode && (currentFormat & IS_BOLD) !== 0}
          title={t("toolbar.bold", "Bold")}
          onClick={() => handleFormat("bold")}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          active={!isSourceMode && (currentFormat & IS_ITALIC) !== 0}
          title={t("toolbar.italic", "Italic")}
          onClick={() => handleFormat("italic")}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          active={!isSourceMode && (currentFormat & IS_CODE) !== 0}
          title={t("toolbar.inlineCode", "Inline code format")}
          onClick={() => handleFormat("code")}
        >
          <Code className="size-4" />
        </ToolbarButton>
        <ToolbarButton title={t("toolbar.link", "Create link")} onClick={handleLink}>
          <Link className="size-4" />
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton
          active={!isSourceMode && currentListType === "bullet"}
          title={t("toolbar.bulletedList", "Bulleted list")}
          onClick={() => handleList("bullet")}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          active={!isSourceMode && currentListType === "number"}
          title={t("toolbar.numberedList", "Numbered list")}
          onClick={() => handleList("number")}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          active={!isSourceMode && currentListType === "check"}
          title={t("toolbar.checkList", "Check list")}
          onClick={() => handleList("check")}
        >
          <ListChecks className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title={t("toolbar.codeBlock", "Insert Code Block")}
          onClick={handleCodeBlock}
        >
          <Code2 className="size-4" />
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton
          disabled={!canInsertSuggestion || (isSourceMode && !sourceEditorView)}
          title={suggestionTitle}
          onClick={handleSuggestion}
        >
          <Pencil className="size-4" />
        </ToolbarButton>
      </div>
      <div className="rudu-comment-editor-toolbar-modes">
        <ToolbarButton
          active={viewMode === "rich-text"}
          title={t("toolbar.richText", "Rich text")}
          onClick={() => handleModeChange("rich-text")}
        >
          <FileText className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          active={viewMode === "source"}
          title={t("toolbar.source", "Source mode")}
          onClick={() => handleModeChange("source")}
        >
          <Code2 className="size-4" />
        </ToolbarButton>
      </div>
    </TooltipProvider>
  );
}

export { ReviewCommentToolbar };
