import type { Metadata, Viewport } from "next";
import { Geist_Mono, Libre_Franklin } from "next/font/google";
import { CategoryIconSprite } from "@/components/icons";
import "./globals.css";

// Open-licence stand-in for the council's Franklin Gothic headings.
const franklin = Libre_Franklin({
  variable: "--font-franklin",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Report a street problem | Southampton City Council", template: "%s | Southampton City Council" },
  description: "Report potholes, fly-tipping, broken street lights and other street problems in Southampton, and track their progress.",
};

export const viewport: Viewport = { themeColor: "#00193c" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`${franklin.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <CategoryIconSprite />
        {children}
      </body>
    </html>
  );
}
