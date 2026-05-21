import { RouterProvider } from '@tanstack/react-router';
import { AuthSessionProvider } from './app/auth-session';
import { AppToastProvider } from './components/ui/toast';
import { useCodeAppearance } from './hooks/use-code-appearance';
import { router } from './router';

function App() {
  useCodeAppearance();

  return (
    <AppToastProvider>
      <AuthSessionProvider>
        <RouterProvider router={router} />
      </AuthSessionProvider>
    </AppToastProvider>
  );
}

export default App;
