import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppearanceBackground } from '../../components/ui/appearance-background';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { InputNumber } from '../../components/ui/input-number';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { resolveCodeFontFamily } from '../../hooks/use-code-appearance';
import { useTheme } from '../../hooks/use-theme';
import type { ThemePreference } from '../../hooks/use-theme';
import {
  appearanceBackgroundQueryOptions,
  codeAppearanceSettingsQueryOptions,
  selectCustomBackgroundFile,
  setAppearanceBackground,
  setCodeAppearanceSettings,
} from '../../queries/forge';
import type {
  AppearanceBackgroundInput,
  AppearanceBackgroundSettings,
  CodeAppearanceFontFamily,
  CodeAppearanceSettings,
  DiffThemePreset,
} from '../../types/forge';

const themeOptions: { value: ThemePreference; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const backgroundOptions: {
  value: AppearanceBackgroundSettings['kind'];
  label: string;
}[] = [
  { value: 'default', label: 'Default' },
  { value: 'solid', label: 'Solid color' },
  { value: 'customFile', label: 'Custom file' },
];

const codeFontFamilyOptions: { value: CodeAppearanceFontFamily; label: string }[] = [
  { value: 'geist-mono', label: 'Geist Mono' },
  { value: 'system-mono', label: 'System Mono' },
  { value: 'custom', label: 'Custom' },
];

const diffThemeOptions: { value: DiffThemePreset; label: string }[] = [
  { value: 'pierre', label: 'Pierre' },
  { value: 'github', label: 'GitHub' },
  { value: 'catppuccin', label: 'Catppuccin' },
  { value: 'solarized', label: 'Solarized' },
];

const DEFAULT_CODE_APPEARANCE_SETTINGS: CodeAppearanceSettings = {
  fontFamily: 'geist-mono',
  customFontFamily: null,
  fontSizePx: 13,
  ligatures: false,
  diffThemePreset: 'pierre',
};

function getErrorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function AppearanceRoute() {
  const queryClient = useQueryClient();
  const { theme, preference, setPreference } = useTheme();
  const backgroundQuery = useQuery(appearanceBackgroundQueryOptions());
  const background = backgroundQuery.data;
  const codeAppearanceQueryOptionsValue = codeAppearanceSettingsQueryOptions();
  const codeAppearanceQuery = useQuery(codeAppearanceQueryOptionsValue);
  const codeAppearanceSettings = codeAppearanceQuery.data ?? DEFAULT_CODE_APPEARANCE_SETTINGS;
  const [draftSolidColor, setDraftSolidColor] = useState('#18181b');
  const [draftCustomFontFamily, setDraftCustomFontFamily] = useState('');
  const [codeAppearanceValidationError, setCodeAppearanceValidationError] = useState<string | null>(
    null,
  );
  const backgroundQueryKey = appearanceBackgroundQueryOptions().queryKey;
  const codeAppearanceQueryKey = codeAppearanceQueryOptionsValue.queryKey;
  const solidColor = background?.kind === 'solid' ? background.color : draftSolidColor;

  useEffect(() => {
    setDraftCustomFontFamily(codeAppearanceSettings.customFontFamily ?? '');
  }, [codeAppearanceSettings.customFontFamily]);

  const backgroundMutation = useMutation({
    mutationFn: setAppearanceBackground,
    onSuccess: (nextBackground) => {
      queryClient.setQueryData(backgroundQueryKey, nextBackground);
    },
  });
  const customFileMutation = useMutation({
    mutationFn: selectCustomBackgroundFile,
    onSuccess: (nextBackground) => {
      queryClient.setQueryData(backgroundQueryKey, nextBackground);
    },
  });
  const codeAppearanceMutation = useMutation({
    mutationFn: setCodeAppearanceSettings,
    onMutate: () => {
      setCodeAppearanceValidationError(null);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(codeAppearanceQueryKey, settings);
      setDraftCustomFontFamily(settings.customFontFamily ?? '');
    },
  });

  function updateBackground(input: AppearanceBackgroundInput) {
    backgroundMutation.mutate(input);
  }

  function updateCodeAppearance(partial: Partial<CodeAppearanceSettings>) {
    codeAppearanceMutation.mutate({
      ...codeAppearanceSettings,
      ...partial,
    });
  }

  function commitCustomFontFamily() {
    if (codeAppearanceSettings.fontFamily !== 'custom') {
      return;
    }

    const trimmedFontFamily = draftCustomFontFamily.trim();
    if (trimmedFontFamily.length === 0) {
      setCodeAppearanceValidationError('Custom code font family is required.');
      return;
    }

    updateCodeAppearance({ customFontFamily: trimmedFontFamily });
  }

  const activeBackgroundKind = background?.kind ?? 'default';
  const isSavingBackground = backgroundMutation.isPending || customFileMutation.isPending;
  const backgroundError =
    backgroundMutation.error ?? customFileMutation.error ?? backgroundQuery.error;
  const codeAppearanceError = codeAppearanceValidationError
    ? new Error(codeAppearanceValidationError)
    : (codeAppearanceMutation.error ?? codeAppearanceQuery.error);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-8">
      <div>
        <h2 className="text-xl font-semibold text-ink-900">Appearance</h2>
        <p className="mt-1 text-sm text-ink-500">Manage color theme and background preferences.</p>
      </div>

      <section className="rounded-md border border-neutral-200 bg-surface p-4 dark:border-neutral-700">
        <h3 className="text-sm font-semibold text-ink-900">Color theme</h3>
        <ToggleGroup<ThemePreference>
          className="mt-3 grid max-w-md grid-cols-3 bg-canvasDark"
          value={[preference]}
          onValueChange={(nextPreference) => {
            const selectedPreference = nextPreference[0];
            if (selectedPreference) {
              setPreference(selectedPreference);
            }
          }}
        >
          {themeOptions.map((option) => {
            return (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        <p className="mt-3 text-sm text-ink-500">
          {preference === 'auto'
            ? `Auto uses your system appearance. Current theme: ${theme}.`
            : `Current theme: ${theme}.`}
        </p>
      </section>

      <section className="rounded-md border border-neutral-200 bg-surface p-4 dark:border-neutral-700">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Background</h3>
            <ToggleGroup<AppearanceBackgroundSettings['kind']>
              className="mt-3 grid max-w-xl grid-cols-3 bg-canvasDark"
              disabled={isSavingBackground}
              value={[activeBackgroundKind]}
              onValueChange={(nextBackgroundKind) => {
                const selectedBackgroundKind = nextBackgroundKind[0];
                if (selectedBackgroundKind === 'default') {
                  updateBackground({ kind: 'default' });
                } else if (selectedBackgroundKind === 'solid') {
                  setDraftSolidColor(solidColor);
                  updateBackground({ kind: 'solid', color: solidColor });
                } else if (selectedBackgroundKind === 'customFile') {
                  customFileMutation.mutate();
                }
              }}
            >
              {backgroundOptions.map((option) => {
                return (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    {option.label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>

            {activeBackgroundKind === 'solid' ? (
              <label className="mt-4 flex max-w-sm items-center gap-3 text-sm text-ink-700">
                <span className="shrink-0 font-medium text-ink-600">Color</span>
                <Input
                  className="h-9 w-14 rounded-md border border-neutral-200 bg-surface p-1 dark:border-neutral-700"
                  disabled={isSavingBackground}
                  onChange={(event) => {
                    const nextColor = event.currentTarget.value;
                    setDraftSolidColor(nextColor);
                    updateBackground({ kind: 'solid', color: nextColor });
                  }}
                  type="color"
                  value={solidColor}
                />
                <span className="font-mono text-xs text-ink-500">{solidColor}</span>
              </label>
            ) : null}

            {activeBackgroundKind === 'customFile' ? (
              <div className="mt-4 flex flex-col items-start gap-2">
                {background?.kind === 'customFile' ? (
                  <p className="text-sm text-ink-600">
                    Selected image:{' '}
                    <span className="font-medium text-ink-900">{background.fileName}</span>
                  </p>
                ) : null}
                {background?.kind === 'customFile' && !background.dataUrl ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                    The selected image could not be loaded. Choose another image or switch
                    backgrounds.
                  </p>
                ) : null}
                <Button
                  disabled={isSavingBackground}
                  onClick={() => customFileMutation.mutate()}
                  type="button"
                >
                  {customFileMutation.isPending ? 'Choosing...' : 'Choose image...'}
                </Button>
              </div>
            ) : null}

            {backgroundError ? (
              <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger-600 dark:border-red-900/40 dark:bg-red-950/30">
                {getErrorText(backgroundError, 'Could not update background.')}
              </p>
            ) : null}
          </div>

          <AppearanceBackground
            background={background}
            className="h-36 overflow-hidden rounded-md border border-neutral-200 bg-canvas dark:border-neutral-700"
            imageClassName="h-full w-full object-cover"
          />
        </div>
      </section>

      <section className="rounded-md border border-neutral-200 bg-surface p-4 dark:border-neutral-700">
        <div>
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Code</h3>
            <p className="mt-1 text-sm text-ink-500">
              Configure typography for diffs and review code editors.
            </p>
          </div>
        </div>

        <div className="mt-5 divide-y divide-neutral-200 dark:divide-neutral-700">
          <div className="grid gap-3 py-4 first:pt-0 md:grid-cols-[minmax(0,1fr)_240px] md:items-start">
            <div>
              <h4 className="text-sm font-semibold text-ink-900">Font family</h4>
              <p className="mt-1 text-sm text-ink-500">
                Choose the monospace stack used by diffs and review code editors.
              </p>
            </div>
            <Select
              disabled={codeAppearanceMutation.isPending}
              items={codeFontFamilyOptions}
              value={codeAppearanceSettings.fontFamily}
              onValueChange={(value) => {
                const nextFontFamily = value as CodeAppearanceFontFamily;
                const nextCustomFontFamily =
                  codeAppearanceSettings.customFontFamily ||
                  draftCustomFontFamily.trim() ||
                  resolveCodeFontFamily(codeAppearanceSettings.fontFamily, null);

                if (nextFontFamily === 'custom') {
                  setDraftCustomFontFamily(nextCustomFontFamily);
                }

                updateCodeAppearance({
                  fontFamily: nextFontFamily,
                  customFontFamily: nextFontFamily === 'custom' ? nextCustomFontFamily : null,
                });
              }}
            >
              <SelectTrigger className="w-full md:justify-self-end">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {codeFontFamilyOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {codeAppearanceSettings.fontFamily === 'custom' ? (
            <div className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] md:items-start">
              <div>
                <h4 className="text-sm font-semibold text-ink-900">Custom font family</h4>
                <p className="mt-1 text-sm text-ink-500">
                  Enter a CSS font-family stack for code surfaces.
                </p>
              </div>
              <Input
                className="w-full md:justify-self-end"
                disabled={codeAppearanceMutation.isPending}
                placeholder={'"JetBrains Mono", "Fira Code", monospace'}
                value={draftCustomFontFamily}
                onBlur={commitCustomFontFamily}
                onChange={(event) => setDraftCustomFontFamily(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitCustomFontFamily();
                  }
                }}
              />
            </div>
          ) : null}

          <div className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_140px] md:items-start">
            <div>
              <h4 className="text-sm font-semibold text-ink-900">Font size</h4>
              <p className="mt-1 text-sm text-ink-500">
                Set the code text size for diffs and review editors.
              </p>
            </div>
            <InputNumber
              className="md:justify-self-end"
              disabled={codeAppearanceMutation.isPending}
              largeStep={2}
              max={18}
              min={11}
              step={1}
              value={codeAppearanceSettings.fontSizePx}
              onValueCommitted={(value) => {
                if (value == null || value === codeAppearanceSettings.fontSizePx) {
                  return;
                }

                setCodeAppearanceValidationError(null);
                updateCodeAppearance({ fontSizePx: value });
              }}
            />
          </div>

          <div className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_240px] md:items-start">
            <div>
              <h4 className="text-sm font-semibold text-ink-900">Ligatures</h4>
              <p className="mt-1 text-sm text-ink-500">
                Toggle programming ligatures for code-only surfaces.
              </p>
            </div>
            <ToggleGroup<'off' | 'on'>
              className="grid w-full grid-cols-2 bg-canvasDark md:justify-self-end"
              disabled={codeAppearanceMutation.isPending}
              value={[codeAppearanceSettings.ligatures ? 'on' : 'off']}
              onValueChange={(nextValue) => {
                const ligatureValue = nextValue[0];
                if (!ligatureValue) {
                  return;
                }

                updateCodeAppearance({ ligatures: ligatureValue === 'on' });
              }}
            >
              <ToggleGroupItem value="off">Off</ToggleGroupItem>
              <ToggleGroupItem value="on">On</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="grid gap-3 py-4 last:pb-0 md:grid-cols-[minmax(0,1fr)_240px] md:items-start">
            <div>
              <h4 className="text-sm font-semibold text-ink-900">Diff theme</h4>
              <p className="mt-1 text-sm text-ink-500">
                Choose the syntax color preset used by the diff viewer.
              </p>
            </div>
            <Select
              disabled={codeAppearanceMutation.isPending}
              items={diffThemeOptions}
              value={codeAppearanceSettings.diffThemePreset}
              onValueChange={(value) => {
                updateCodeAppearance({ diffThemePreset: value as DiffThemePreset });
              }}
            >
              <SelectTrigger className="w-full md:justify-self-end">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {diffThemeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {codeAppearanceError ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger-600 dark:border-red-900/40 dark:bg-red-950/30">
            {getErrorText(codeAppearanceError, 'Could not update code appearance settings.')}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export const Route = createFileRoute('/settings/appearance')({
  component: AppearanceRoute,
});
