import type { Metadata } from "next";
import "./globals.css";
import AppLayout from "@/components/layout/app-layout";
import { ErrorBoundary } from "@/components/layout/error-boundary";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { StartupSync } from "@/components/startup-sync";
import { AuthInit } from "@/components/auth/auth-init";

export const metadata: Metadata = {
  title: "Stellar Toolkit Dashboard",
  description: "A comprehensive toolkit for the Stellar network",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <body
        suppressHydrationWarning
        className="bg-background font-sans antialiased"
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <AuthInit />
          <StartupSync />
          <ErrorBoundary label="Application error">
            <AppLayout>{children}</AppLayout>
          </ErrorBoundary>
          <Toaster
            position="bottom-right"
            toastOptions={{
              className: "bg-card text-card-foreground border-border",
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
