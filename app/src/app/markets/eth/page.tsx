import type { Metadata } from "next";
import { EthUsdgPool } from "@/components/pool/EthUsdgPool";

export const metadata: Metadata = { title: "ETH / USDG" };

export default function EthUsdgPage() {
  return <EthUsdgPool />;
}
