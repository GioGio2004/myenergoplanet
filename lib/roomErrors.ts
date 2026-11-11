import { ConvexError } from "convex/values";
import type { RoomErrorCode, RoomErrorData } from "@/convex/shared";

/** The machine-readable code of a room error thrown by a Convex mutation, if any. */
export function roomErrorCode(error: unknown): RoomErrorCode | null {
  if (error instanceof ConvexError) {
    const data = error.data as Partial<RoomErrorData> | undefined;
    if (data && typeof data.code === "string") return data.code as RoomErrorCode;
  }
  return null;
}

/** A short, human message for any error from a room mutation. */
export function roomErrorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as Partial<RoomErrorData> | undefined;
    if (data && typeof data.message === "string") return data.message;
  }
  return "Something went wrong. Check the connection and try again.";
}
