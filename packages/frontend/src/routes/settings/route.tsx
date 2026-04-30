import { Link, Outlet, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useHotkey } from '@tanstack/react-hotkeys';
import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { TopBar } from '../../components/ui/top-bar';
import { SETTINGS_RETURN_HREF_STORAGE_KEY } from '../../lib/settings-return-location';

function SettingsLayout() {
  const navigate = useNavigate();

  function handleBackToPrs() {
    const returnHref = window.sessionStorage.getItem(SETTINGS_RETURN_HREF_STORAGE_KEY);

    if (returnHref) {
      void navigate({ href: returnHref });
      return;
    }

    void navigate({ to: '/' });
  }

  useHotkey('Escape', () => {
    handleBackToPrs();
  });

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink-900">
      <aside className="flex flex-col w-64 shrink-0 border-r border-neutral-300 bg-canvas dark:border-neutral-700">
        <TopBar aria-hidden="true" position="left" className="cursor-grab app-region-drag" />

        <div className="grow flex flex-col justify-between px-3 py-4">
          <div className="mb-6 px-2">
            <p className="text-xs font-medium uppercase text-ink-500">code-review.app</p>
            <h1 className="mt-1 text-lg font-semibold text-ink-900">Settings</h1>
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            <Link
              activeProps={{
                className: 'bg-canvasDark text-ink-900',
              }}
              className="rounded-md px-2 py-2 text-sm font-medium text-ink-600 transition hover:bg-canvasDark hover:text-ink-900"
              to="/settings/appearance"
            >
              Appearance
            </Link>
            <Link
              activeProps={{
                className: 'bg-canvasDark text-ink-900',
              }}
              className="rounded-md px-2 py-2 text-sm font-medium text-ink-600 transition hover:bg-canvasDark hover:text-ink-900"
              to="/settings/profiles"
            >
              Profiles
            </Link>
            <Link
              activeProps={{
                className: 'bg-canvasDark text-ink-900',
              }}
              className="rounded-md px-2 py-2 text-sm font-medium text-ink-600 transition hover:bg-canvasDark hover:text-ink-900"
              to="/settings/review"
            >
              Review
            </Link>
          </nav>

          <Button
            className="justify-start px-2 text-ink-600 hover:bg-canvasDark hover:text-ink-900"
            size="default"
            variant="ghost"
            onClick={handleBackToPrs}
            type="button"
          >
            <ArrowLeftIcon className="size-4" />
            Back to PRs
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
});
