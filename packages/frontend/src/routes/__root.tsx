import { Outlet, createRootRoute, useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';
import { SETTINGS_RETURN_HREF_STORAGE_KEY } from '../lib/settings-return-location';

function isSettingsPath(pathname: string) {
  return pathname === '/settings' || pathname.startsWith('/settings/');
}

function RootRoute() {
  const location = useLocation();

  useEffect(() => {
    if (isSettingsPath(location.pathname)) {
      return;
    }

    window.sessionStorage.setItem(SETTINGS_RETURN_HREF_STORAGE_KEY, location.href);
  }, [location.href, location.pathname]);

  return <Outlet />;
}

export const Route = createRootRoute({
  component: RootRoute,
});
