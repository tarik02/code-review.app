import { Navigate, createFileRoute } from '@tanstack/react-router';
import { useAuthSession } from '../app/auth-session';
import { MainApp } from '../app/main-app';

type HomeRouteSearch = {
  providerId?: string;
  repoKey?: string;
  pr?: number;
};

function parsePositiveInteger(value: unknown) {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function validateHomeRouteSearch(search: Record<string, unknown>): HomeRouteSearch {
  const providerId =
    typeof search.providerId === 'string' && search.providerId.trim().length > 0
      ? search.providerId
      : undefined;
  const repoKey =
    typeof search.repoKey === 'string' && search.repoKey.trim().length > 0
      ? search.repoKey
      : undefined;
  const pr = parsePositiveInteger(search.pr);

  return { providerId, repoKey, pr };
}

function HomeRoute() {
  const { providerStatuses, isCheckingAuth, hasReadyProvider } = useAuthSession();

  if (isCheckingAuth && Object.keys(providerStatuses).length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <p className="text-center text-base">checking provider auth status</p>
      </div>
    );
  }

  if (!hasReadyProvider) {
    return <Navigate to="/auth" replace />;
  }

  return <MainApp />;
}

export const Route = createFileRoute('/')({
  validateSearch: validateHomeRouteSearch,
  component: HomeRoute,
});

export type { HomeRouteSearch };
