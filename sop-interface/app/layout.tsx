import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SOP Workflow Studio",
  description: "Enterprise Standard Operating Procedure Engine and Visual Canvas Builder",
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
      suppressHydrationWarning // ◄ 1. ADDED HERE FOR THE HTML INJECTED CLASSES
    >
      <body 
        className="min-h-full flex flex-col"
        suppressHydrationWarning // ◄ 2. ADDED HERE TO SILENCE GRAMMARLY EXTENSION INJECTIONS
      >
        {children}
      </body>
    </html>
  );
}