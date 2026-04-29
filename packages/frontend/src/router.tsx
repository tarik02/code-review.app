import {
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthRoute } from "./routes/auth-route";
import { AppearanceRoute } from "./routes/appearance-route";
import { HomeRoute } from "./routes/home-route";
import { ProfilesRoute } from "./routes/profiles-route";
import { ReviewRoute } from "./routes/review-route";
import { SettingsLayout } from "./routes/settings-layout";
import { SETTINGS_RETURN_HREF_STORAGE_KEY } from "./lib/settings-return-location";

type HomeRouteSearch = {
  providerId?: string;
  repoKey?: string;
  pr?: number;
};

function parsePositiveInteger(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function validateHomeRouteSearch(
  search: Record<string, unknown>,
): HomeRouteSearch {
  const providerId =
    typeof search.providerId === "string" && search.providerId.trim().length > 0
      ? search.providerId
      : undefined;
  const repoKey =
    typeof search.repoKey === "string" && search.repoKey.trim().length > 0
      ? search.repoKey
      : undefined;
  const pr = parsePositiveInteger(search.pr);

  return { providerId, repoKey, pr };
}

const rootRoute = createRootRoute({
  component: RootRoute,
});

function isSettingsPath(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

function RootRoute() {
  const location = useLocation();

  useEffect(() => {
    if (isSettingsPath(location.pathname)) {
      return;
    }

    window.sessionStorage.setItem(
      SETTINGS_RETURN_HREF_STORAGE_KEY,
      location.href,
    );
  }, [location.href, location.pathname]);

  return <Outlet />;
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: validateHomeRouteSearch,
  component: HomeRoute,
});

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "auth",
  component: AuthRoute,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  component: SettingsLayout,
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings") {
      throw redirect({ to: "/settings/appearance" });
    }
  },
});

const appearanceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "appearance",
  component: AppearanceRoute,
});

const profilesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "profiles",
  component: ProfilesRoute,
});

const reviewRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "review",
  component: ReviewRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  authRoute,
  settingsRoute.addChildren([appearanceRoute, profilesRoute, reviewRoute]),
]);

const router = createRouter({
  routeTree,
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export { router };
export type { HomeRouteSearch };
