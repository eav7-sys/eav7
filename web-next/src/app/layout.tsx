import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import { ScanHeader } from "@/components/scan/header";
import { TestnetBanner } from "@/components/testnet-banner";
import { SiteFooter } from "@/components/site-footer";
import { I18nProvider } from "@/i18n/provider";
import { DEFAULT_LOCALE, LOCALE_COOKIE, dirOf, isLocale } from "@/i18n/locales";

/** Tipografia do desenho EAVScan.dc.html: Space Grotesk + Inter + JetBrains Mono. */
const display = Space_Grotesk({
  variable: "--font-display-src",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});
const sans = Inter({
  variable: "--font-sans-src",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});
const mono = JetBrains_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://eavscan.com"),
  title: "EAV7 Scan — Explorador da blockchain EAV7",
  description:
    "Explorador oficial da blockchain EAV7 — protocolo eav20, consenso DPoS com finalidade BFT, segurança pós-quântica, tokens EAV20, NFTs EAV721, nomes EAV-NS, governança on-chain, ponte trustless e camada nativa de IA. Consulte blocos, transações, tokens, NFTs, validadores e endereços em tempo real.",
  applicationName: "EAV7 Scan",
  openGraph: {
    type: "website",
    siteName: "EAV7 Scan",
    locale: "pt_BR",
  },
};

// Evita flash de tema errado: aplica a preferência salva OU a do sistema antes da pintura.
const themeInit = `(function(){try{var t=localStorage.getItem('eav7-theme');if(!t){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full flex flex-col">
        <I18nProvider initialLocale={locale}>
          <Providers>
            <TestnetBanner />
            <ScanHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
