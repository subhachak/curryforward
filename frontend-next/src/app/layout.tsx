import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import { RecipesProvider } from "@/context/RecipesContext";
import { AssistantProvider } from "@/context/AssistantContext";
import { NavBar } from "@/components/NavBar";
import { AuthFooterControl } from "@/components/AuthFooterControl";

export const metadata: Metadata = {
  title: "CurryForward",
  description: "A living recipe collection - browse, customize, and generate recipes through chat.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AuthProvider>
          <ToastProvider>
            <RecipesProvider>
              <AssistantProvider>
                <NavBar />
                <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
                  {children}
                </main>
                <footer className="relative flex items-center justify-center gap-2 border-t border-border py-4 text-center text-xs text-muted">
                  <span>CurryForward - recipes with roots, adapted for today.</span>
                  <span className="absolute right-4">
                    <AuthFooterControl />
                  </span>
                </footer>
              </AssistantProvider>
            </RecipesProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
