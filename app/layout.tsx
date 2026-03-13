import type { Metadata } from "next";
import "./globals.css";
import AppLayout from "@/components/layout/app-layout";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

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
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body
        suppressHydrationWarning
        className="bg-background font-sans antialiased"
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <AppLayout>{children}</AppLayout>
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
