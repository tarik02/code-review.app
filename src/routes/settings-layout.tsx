import {
  Link,
  Outlet,
  useCanGoBack,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { ArrowLeftIcon } from "@heroicons/react/20/solid";
import { TopBar } from "../components/ui/top-bar";

function SettingsLayout() {
  const router = useRouter();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();

  function handleBackToPrs() {
    if (canGoBack) {
      router.history.back();
      return;
    }

    void navigate({ to: "/" });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink-900">
      <aside className="flex flex-col w-64 shrink-0 border-r border-neutral-300 bg-canvas dark:border-neutral-700">
        <TopBar aria-hidden="true" position="left" className="cursor-grab app-region-drag" />

        <div className="grow flex flex-col justify-between px-3 py-4">
          <div className="mb-6 px-2">
            <p className="text-xs font-medium uppercase text-ink-500">rudu</p>
            <h1 className="mt-1 text-lg font-semibold text-ink-900">
              Settings
            </h1>
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            <Link
              activeProps={{
                className: "bg-canvasDark text-ink-900",
              }}
              className="rounded-md px-2 py-2 text-sm font-medium text-ink-600 transition hover:bg-canvasDark hover:text-ink-900"
              to="/settings/appearance"
            >
              Appearance
            </Link>
            <Link
              activeProps={{
                className: "bg-canvasDark text-ink-900",
              }}
              className="rounded-md px-2 py-2 text-sm font-medium text-ink-600 transition hover:bg-canvasDark hover:text-ink-900"
              to="/settings/profiles"
            >
              Profiles
            </Link>
          </nav>

          <button
            className="inline-flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-ink-600 transition hover:bg-canvasDark hover:text-ink-900"
            onClick={handleBackToPrs}
            type="button"
          >
            <ArrowLeftIcon className="size-4" />
            Back to PRs
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export { SettingsLayout };
