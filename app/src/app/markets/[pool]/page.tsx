import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TestnetPool } from "@/components/pool/TestnetPool";
import { POOL_SLUGS } from "@/lib/chain/deployments";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(POOL_SLUGS).map((pool) => ({ pool }));
}

export async function generateMetadata({ params }: { params: Promise<{ pool: string }> }): Promise<Metadata> {
  const { pool } = await params;
  return { title: `Pool ${POOL_SLUGS[pool] ?? ""} (testnet)` };
}

export default async function TestnetPoolPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = await params;
  const name = POOL_SLUGS[pool];
  if (!name) notFound();
  return <TestnetPool name={name} />;
}
