import type { Metadata, Viewport } from "next";
import { Banner } from "@/components/shell/Banner";
import { Footer } from "@/components/shell/Footer";
import { Header } from "@/components/shell/Header";
import { NoticeDialog } from "@/components/shell/NoticeDialog";
import { PromoToast } from "@/components/shell/PromoToast";
import s from "@/components/shell/shell.module.css";
import { OG_IMAGE, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import "./globals.css";

// Fables' head (fables.fi, index.html): one title on every route, theme colour #100f0f, favicon.ico (16, 32, 48 px) and a
// 180 px apple-touch-icon. The title and description are clim's own and say it is not affiliated; no route sets a title
// of its own; shared links get a large card (OG_IMAGE); nothing is indexed (public/robots.txt disallows every path too).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  robots: { index: false, follow: false },
  icons: { icon: [{ url: "/favicon.ico", sizes: "16x16 32x32 48x48" }], apple: [{ url: "/apple-touch-icon.png" }] },
  openGraph: { type: "website", siteName: SITE_NAME, title: SITE_TITLE, description: SITE_DESCRIPTION, url: SITE_URL, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION, images: [OG_IMAGE] },
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
        <NoticeDialog />
      </body>
    </html>
  );
}
