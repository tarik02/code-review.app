import type { EditorView } from '@codemirror/view';

type MarkdownListType = 'bullet' | 'number' | 'check';

function selectedSourceRange(view: EditorView) {
  const selection = view.state.selection.main;
  return {
    from: Math.min(selection.from, selection.to),
    to: Math.max(selection.from, selection.to),
  };
}

function replaceSourceSelection(
  view: EditorView,
  text: string,
  selection?: { anchor: number; head?: number },
) {
  const range = selectedSourceRange(view);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: selection ?? {
      anchor: range.from,
      head: range.from + text.length,
    },
    scrollIntoView: true,
  });
  view.focus();
}

function toggleSourceInlineMarker(view: EditorView, marker: string) {
  const range = selectedSourceRange(view);
  const selectedText = view.state.doc.sliceString(range.from, range.to);
  const before = view.state.doc.sliceString(Math.max(0, range.from - marker.length), range.from);
  const after = view.state.doc.sliceString(
    range.to,
    Math.min(view.state.doc.length, range.to + marker.length),
  );

  if (selectedText && before === marker && after === marker) {
    view.dispatch({
      changes: [
        { from: range.to, to: range.to + marker.length, insert: '' },
        { from: range.from - marker.length, to: range.from, insert: '' },
      ],
      selection: {
        anchor: range.from - marker.length,
        head: range.to - marker.length,
      },
      scrollIntoView: true,
    });
    view.focus();
    return;
  }

  if (selectedText.startsWith(marker) && selectedText.endsWith(marker)) {
    const unwrapped = selectedText.slice(marker.length, -marker.length);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: unwrapped },
      selection: {
        anchor: range.from,
        head: range.from + unwrapped.length,
      },
      scrollIntoView: true,
    });
    view.focus();
    return;
  }

  const nextText = `${marker}${selectedText}${marker}`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: nextText },
    selection: {
      anchor: range.from + marker.length,
      head: range.from + marker.length + selectedText.length,
    },
    scrollIntoView: true,
  });
  view.focus();
}

function insertSourceLink(view: EditorView) {
  const range = selectedSourceRange(view);
  const selectedText = view.state.doc.sliceString(range.from, range.to);
  const label = selectedText || 'link';
  const nextText = `[${label}]()`;
  const urlStart = range.from + label.length + 3;

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: nextText },
    selection: { anchor: urlStart },
    scrollIntoView: true,
  });
  view.focus();
}

function lineRangeForSelection(view: EditorView) {
  const range = selectedSourceRange(view);
  const effectiveTo = range.to > range.from ? range.to - 1 : range.to;
  return {
    fromLine: view.state.doc.lineAt(range.from),
    toLine: view.state.doc.lineAt(effectiveTo),
  };
}

function stripKnownListPrefix(line: string) {
  return line.replace(/^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, '$1');
}

function listPrefixFor(type: MarkdownListType, index: number) {
  switch (type) {
    case 'bullet':
      return '- ';
    case 'number':
      return `${index + 1}. `;
    case 'check':
      return '- [ ] ';
  }
}

function listPrefixPattern(type: MarkdownListType) {
  switch (type) {
    case 'bullet':
      return /^(\s*)[-*+]\s+/;
    case 'number':
      return /^(\s*)\d+[.)]\s+/;
    case 'check':
      return /^(\s*)[-*+]\s+\[[ xX]\]\s+/;
  }
}

function toggleSourceList(view: EditorView, type: MarkdownListType) {
  const { fromLine, toLine } = lineRangeForSelection(view);
  const lines = [];

  for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber += 1) {
    lines.push(view.state.doc.line(lineNumber).text);
  }

  const prefixPattern = listPrefixPattern(type);
  const shouldRemove = lines
    .filter((line) => line.trim().length > 0)
    .every((line) => prefixPattern.test(line));

  const nextText = lines
    .map((line, index) => {
      if (line.trim().length === 0) {
        return line;
      }

      return shouldRemove
        ? line.replace(prefixPattern, '$1')
        : stripKnownListPrefix(line).replace(/^(\s*)/, `$1${listPrefixFor(type, index)}`);
    })
    .join('\n');

  view.dispatch({
    changes: { from: fromLine.from, to: toLine.to, insert: nextText },
    selection: { anchor: fromLine.from, head: fromLine.from + nextText.length },
    scrollIntoView: true,
  });
  view.focus();
}

function insertSourceCodeBlock(view: EditorView) {
  const range = selectedSourceRange(view);
  const selectedText = view.state.doc.sliceString(range.from, range.to);

  if (selectedText.length === 0) {
    const nextText = '```\n\n```';
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: nextText },
      selection: { anchor: range.from + 4 },
      scrollIntoView: true,
    });
    view.focus();
    return;
  }

  replaceSourceSelection(view, `\`\`\`\n${selectedText}\n\`\`\``);
}

function insertSourceMarkdown(view: EditorView, markdown: string) {
  replaceSourceSelection(view, markdown, {
    anchor: selectedSourceRange(view).from + markdown.length,
  });
}

export {
  insertSourceCodeBlock,
  insertSourceLink,
  insertSourceMarkdown,
  toggleSourceInlineMarker,
  toggleSourceList,
};
export type { MarkdownListType };
