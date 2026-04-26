import { AuthGateScreen } from "../components/ui/auth-gate-screen";
import { useAuthSession } from "../app/auth-session";
import { MainApp } from "../app/main-app";

function HomeRoute() {
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

  if (isCheckingAuth && Object.keys(providerStatuses).length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <p className="text-center text-base">checking provider auth status</p>
      </div>
    );
  }

  if (!hasReadyProvider) {
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

  return <MainApp />;
}

export { HomeRoute };
