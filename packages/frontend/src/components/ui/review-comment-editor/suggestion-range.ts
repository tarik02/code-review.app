import type { ForgeProviderKind } from '../../../types/forge';
import type { SuggestionRange, SuggestionSourceLine } from './types';

function parseGitlabSuggestionRange(
  language: string,
  anchorLine: number,
  fallbackRange: SuggestionRange,
): SuggestionRange {
  const match = /^suggestion:-(\d+)\+(\d+)$/.exec(language);
  if (!match) {
    return fallbackRange;
  }

  return {
    from: anchorLine - Number(match[1]),
    to: anchorLine + Number(match[2]),
  };
}

function clampSuggestionRange(range: SuggestionRange, sourceLines: SuggestionSourceLine[]) {
  if (sourceLines.length === 0) {
    return range;
  }

  const minLine = sourceLines[0]?.line ?? range.from;
  const maxLine = sourceLines[sourceLines.length - 1]?.line ?? range.to;
  const from = Math.min(Math.max(range.from, minLine), maxLine);
  const to = Math.min(Math.max(range.to, from), maxLine);

  return { from, to };
}

function getSuggestionLanguageForRange(
  provider: ForgeProviderKind,
  anchorLine: number,
  range: SuggestionRange,
) {
  if (provider !== 'gitlab') {
    return 'suggestion';
  }

  return `suggestion:-${Math.max(anchorLine - range.from, 0)}+${Math.max(
    range.to - anchorLine,
    0,
  )}`;
}

export { clampSuggestionRange, getSuggestionLanguageForRange, parseGitlabSuggestionRange };
