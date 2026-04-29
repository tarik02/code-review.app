import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import {
  setThemePreference as persistThemePreference,
  themePreferenceQueryOptions,
} from "../queries/forge";
import type { ThemePreference as AppThemePreference } from "../types/forge";

type Theme = Exclude<AppThemePreference, "auto">;
type ThemePreference = AppThemePreference;
type ThemeTransitionKind = "reveal" | "fade" | "none";
type ThemeTransitionOptions = {
  kind?: ThemeTransitionKind;
  trigger?: HTMLElement | null;
};

const THEME_STORAGE_KEY = "theme";
const THEME_TRANSITION_ACTIVE_CLASS = "theme-view-transition-active";
const THEME_REVEAL_TRANSITION_CLASS = "theme-reveal-transition";
const THEME_FADE_TRANSITION_CLASS = "theme-fade-transition";

function getSystemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredPreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "auto";
  }

  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark") {
      return value;
    }
  } catch {
    // Ignore storage errors and fall back to the system preference.
  }

  return "auto";
}

function resolveTheme(preference: ThemePreference, systemTheme: Theme): Theme {
  return preference === "auto" ? systemTheme : preference;
}

function applyDocumentTheme(theme: Theme) {
  const root = document.documentElement;
  const isDark = theme === "dark";
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
}

function shouldReduceMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useTheme() {
  const queryClient = useQueryClient();
  const themePreferenceQuery = useQuery(themePreferenceQueryOptions());
  const themePreferenceQueryKey = themePreferenceQueryOptions().queryKey;
  const [preference, setPreferenceState] = useState<ThemePreference>(() => getStoredPreference());
  const [systemTheme, setSystemThemeState] = useState<Theme>(() => getSystemTheme());
  const isTransitionActiveRef = useRef(false);
  const initialStoredPreferenceRef = useRef(preference);
  const preferenceRef = useRef(preference);
  const systemThemeRef = useRef(systemTheme);

  const theme = resolveTheme(preference, systemTheme);
  const isDark = theme === "dark";

  const themePreferenceMutation = useMutation({
    mutationFn: persistThemePreference,
    onSuccess: (settings) => {
      queryClient.setQueryData(themePreferenceQueryKey, settings);
    },
  });

  useLayoutEffect(() => {
    applyDocumentTheme(theme);
  }, [theme]);

  useEffect(() => {
    preferenceRef.current = preference;
  }, [preference]);

  useEffect(() => {
    systemThemeRef.current = systemTheme;
  }, [systemTheme]);

  useEffect(() => {
    const persistedPreference = themePreferenceQuery.data?.preference;
    if (!persistedPreference) {
      return;
    }

    if (persistedPreference === "auto" && initialStoredPreferenceRef.current !== "auto") {
      const legacyPreference = initialStoredPreferenceRef.current;
      initialStoredPreferenceRef.current = "auto";
      queryClient.setQueryData(themePreferenceQueryKey, {
        preference: legacyPreference,
      });
      themePreferenceMutation.mutate(legacyPreference);
      return;
    }

    if (persistedPreference === preferenceRef.current) {
      return;
    }

    preferenceRef.current = persistedPreference;
    applyDocumentTheme(resolveTheme(persistedPreference, systemThemeRef.current));
    setPreferenceState(persistedPreference);
  }, [
    queryClient,
    themePreferenceMutation,
    themePreferenceQuery.data?.preference,
    themePreferenceQueryKey,
  ]);

  useEffect(() => {
    try {
      if (preference === "auto") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, preference);
      }
    } catch {
      // Ignore storage errors.
    }
  }, [preference]);

  const runThemeTransition = useCallback(
    ({
      kind,
      trigger,
      update,
    }: {
      kind: ThemeTransitionKind;
      trigger?: HTMLElement | null;
      update: () => void;
    }) => {
      if (
        kind === "none" ||
        typeof document === "undefined" ||
        typeof document.startViewTransition !== "function" ||
        shouldReduceMotion() ||
        isTransitionActiveRef.current
      ) {
        update();
        return;
      }

      const root = document.documentElement;
      const actualKind =
        kind === "reveal" && trigger !== null && trigger !== undefined ? "reveal" : "fade";
      const transitionClass =
        actualKind === "reveal" ? THEME_REVEAL_TRANSITION_CLASS : THEME_FADE_TRANSITION_CLASS;
      const rect = trigger?.getBoundingClientRect();
      const revealCenter =
        actualKind === "reveal" && rect
          ? {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            }
          : null;

      isTransitionActiveRef.current = true;
      root.classList.add(THEME_TRANSITION_ACTIVE_CLASS, transitionClass);

      let transition: ViewTransition;
      try {
        transition = document.startViewTransition(() => {
          flushSync(update);
        });
      } catch {
        root.classList.remove(THEME_TRANSITION_ACTIVE_CLASS, transitionClass);
        isTransitionActiveRef.current = false;
        update();
        return;
      }

      void (async () => {
        try {
          await transition.ready;

          if (actualKind === "reveal" && revealCenter) {
            const radius = Math.hypot(
              Math.max(revealCenter.x, window.innerWidth - revealCenter.x),
              Math.max(revealCenter.y, window.innerHeight - revealCenter.y),
            );
            const animation = root.animate(
              {
                clipPath: [
                  `circle(0px at ${revealCenter.x}px ${revealCenter.y}px)`,
                  `circle(${radius}px at ${revealCenter.x}px ${revealCenter.y}px)`,
                ],
              },
              {
                duration: 500,
                easing: "ease-in-out",
                pseudoElement: "::view-transition-new(root)",
              },
            );

            await animation.finished.catch(() => undefined);
          }
        } catch {
          // Ignore skipped transitions and fall through to cleanup.
        }

        await transition.finished.catch(() => undefined);
        root.classList.remove(THEME_TRANSITION_ACTIVE_CLASS, transitionClass);
        isTransitionActiveRef.current = false;
      })();
    },
    [],
  );

  const setPreference = useCallback(
    (nextPreference: ThemePreference, options: ThemeTransitionOptions = {}) => {
      const currentPreference = preferenceRef.current;
      const currentSystemTheme = systemThemeRef.current;
      const currentTheme = resolveTheme(currentPreference, currentSystemTheme);
      const nextTheme = resolveTheme(nextPreference, currentSystemTheme);
      const previousPreference = currentPreference;
      const update = () => {
        preferenceRef.current = nextPreference;
        applyDocumentTheme(nextTheme);
        setPreferenceState(nextPreference);
      };

      queryClient.setQueryData(themePreferenceQueryKey, {
        preference: nextPreference,
      });

      runThemeTransition({
        kind: currentTheme === nextTheme ? "none" : (options.kind ?? "fade"),
        trigger: options.trigger,
        update,
      });

      themePreferenceMutation.mutate(nextPreference, {
        onError: () => {
          queryClient.setQueryData(themePreferenceQueryKey, {
            preference: previousPreference,
          });
          preferenceRef.current = previousPreference;
          applyDocumentTheme(resolveTheme(previousPreference, systemThemeRef.current));
          setPreferenceState(previousPreference);
        },
      });
    },
    [queryClient, runThemeTransition, themePreferenceMutation, themePreferenceQueryKey],
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (event: MediaQueryListEvent) => {
      const nextSystemTheme = event.matches ? "dark" : "light";
      const currentSystemTheme = systemThemeRef.current;

      if (nextSystemTheme === currentSystemTheme) {
        return;
      }

      const currentPreference = preferenceRef.current;
      const currentTheme = resolveTheme(currentPreference, currentSystemTheme);
      const nextTheme = resolveTheme(currentPreference, nextSystemTheme);
      const update = () => {
        systemThemeRef.current = nextSystemTheme;
        applyDocumentTheme(nextTheme);
        setSystemThemeState(nextSystemTheme);
      };

      runThemeTransition({
        kind: currentPreference === "auto" && currentTheme !== nextTheme ? "fade" : "none",
        update,
      });
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [runThemeTransition]);

  useEffect(() => {
    return () => {
      const root = document.documentElement;
      root.classList.remove(
        THEME_TRANSITION_ACTIVE_CLASS,
        THEME_REVEAL_TRANSITION_CLASS,
        THEME_FADE_TRANSITION_CLASS,
      );
      isTransitionActiveRef.current = false;
    };
  }, []);

  return { theme, isDark, preference, setPreference };
}

export { useTheme };
export type { Theme, ThemePreference, ThemeTransitionKind, ThemeTransitionOptions };
