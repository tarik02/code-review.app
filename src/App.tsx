import { RouterProvider } from "@tanstack/react-router";
import { AuthSessionProvider } from "./app/auth-session";
import { router } from "./router";

function App() {
  return (
    <AuthSessionProvider>
      <RouterProvider router={router} />
    </AuthSessionProvider>
  );
}

export default App;
