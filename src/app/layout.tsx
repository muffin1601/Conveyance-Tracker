import type { Metadata, Viewport } from "next";
import "./globals.css";

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
      <body suppressHydrationWarning>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if ('serviceWorker' in navigator) {
                  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
                }
                var t = localStorage.getItem('theme');
                if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                }
              } catch(e){}
            `,
          }}
        />
      </body>
    </html>
  );
}
