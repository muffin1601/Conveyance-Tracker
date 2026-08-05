import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";

/**
 * Applies the saved theme before the browser paints, so a dark-mode user never
 * sees a white flash. This has to be a blocking inline script in <head> — any
 * React-driven alternative runs after first paint, which is exactly the flash
 * it exists to prevent. It is a static string, so there is nothing to inject.
 */
const THEME_SCRIPT = `try{
  var t = localStorage.getItem('theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
}catch(e){}`;

export const metadata: Metadata = {
  title: "Watcon Conveyance Tracker",
  description: "Enterprise employee travel & conveyance management platform",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Watcon Tracker", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#5b5bf5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
