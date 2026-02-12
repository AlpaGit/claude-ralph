import {
  createHashRouter,
  createRoutesFromElements,
  Route,
} from "react-router-dom";
import { AppShell } from "./components/AppShell/AppShell";
import { RouteErrorBoundary } from "./components/layout/ErrorBoundary";
import { PlanListView } from "./views/PlanListView";
import { PlanDetailView } from "./views/PlanDetailView";
import { DiscoveryView } from "./views/DiscoveryView";
import { LiveRunView } from "./views/LiveRunView";
import { ProjectMemoryView } from "./views/ProjectMemoryView";
import { SettingsView } from "./views/SettingsView";

/**
 * Application router.
 *
 * Uses createHashRouter because Electron serves from file:// which does not
 * support the HTML5 history API required by createBrowserRouter.
 *
 * AppShell is the layout route -- it renders a Sidebar + <Outlet /> for child
 * routes so every view shares the same chrome.
 *
 * Each route element is wrapped in RouteErrorBoundary so a per-view crash
 * shows an error card with retry / navigate-home instead of tearing down the
 * entire app.
 */
export const router = createHashRouter(
  createRoutesFromElements(
    <Route element={<AppShell />}>
      <Route path="/" element={<RouteErrorBoundary><PlanListView /></RouteErrorBoundary>} />
      <Route path="/plan/:planId" element={<RouteErrorBoundary><PlanDetailView /></RouteErrorBoundary>} />
      <Route path="/discovery" element={<RouteErrorBoundary><DiscoveryView /></RouteErrorBoundary>} />
      <Route path="/project-memory" element={<RouteErrorBoundary><ProjectMemoryView /></RouteErrorBoundary>} />
      <Route path="/run/:runId" element={<RouteErrorBoundary><LiveRunView /></RouteErrorBoundary>} />
      <Route path="/settings" element={<RouteErrorBoundary><SettingsView /></RouteErrorBoundary>} />
    </Route>
  )
);
