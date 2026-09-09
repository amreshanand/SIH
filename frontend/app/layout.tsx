import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UrbanSense AI — Urban Mobility Intelligence",
  description: "Transforming public transport buses into mobile urban sensing units",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined') {
                window.addEventListener('error', function(e) {
                  if (e.filename && e.filename.includes('chrome-extension://')) {
                    e.stopImmediatePropagation();
                  }
                });
                window.addEventListener('unhandledrejection', function(e) {
                  var str = String(e.reason || '') + String(e.reason && e.reason.stack || '');
                  if (str.includes('chrome-extension://') || str.includes('chrome: call method')) {
                    e.stopImmediatePropagation();
                    e.preventDefault();
                  }
                });
              }
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning className="min-h-full bg-slate-50 text-slate-900 antialiased">
        <Sidebar />
        <main className="ml-56 min-h-screen bg-slate-50 text-slate-900">{children}</main>
      </body>

    </html>
  );
}
