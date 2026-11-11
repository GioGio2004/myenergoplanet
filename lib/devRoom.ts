import { randomRoomCode } from "./roomCode";

// Phase 1 stand-in for the Convex `rooms.create` mutation (wired in phase 2).
export async function createRoomStub(): Promise<{ code: string }> {
  await new Promise((resolve) => setTimeout(resolve, 900));
  return { code: randomRoomCode() };
}
