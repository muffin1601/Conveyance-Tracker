"use client";

import { useEffect } from "react";

/**
 * Registers the offline service worker.
 *
 * This used to live in an inline <script> in the root layout, which React warns
 * about — a script tag rendered by a component never executes on a client
 * render, so the registration was silently skipped on any client-side pass.
 * Registration is a post-load side effect with no reason to block anything, so
 * an effect in a client component is its natural home.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development") {
      void navigator.serviceWorker
        .getRegistrations()
        .then(async (registrations) => {
          const appRegistrations = registrations.filter((registration) =>
            [registration.installing, registration.waiting, registration.active].some(
              (worker) => worker?.scriptURL.endsWith("/sw.js"),
            ),
          );
          await Promise.all(appRegistrations.map((registration) => registration.unregister()));
          await window.caches.delete("watcon-v1");
        })
        .catch((error: unknown) => {
          console.error("Failed to disable the app service worker in development.", error);
        });
      return;
    }

    // Registration competes with the app's own first data fetches; waiting for
    // load keeps it off the critical path.
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
