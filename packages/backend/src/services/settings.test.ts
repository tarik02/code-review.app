import { describe, expect, it } from 'vite-plus/test';
import {
  parseCodeAppearanceSettings,
  validateCodeAppearanceSettings,
} from './settings.ts';

describe('code appearance settings', () => {
  it('returns defaults when no persisted settings exist', () => {
    expect(parseCodeAppearanceSettings(null)).toEqual({
      fontFamily: 'geist-mono',
      customFontFamily: null,
      fontSizePx: 13,
      ligatures: false,
      diffThemePreset: 'pierre',
    });
  });

  it('roundtrips a valid preset font configuration', () => {
    expect(
      validateCodeAppearanceSettings({
        fontFamily: 'system-mono',
        customFontFamily: 'ignored',
        fontSizePx: 15,
        ligatures: true,
        diffThemePreset: 'github',
      }),
    ).toEqual({
      fontFamily: 'system-mono',
      customFontFamily: null,
      fontSizePx: 15,
      ligatures: true,
      diffThemePreset: 'github',
    });
  });

  it('roundtrips a valid custom font configuration', () => {
    expect(
      validateCodeAppearanceSettings({
        fontFamily: 'custom',
        customFontFamily: '  "JetBrains Mono", "Fira Code", monospace  ',
        fontSizePx: 14,
        ligatures: true,
        diffThemePreset: 'solarized',
      }),
    ).toEqual({
      fontFamily: 'custom',
      customFontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSizePx: 14,
      ligatures: true,
      diffThemePreset: 'solarized',
    });
  });

  it('rejects an empty custom font family', () => {
    expect(() =>
      validateCodeAppearanceSettings({
        fontFamily: 'custom',
        customFontFamily: '   ',
        fontSizePx: 13,
        ligatures: false,
        diffThemePreset: 'pierre',
      }),
    ).toThrow('Custom code font family is required.');
  });

  it('rejects an out-of-range font size', () => {
    expect(() =>
      validateCodeAppearanceSettings({
        fontFamily: 'geist-mono',
        customFontFamily: null,
        fontSizePx: 19,
        ligatures: false,
        diffThemePreset: 'pierre',
      }),
    ).toThrow('Code font size must be an integer between 11 and 18.');
  });

  it('rejects an unknown theme preset while parsing back to default', () => {
    expect(parseCodeAppearanceSettings({ diffThemePreset: 'unknown' })).toMatchObject({
      diffThemePreset: 'pierre',
    });

    expect(() =>
      validateCodeAppearanceSettings({
        fontFamily: 'geist-mono',
        customFontFamily: null,
        fontSizePx: 13,
        ligatures: false,
        diffThemePreset: 'midnight' as 'pierre',
      }),
    ).toThrow('Unsupported diff theme preset.');
  });
});
