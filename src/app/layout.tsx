import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Redman — Reddit Social Listening",
  description: "Redman tracks Reddit keywords, surfaces buyer-intent threads, and audits brand chatter in real time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
