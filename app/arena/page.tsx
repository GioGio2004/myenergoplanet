import type { Metadata } from "next";
import ArenaLoader from "@/components/arena/ArenaLoader";
import { GAME_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${GAME_NAME} · Arena`,
};

// Local match on the host screen (keyboard players and bots) until phones are connected.
export default function ArenaPage() {
  return <ArenaLoader />;
}
