import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CDN Module Gaze",
  description: "Monitor the activities of each server when exploring the cdn server",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
