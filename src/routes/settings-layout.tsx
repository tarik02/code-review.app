import { Link, Outlet } from "@tanstack/react-router";
import { ArrowLeftIcon } from "@heroicons/react/20/solid";
import { trpc } from "../lib/trpc";

function SettingsLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink-900">
      <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-300 bg-canvas px-3 py-4 dark:border-neutral-700">
        <div
          aria-hidden="true"
          className="h-8 shrink-0 cursor-grab bg-canvas active:cursor-grabbing"
          // style={dragRegionStyle}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            if (event.detail === 2) {
              void trpc.window.toggleMaximize.mutate();
            }
          }}
        />

        <div className="mb-6 px-2">
          <p className="text-xs font-medium uppercase text-ink-500">rudu</p>
          <h1 className="mt-1 text-lg font-semibold text-ink-900">Settings</h1>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
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

        <Link
          className="inline-flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-ink-600 transition hover:bg-canvasDark hover:text-ink-900"
          to="/"
        >
          <ArrowLeftIcon className="size-4" />
          Back to PRs
        </Link>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export { SettingsLayout };
