import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import { RecipesProvider } from "@/context/RecipesContext";
import { AssistantProvider } from "@/context/AssistantContext";
import { NavBar } from "@/components/NavBar";
import { AuthFooterControl } from "@/components/AuthFooterControl";
import { PageViewTracker } from "@/components/PageViewTracker";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Curry Forward — Recipes with roots",
    template: "%s · Curry Forward",
  },
  description: "A living collection of Indian and global recipes with Bengali roots, adapted for today's kitchen.",
  applicationName: "Curry Forward",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Curry Forward",
    title: "Curry Forward — Recipes with roots",
    description: "Indian and global recipes with Bengali roots, adapted for today's kitchen.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Curry Forward — Recipes with roots",
    description: "Indian and global recipes with Bengali roots, adapted for today's kitchen.",
  },
  icons: {
    icon: "/brand/cf/logos/favicon.svg",
    apple: "/brand/cf/logos/app-icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF7F1" },
    { media: "(prefers-color-scheme: dark)", color: "#211411" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('curryforward-theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AuthProvider>
          <ToastProvider>
            <RecipesProvider>
              <AssistantProvider>
                <PageViewTracker />
                <NavBar />
                <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
                  {children}
                </main>
                <footer className="heritage-footer relative border-t border-border bg-surface px-4 py-10 sm:px-6">
                  <div className="mx-auto grid max-w-[1280px] gap-8 sm:grid-cols-[1fr_auto] sm:items-end">
                    <div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/brand/cf/logos/logo-primary-light.svg" alt="Curry Forward" className="footer-logo-light h-12 w-auto" />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/brand/cf/logos/logo-primary-dark.svg" alt="Curry Forward" className="footer-logo-dark hidden h-12 w-auto" />
                      <p className="mt-4 text-sm text-muted">Recipes with roots, adapted for today.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-muted">
                      <Link href="/recipes?published=1" className="inline-flex min-h-11 items-center hover:text-brand">Recipes</Link>
                      <Link href="/#bengali-sweets" className="inline-flex min-h-11 items-center hover:text-brand">Bengali Kitchen</Link>
                      <Link href="/recipes?published=1&q=Collections" className="inline-flex min-h-11 items-center hover:text-brand">Collections</Link>
                      <span><AuthFooterControl /></span>
                    </div>
                  </div>
                </footer>
              </AssistantProvider>
            </RecipesProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
