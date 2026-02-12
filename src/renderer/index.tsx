import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { AppErrorBoundary } from "./components/layout/ErrorBoundary";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  </React.StrictMode>
);

