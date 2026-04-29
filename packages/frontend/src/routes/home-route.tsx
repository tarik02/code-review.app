import { Navigate } from '@tanstack/react-router';
import { useAuthSession } from '../app/auth-session';
import { MainApp } from '../app/main-app';

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

export { HomeRoute };
