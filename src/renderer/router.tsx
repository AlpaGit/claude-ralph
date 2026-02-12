import {
  createHashRouter,
  createRoutesFromElements,
  Route,
} from "react-router-dom";
import { AppShell } from "./components/AppShell/AppShell";
import { PlanListView } from "./views/PlanListView";
import { PlanDetailView } from "./views/PlanDetailView";
import { DiscoveryView } from "./views/DiscoveryView";
import { LiveRunView } from "./views/LiveRunView";
import { SettingsView } from "./views/SettingsView";

/**
 * Application router.
 *
 * Uses createHashRouter because Electron serves from file:// which does not
 * support the HTML5 history API required by createBrowserRouter.
 *
 * AppShell is the layout route -- it renders a Sidebar + <Outlet /> for child
 * routes so every view shares the same chrome.
 */
export const router = createHashRouter(
  createRoutesFromElements(
    <Route element={<AppShell />}>
      <Route path="/" element={<PlanListView />} />
      <Route path="/plan/:planId" element={<PlanDetailView />} />
      <Route path="/discovery" element={<DiscoveryView />} />
      <Route path="/run/:runId" element={<LiveRunView />} />
      <Route path="/settings" element={<SettingsView />} />
    </Route>
  )
);
