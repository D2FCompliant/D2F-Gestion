import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") || incoming.get("host") || "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;
  const title = "D2F Gestion — Pilotez votre activité";
  const description = "Clients, dossiers, revenus et priorités réunis dans un cockpit de gestion clair.";
  return {
    title,
    description,
    icons: {
      icon: [{ url: "/d2f-gestion-logo.png", type: "image/png" }],
      apple: "/d2f-gestion-logo.png",
    },
    openGraph: { title, description, type: "website", images: [{ url: socialImage, width: 1731, height: 909, alt: "D2F Gestion — Pilotez votre activité" }] },
    twitter: { card: "summary_large_image", title, description, images: [socialImage] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
