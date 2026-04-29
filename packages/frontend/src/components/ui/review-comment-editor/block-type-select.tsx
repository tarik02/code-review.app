import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from "@lexical/rich-text";
import { useCellValue, usePublisher } from "@mdxeditor/gurx";
import {
  activePlugins$,
  allowedHeadingLevels$,
  convertSelectionToNode$,
  currentBlockType$,
  useTranslation,
  type BlockType,
} from "@mdxeditor/editor";
import { $createParagraphNode } from "lexical";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select";

type CommentBlockType = Exclude<BlockType, "">;

type CommentBlockTypeOption = {
  label: string;
  value: CommentBlockType;
};

function isHeadingBlockType(blockType: CommentBlockType): blockType is HeadingTagType {
  return blockType.startsWith("h");
}

type CommentBlockTypeSelectProps = {
  disabled?: boolean;
};

function CommentBlockTypeSelect({ disabled = false }: CommentBlockTypeSelectProps) {
  const convertSelectionToNode = usePublisher(convertSelectionToNode$);
  const currentBlockType = useCellValue(currentBlockType$);
  const activePlugins = useCellValue(activePlugins$);
  const allowedHeadingLevels = useCellValue(allowedHeadingLevels$);
  const t = useTranslation();
  const hasQuote = activePlugins.includes("quote");
  const hasHeadings = activePlugins.includes("headings");

  if (!hasQuote && !hasHeadings) {
    return null;
  }

  const blockTypeOptions: CommentBlockTypeOption[] = [
    {
      label: t("toolbar.blockTypes.paragraph", "Paragraph"),
      value: "paragraph",
    },
  ];

  if (hasQuote) {
    blockTypeOptions.push({
      label: t("toolbar.blockTypes.quote", "Quote"),
      value: "quote",
    });
  }

  if (hasHeadings) {
    blockTypeOptions.push(
      ...allowedHeadingLevels.map((level) => ({
        label: t("toolbar.blockTypes.heading", "Heading {{level}}", {
          level,
        }),
        value: `h${level}` as CommentBlockType,
      })),
    );
  }

  const isSupportedBlockType = blockTypeOptions.some((option) => option.value === currentBlockType);
  const isUnsupportedBlockType = disabled || (currentBlockType !== "" && !isSupportedBlockType);
  const selectedBlockType = isUnsupportedBlockType ? "paragraph" : currentBlockType || "paragraph";

  function handleBlockTypeChange(blockType: CommentBlockType | null) {
    if (!blockType) {
      return;
    }

    switch (blockType) {
      case "paragraph":
        convertSelectionToNode(() => $createParagraphNode());
        break;
      case "quote":
        convertSelectionToNode(() => $createQuoteNode());
        break;
      default:
        if (isHeadingBlockType(blockType)) {
          convertSelectionToNode(() => $createHeadingNode(blockType));
          return;
        }

        throw new Error(`Unknown block type: ${blockType}`);
    }
  }

  return (
    <Select
      disabled={isUnsupportedBlockType}
      items={blockTypeOptions}
      value={selectedBlockType}
      onValueChange={(blockType) => handleBlockTypeChange(blockType as CommentBlockType | null)}
    >
      <SelectTrigger
        aria-label={t("toolbar.blockTypeSelect.selectBlockTypeTooltip", "Select block type")}
        className="rudu-comment-editor-block-select"
        disabled={isUnsupportedBlockType}
        size="sm"
      >
        <SelectValue placeholder={t("toolbar.blockTypeSelect.placeholder", "Block type")} />
      </SelectTrigger>
      <SelectContent align="start" className="rudu-comment-editor-block-select-content">
        {blockTypeOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { CommentBlockTypeSelect };
