import type { Metadata } from "next";
import { PlayerApp } from "@/components/phone/PlayerApp";
import { GAME_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Join · ${GAME_NAME}`,
};

/** Opened on phones from the QR code. */
export default async function PlayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PlayerApp rawCode={code} />;
}
