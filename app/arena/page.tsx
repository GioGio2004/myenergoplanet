import type { Metadata } from "next";
import ArenaLoader from "@/components/arena/ArenaLoader";
import { GAME_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${GAME_NAME} · Arena`,
};

/**
 * `/arena` is a local practice match (keyboard players and bots).
 * `/arena?room=CODE` plays the players of an online room (opened by its host screen).
 */
export default async function ArenaPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { room } = await searchParams;
  return <ArenaLoader roomCode={typeof room === "string" ? room : null} />;
}
