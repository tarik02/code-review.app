import {
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { HomeRoute } from "./routes/home-route";
import { ProfilesRoute } from "./routes/profiles-route";
import { SettingsLayout } from "./routes/settings-layout";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRoute,
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
