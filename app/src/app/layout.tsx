import type { Metadata, Viewport } from "next";
import { Banner } from "@/components/shell/Banner";
import { Footer } from "@/components/shell/Footer";
import { Header } from "@/components/shell/Header";
import { PromoToast } from "@/components/shell/PromoToast";
import s from "@/components/shell/shell.module.css";
import { BANNER_TEXT, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: `${BANNER_TEXT}. Fables' live dynamic fee on Robinhood Chain next to clim's verifiable volatility desk, read only.`,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#100f0f", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <div className={s.shell}>
          <Banner />
          <Header />
          <main className={s.main}>{children}</main>
          <Footer />
        </div>
        <PromoToast />
      </body>
    </html>
  );
}
