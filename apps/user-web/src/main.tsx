import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { PwaUpdatePrompt } from "./PwaUpdatePrompt";
import { OfflineIndicator } from "./OfflineIndicator";
import { PwaInstallTracker } from "./PwaInstallTracker";
import { ToastProvider, ToastViewport } from "@bt/shared/ui";
import "@bt/shared/ui/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
      <ToastViewport />
      <PwaUpdatePrompt />
      <OfflineIndicator />
      <PwaInstallTracker />
    </ToastProvider>
  </React.StrictMode>,
);
