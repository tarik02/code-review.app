import { GutterMarker, gutter } from "@codemirror/view";
import type { SuggestionGutterColumns } from "./types";

class SuggestionGutterMarker extends GutterMarker {
  constructor(private readonly columns: SuggestionGutterColumns) {
    super();
  }

  eq(other: GutterMarker) {
    return (
      other instanceof SuggestionGutterMarker &&
      other.columns.oldLine === this.columns.oldLine &&
      other.columns.newLine === this.columns.newLine &&
      other.columns.sign === this.columns.sign
    );
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = "rudu-comment-editor-suggestion-gutter-marker";

    const oldLine = document.createElement("span");
    oldLine.className = "rudu-comment-editor-suggestion-gutter-old";
    oldLine.textContent = this.columns.oldLine?.toString() ?? "";

    const newLine = document.createElement("span");
    newLine.className = "rudu-comment-editor-suggestion-gutter-new";
    newLine.textContent = this.columns.newLine?.toString() ?? "";

    const sign = document.createElement("span");
    sign.className = "rudu-comment-editor-suggestion-gutter-sign";
    sign.textContent = this.columns.sign;

    marker.append(oldLine, newLine, sign);
    return marker;
  }
}

function createSuggestionLineNumberGutter(
  lineNumberColumns: (lineNumber: number) => SuggestionGutterColumns,
) {
  return gutter({
    class: "rudu-comment-editor-suggestion-gutter",
    renderEmptyElements: true,
    initialSpacer: () =>
      new SuggestionGutterMarker({
        oldLine: 999,
        newLine: 999,
        sign: "+",
      }),
    lineMarker(view, line) {
      const lineNumber = view.state.doc.lineAt(line.from).number;
      return new SuggestionGutterMarker(lineNumberColumns(lineNumber));
    },
  });
}

export { createSuggestionLineNumberGutter };
