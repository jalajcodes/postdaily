import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Bundled fonts: the app UI uses Inter; carousels can use any of these.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/playfair-display/600.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/playfair-display/600-italic.css";
import "./index.css";
import { tokenStore } from "./lib/api";
import { registerServiceWorker } from "./lib/push";
import { Layout } from "./components/Layout";
import { LoginPage, AuthCallbackPage } from "./pages/Login";
import { TodayPage } from "./pages/Today";
import { WritePage } from "./pages/Write";
import { PlanPage } from "./pages/Plan";
import { EditorPage } from "./pages/Editor";
import { IdeasPage } from "./pages/Ideas";
import { DraftsPage } from "./pages/Drafts";
import { QueuePage } from "./pages/Queue";
import { StylePage } from "./pages/Style";
import { SettingsPage } from "./pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function RequireAuth({ children }: { children: ReactNode }) {
  return tokenStore.get() ? children : <Navigate to="/login" replace />;
}

registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<TodayPage />} />
            <Route path="write" element={<WritePage />} />
            <Route path="plan" element={<PlanPage />} />
            <Route path="posts/:id" element={<EditorPage />} />
            <Route path="drafts" element={<DraftsPage />} />
            <Route path="ideas" element={<IdeasPage />} />
            <Route path="queue" element={<QueuePage />} />
            <Route path="style" element={<StylePage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
