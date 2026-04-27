import {
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AuthRoute } from "./routes/auth-route";
import { HomeRoute } from "./routes/home-route";
import { ProfilesRoute } from "./routes/profiles-route";
import { SettingsLayout } from "./routes/settings-layout";

type HomeRouteSearch = {
  repo?: string;
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
  const repo =
    typeof search.repo === "string" && search.repo.trim().length > 0
      ? search.repo
      : undefined;
  const pr = parsePositiveInteger(search.pr);

  return { repo, pr };
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

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
      throw redirect({ to: "/settings/profiles" });
    }
  },
});

const profilesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "profiles",
  component: ProfilesRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  authRoute,
  settingsRoute.addChildren([profilesRoute]),
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
