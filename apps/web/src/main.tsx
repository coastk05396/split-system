import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AppProviders, type AppDeps } from "./app/AppProviders.js";
import { routes } from "./app/routes.js";
import { detectLocale } from "./i18n/detect.js";
import { setLocale } from "./i18n/messages.js";
import { createGoogleSignIn } from "./platform/google.js";
import { createLineSignIn } from "./platform/line.js";
import "./styles.css";

const deps: AppDeps = {
  fetch: (input, init) => fetch(input, init),
  line: createLineSignIn(import.meta.env.VITE_LIFF_ID),
  google: createGoogleSignIn(import.meta.env.VITE_GOOGLE_CLIENT_ID),
  testSignIn: import.meta.env.DEV || import.meta.env.VITE_TEST_SIGN_IN === "1",
};

// Speak the device's language from the first paint; a signed-in User's own choice takes over.
setLocale(detectLocale());

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");

createRoot(root).render(
  <StrictMode>
    <AppProviders deps={deps}>
      <RouterProvider router={createBrowserRouter(routes)} />
    </AppProviders>
  </StrictMode>,
);
