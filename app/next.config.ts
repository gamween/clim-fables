import type { NextConfig } from "next";
import { RPC_URLS } from "./src/lib/rpc";

const isDev = process.env.NODE_ENV === "development";

// The showcase only reads: the browser may talk to this site and to the public Robinhood Chain RPCs, nothing else.
// No wallet provider, relay or analytics endpoint can be reached (connect-src), no form can post anywhere
// (form-action 'none'), and no other site may frame the app (frame-ancestors 'none').
const rpcOrigins = [...new Set([...RPC_URLS.mainnet, ...RPC_URLS.testnet].map((u) => new URL(u).origin))];
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self' ${rpcOrigins.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  async redirects() {
    // The spec named the pool page /pool/eth-usdg; the app mirrors Fables' route, /markets/eth.
    return [{ source: "/pool/eth-usdg", destination: "/markets/eth", permanent: false }];
  },
};

export default nextConfig;
