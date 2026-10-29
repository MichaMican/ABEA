import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, type PlatformAdapter } from "@abea/shared";
import "@abea/shared/styles.css";

const platform: PlatformAdapter = {
  kind: "web",
  os: "web",
  supportsSsoRedirect: true,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
);
