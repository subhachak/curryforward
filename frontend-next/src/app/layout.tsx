import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";
import { NavBar } from "@/components/NavBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Curryforward",
  description: "Your recipes — seeded, generated, and customized through chat.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AuthProvider>
          <ToastProvider>
            <NavBar />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
              {children}
            </main>
            <footer className="border-t border-border py-4 text-center text-xs text-muted">
              Curryforward — local-first recipe agent
            </footer>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
