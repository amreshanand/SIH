import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import TopHeader from "@/components/layout/TopHeader";

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
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
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
      <body suppressHydrationWarning className="min-h-full bg-[#f8fafc] text-slate-900 antialiased selection:bg-blue-600 selection:text-white">
        <Sidebar />
        <div className="ml-60 min-h-screen flex flex-col bg-[#f8fafc]">
          <TopHeader />
          <main className="flex-1 p-6 md:p-8 bg-command-grid">{children}</main>
        </div>
      </body>

    </html>
  );
}
