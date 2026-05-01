import { useEffect, useMemo } from 'react';
import type { VirtualFileMetrics } from '@pierre/diffs';
import { useQuery } from '@tanstack/react-query';
import { codeAppearanceSettingsQueryOptions } from '../queries/forge';
import type {
  CodeAppearanceFontFamily,
  CodeAppearanceSettings,
  DiffThemePreset,
} from '../types/forge';

const DEFAULT_CODE_APPEARANCE_SETTINGS: CodeAppearanceSettings = {
  fontFamily: 'geist-mono',
  customFontFamily: null,
  fontSizePx: 13,
  ligatures: false,
  diffThemePreset: 'pierre',
};

const DEFAULT_VIRTUAL_FILE_METRICS: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: 20,
  diffHeaderHeight: 44,
  hunkSeparatorHeight: 32,
  fileGap: 8,
};

function resolveCodeFontFamily(
  fontFamily: CodeAppearanceFontFamily,
  customFontFamily: string | null,
) {
  switch (fontFamily) {
    case 'system-mono':
      return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
    case 'custom':
      return (
        customFontFamily?.trim() ||
        '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      );
    case 'geist-mono':
    default:
      return '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  }
}

function resolveLigatureFontFeatures(ligatures: boolean) {
  return ligatures ? '"liga" 1, "calt" 1' : '"liga" 0, "calt" 0';
}

function resolveDiffTheme(diffThemePreset: DiffThemePreset) {
  switch (diffThemePreset) {
    case 'github':
      return { light: 'github-light', dark: 'github-dark' } as const;
    case 'catppuccin':
      return { light: 'catppuccin-latte', dark: 'catppuccin-mocha' } as const;
    case 'solarized':
      return { light: 'solarized-light', dark: 'solarized-dark' } as const;
    case 'pierre':
    default:
      return { light: 'pierre-light', dark: 'pierre-dark' } as const;
  }
}

function resolveVirtualFileMetrics(fontSizePx: number): VirtualFileMetrics {
  const lineHeight = fontSizePx + 7;

  return {
    hunkLineCount: DEFAULT_VIRTUAL_FILE_METRICS.hunkLineCount,
    lineHeight,
    diffHeaderHeight: lineHeight + 24,
    hunkSeparatorHeight: lineHeight + 12,
    fileGap: DEFAULT_VIRTUAL_FILE_METRICS.fileGap,
  };
}

function useCodeAppearance() {
  const codeAppearanceQuery = useQuery(codeAppearanceSettingsQueryOptions());
  const settings = codeAppearanceQuery.data ?? DEFAULT_CODE_APPEARANCE_SETTINGS;

  const resolvedAppearance = useMemo(() => {
    const codeFontFamily = resolveCodeFontFamily(settings.fontFamily, settings.customFontFamily);
    const virtualFileMetrics = resolveVirtualFileMetrics(settings.fontSizePx);
    const codeLineHeightPx = virtualFileMetrics.lineHeight;

    return {
      settings,
      codeFontFamily,
      codeFontSizePx: settings.fontSizePx,
      codeLineHeightPx,
      ligatureFontFeatures: resolveLigatureFontFeatures(settings.ligatures),
      diffTheme: resolveDiffTheme(settings.diffThemePreset),
      virtualFileMetrics,
    };
  }, [settings]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--app-code-font-family', resolvedAppearance.codeFontFamily);
    rootStyle.setProperty('--app-code-font-size', `${resolvedAppearance.codeFontSizePx}px`);
    rootStyle.setProperty('--app-code-line-height', `${resolvedAppearance.codeLineHeightPx}px`);
    rootStyle.setProperty('--app-code-font-features', resolvedAppearance.ligatureFontFeatures);
  }, [
    resolvedAppearance.codeFontFamily,
    resolvedAppearance.codeFontSizePx,
    resolvedAppearance.codeLineHeightPx,
    resolvedAppearance.ligatureFontFeatures,
  ]);

  return {
    ...resolvedAppearance,
    isLoading: codeAppearanceQuery.isLoading,
    error: codeAppearanceQuery.error,
  };
}

export {
  DEFAULT_CODE_APPEARANCE_SETTINGS,
  DEFAULT_VIRTUAL_FILE_METRICS,
  resolveCodeFontFamily,
  resolveDiffTheme,
  resolveLigatureFontFeatures,
  resolveVirtualFileMetrics,
  useCodeAppearance,
};
