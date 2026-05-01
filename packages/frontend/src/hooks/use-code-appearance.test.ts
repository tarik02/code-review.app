import { describe, expect, it } from 'vite-plus/test';
import {
  resolveCodeFontFamily,
  resolveDiffTheme,
  resolveLigatureFontFeatures,
  resolveVirtualFileMetrics,
} from './use-code-appearance';

describe('use-code-appearance helpers', () => {
  it('maps theme presets to diff themes', () => {
    expect(resolveDiffTheme('github')).toEqual({
      light: 'github-light',
      dark: 'github-dark',
    });
    expect(resolveDiffTheme('catppuccin')).toEqual({
      light: 'catppuccin-latte',
      dark: 'catppuccin-mocha',
    });
  });

  it('resolves font family stacks', () => {
    expect(resolveCodeFontFamily('geist-mono', null)).toContain('Geist Mono');
    expect(resolveCodeFontFamily('system-mono', null)).toContain('ui-monospace');
    expect(resolveCodeFontFamily('custom', '"JetBrains Mono", monospace')).toBe(
      '"JetBrains Mono", monospace',
    );
  });

  it('derives virtual file metrics from font size', () => {
    expect(resolveVirtualFileMetrics(13)).toEqual({
      hunkLineCount: 50,
      lineHeight: 20,
      diffHeaderHeight: 44,
      hunkSeparatorHeight: 32,
      fileGap: 8,
    });
    expect(resolveVirtualFileMetrics(15)).toMatchObject({
      lineHeight: 22,
      diffHeaderHeight: 46,
      hunkSeparatorHeight: 34,
    });
  });

  it('maps the ligatures toggle to font feature settings', () => {
    expect(resolveLigatureFontFeatures(true)).toBe('"liga" 1, "calt" 1');
    expect(resolveLigatureFontFeatures(false)).toBe('"liga" 0, "calt" 0');
  });
});
