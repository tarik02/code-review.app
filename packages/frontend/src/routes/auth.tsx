import { Navigate, createFileRoute } from '@tanstack/react-router';
import { useAuthSession } from '../app/auth-session';
import { AuthGateScreen } from '../components/ui/auth-gate-screen';

function AuthRoute() {
  const {
    providerAccounts,
    providerStatuses,
    isCheckingAuth,
    hasReadyProvider,
    gateStatus,
    providerStatusMessage,
    isSigningIn,
    signIn,
    checkAgain,
  } = useAuthSession();

  if (hasReadyProvider) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthGateScreen
      status={gateStatus.status}
      message={providerStatusMessage}
      isChecking={isCheckingAuth}
      isSigningIn={isSigningIn}
      accounts={providerAccounts}
      statuses={providerStatuses}
      onSignIn={signIn}
      onCheckAgain={checkAgain}
    />
  );
}

export const Route = createFileRoute('/auth')({
  component: AuthRoute,
});
