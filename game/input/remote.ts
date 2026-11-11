import { gameConfig } from "../config";
import type { InputSource, PlayerInput } from "../types";

/** The latest controller sample from a phone, written by the network layer. */
export type RemoteInputState = {
  x: number;
  y: number;
  dash: boolean;
  brace: boolean;
  /** `performance.now()` of the last packet; 0 = never. */
  receivedAt: number;
};

export function createRemoteInputState(): RemoteInputState {
  return { x: 0, y: 0, dash: false, brace: false, receivedAt: 0 };
}

/**
 * An input source fed by a phone. Always uses the latest packet; if nothing arrived for
 * `wrestler.inputTimeoutMs` (phone asleep, connection dropped), the wrestler gets neutral input.
 */
export function createRemoteSource(
  state: RemoteInputState,
  now: () => number = () => performance.now(),
): InputSource {
  const timeout = gameConfig.wrestler.inputTimeoutMs;
  return {
    sample(out: PlayerInput) {
      if (state.receivedAt === 0 || now() - state.receivedAt > timeout) {
        out.x = 0;
        out.y = 0;
        out.dash = false;
        out.brace = false;
        return;
      }
      out.x = state.x;
      out.y = state.y;
      out.dash = state.dash;
      out.brace = state.brace;
    },
  };
}
