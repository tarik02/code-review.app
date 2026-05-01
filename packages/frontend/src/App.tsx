import { RouterProvider } from '@tanstack/react-router';
import { AuthSessionProvider } from './app/auth-session';
import { useCodeAppearance } from './hooks/use-code-appearance';
import { router } from './router';

function App() {
  useCodeAppearance();

  return (
    <AuthSessionProvider>
      <RouterProvider router={router} />
    </AuthSessionProvider>
  );
}

export default App;
