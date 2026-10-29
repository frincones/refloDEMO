import type { Metadata } from "next";
import { SpriteIconos } from "@/components/Iconos";
import { Shell } from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Torre de Promesa · Reflo",
  description: "Demo de preconfirmación de entregas COD para Reflo (TDX)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <SpriteIconos />
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
