import type { Metadata } from "next";
import { JoinCode } from "@/components/phone/JoinCode";
import { GAME_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Join · ${GAME_NAME}`,
};

export default function JoinPage() {
  return <JoinCode />;
}
