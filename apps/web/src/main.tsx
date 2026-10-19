import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import { Loading, ToastHost } from "./components/chrome";
import { SessionProvider } from "./lib/session";
import { Landing } from "./pages/Landing";

const Explore = lazy(() => import("./pages/Explore").then((m) => ({ default: m.Explore })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const ConsoleLayout = lazy(() => import("./pages/console/Layout").then((m) => ({ default: m.ConsoleLayout })));
const Overview = lazy(() => import("./pages/console/Overview").then((m) => ({ default: m.Overview })));
const Applications = lazy(() => import("./pages/console/Applications").then((m) => ({ default: m.Applications })));
const ApplicationDetail = lazy(() => import("./pages/console/ApplicationDetail").then((m) => ({ default: m.ApplicationDetail })));
const Loans = lazy(() => import("./pages/console/Loans").then((m) => ({ default: m.Loans })));
const LoanDetail = lazy(() => import("./pages/console/LoanDetail").then((m) => ({ default: m.LoanDetail })));
const Farmers = lazy(() => import("./pages/console/Farmers").then((m) => ({ default: m.Farmers })));
const FarmerDetail = lazy(() => import("./pages/console/FarmerDetail").then((m) => ({ default: m.FarmerDetail })));
const NewFarmer = lazy(() => import("./pages/console/NewFarmer").then((m) => ({ default: m.NewFarmer })));
const Alerts = lazy(() => import("./pages/console/Alerts").then((m) => ({ default: m.Alerts })));
const Dealers = lazy(() => import("./pages/console/Dealers").then((m) => ({ default: m.Dealers })));
const Ussd = lazy(() => import("./pages/console/Ussd").then((m) => ({ default: m.Ussd })));
const Messages = lazy(() => import("./pages/console/Messages").then((m) => ({ default: m.Messages })));
const PolicyPage = lazy(() => import("./pages/console/Policy").then((m) => ({ default: m.PolicyPage })));
const Activity = lazy(() => import("./pages/console/Activity").then((m) => ({ default: m.Activity })));
const DealerPortal = lazy(() => import("./pages/DealerPortal").then((m) => ({ default: m.DealerPortal })));
const NotFound = lazy(() => import("./pages/NotFound").then((m) => ({ default: m.NotFound })));

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <ToastHost>
          <BrowserRouter>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/explore" element={<Explore />} />
                <Route path="/login" element={<Login />} />
                <Route path="/dealer" element={<DealerPortal />} />
                <Route path="/console" element={<ConsoleLayout />}>
                  <Route index element={<Overview />} />
                  <Route path="applications" element={<Applications />} />
                  <Route path="applications/:id" element={<ApplicationDetail />} />
                  <Route path="loans" element={<Loans />} />
                  <Route path="loans/:id" element={<LoanDetail />} />
                  <Route path="farmers" element={<Farmers />} />
                  <Route path="farmers/new" element={<NewFarmer />} />
                  <Route path="farmers/:id" element={<FarmerDetail />} />
                  <Route path="alerts" element={<Alerts />} />
                  <Route path="dealers" element={<Dealers />} />
                  <Route path="ussd" element={<Ussd />} />
                  <Route path="messages" element={<Messages />} />
                  <Route path="policy" element={<PolicyPage />} />
                  <Route path="activity" element={<Activity />} />
                  <Route path="*" element={<Navigate to="/console" replace />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastHost>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
