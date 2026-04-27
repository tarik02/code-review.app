import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppearanceBackground } from "../components/ui/appearance-background";
import { useTheme } from "../hooks/use-theme";
import type { ThemePreference } from "../hooks/use-theme";
import {
  appearanceBackgroundQueryOptions,
  setAppearanceBackground,
  selectCustomBackgroundFile,
} from "../queries/forge";
import type {
  AppearanceBackgroundInput,
  AppearanceBackgroundSettings,
} from "../types/forge";

const themeOptions: { value: ThemePreference; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const backgroundOptions: {
  value: AppearanceBackgroundSettings["kind"];
  label: string;
}[] = [
  { value: "default", label: "Default" },
  { value: "solid", label: "Solid color" },
  { value: "customFile", label: "Custom file" },
];

function AppearanceRoute() {
  const queryClient = useQueryClient();
  const { theme, preference, setPreference } = useTheme();
  const backgroundQuery = useQuery(appearanceBackgroundQueryOptions());
  const background = backgroundQuery.data;
  const [solidColor, setSolidColor] = useState("#18181b");
  const backgroundQueryKey = appearanceBackgroundQueryOptions().queryKey;

  useEffect(() => {
    if (background?.kind === "solid") {
      setSolidColor(background.color);
    }
  }, [background]);

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

  function updateBackground(input: AppearanceBackgroundInput) {
    backgroundMutation.mutate(input);
  }

  const activeBackgroundKind = background?.kind ?? "default";
  const isSavingBackground =
    backgroundMutation.isPending || customFileMutation.isPending;
  const backgroundError =
    backgroundMutation.error ?? customFileMutation.error ?? backgroundQuery.error;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-8">
      <div>
        <h2 className="text-xl font-semibold text-ink-900">Appearance</h2>
        <p className="mt-1 text-sm text-ink-500">
          Manage color theme and background preferences.
        </p>
      </div>

      <section className="rounded-md border border-neutral-200 bg-surface p-4 dark:border-neutral-700">
        <h3 className="text-sm font-semibold text-ink-900">Color theme</h3>
        <div className="mt-3 grid max-w-md grid-cols-3 rounded-md bg-canvasDark p-0.5 text-sm font-medium text-ink-600">
          {themeOptions.map((option) => {
            const isSelected = preference === option.value;
            return (
              <button
                aria-pressed={isSelected}
                className={[
                  "rounded px-3 py-2 transition",
                  isSelected
                    ? "bg-surface text-ink-900 shadow-sm"
                    : "text-ink-500 hover:text-ink-900",
                ].join(" ")}
                key={option.value}
                onClick={(event) =>
                  setPreference(option.value, {
                    kind: "reveal",
                    trigger: event.currentTarget,
                  })
                }
                type="button"
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-ink-500">
          {preference === "auto"
            ? `Auto uses your system appearance. Current theme: ${theme}.`
            : `Current theme: ${theme}.`}
        </p>
      </section>

      <section className="rounded-md border border-neutral-200 bg-surface p-4 dark:border-neutral-700">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Background</h3>
            <div className="mt-3 grid max-w-xl grid-cols-3 rounded-md bg-canvasDark p-0.5 text-sm font-medium text-ink-600">
              {backgroundOptions.map((option) => {
                const isSelected = activeBackgroundKind === option.value;
                return (
                  <button
                    aria-pressed={isSelected}
                    className={[
                      "rounded px-3 py-2 transition",
                      isSelected
                        ? "bg-surface text-ink-900 shadow-sm"
                        : "text-ink-500 hover:text-ink-900",
                    ].join(" ")}
                    disabled={isSavingBackground}
                    key={option.value}
                    onClick={() => {
                      if (option.value === "default") {
                        updateBackground({ kind: "default" });
                      } else if (option.value === "solid") {
                        updateBackground({ kind: "solid", color: solidColor });
                      } else {
                        customFileMutation.mutate();
                      }
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {activeBackgroundKind === "solid" ? (
              <label className="mt-4 flex max-w-sm items-center gap-3 text-sm text-ink-700">
                <span className="shrink-0 font-medium text-ink-600">Color</span>
                <input
                  className="h-9 w-14 rounded-md border border-neutral-200 bg-surface p-1 dark:border-neutral-700"
                  disabled={isSavingBackground}
                  onChange={(event) => {
                    const nextColor = event.currentTarget.value;
                    setSolidColor(nextColor);
                    updateBackground({ kind: "solid", color: nextColor });
                  }}
                  type="color"
                  value={solidColor}
                />
                <span className="font-mono text-xs text-ink-500">
                  {solidColor}
                </span>
              </label>
            ) : null}

            {activeBackgroundKind === "customFile" ? (
              <div className="mt-4 flex flex-col items-start gap-2">
                {background?.kind === "customFile" ? (
                  <p className="text-sm text-ink-600">
                    Selected image:{" "}
                    <span className="font-medium text-ink-900">
                      {background.fileName}
                    </span>
                  </p>
                ) : null}
                {background?.kind === "customFile" && !background.dataUrl ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                    The selected image could not be loaded. Choose another image
                    or switch backgrounds.
                  </p>
                ) : null}
                <button
                  className="rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-ink-200 dark:text-ink-900"
                  disabled={isSavingBackground}
                  onClick={() => customFileMutation.mutate()}
                  type="button"
                >
                  {customFileMutation.isPending
                    ? "Choosing..."
                    : "Choose image..."}
                </button>
              </div>
            ) : null}

            {backgroundError ? (
              <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger-600 dark:border-red-900/40 dark:bg-red-950/30">
                {backgroundError instanceof Error
                  ? backgroundError.message
                  : "Could not update background."}
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
    </div>
  );
}

export { AppearanceRoute };
