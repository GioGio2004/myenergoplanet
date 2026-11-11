import { MAX_CHANNELS_PER_STREAM, isChannel, subscribe } from "@/lib/relay/hub";

/** Keep-alive comment so proxies and phones do not drop an idle stream. */
const KEEPALIVE_MS = 15_000;

/**
 * Server-sent events for the Wi-Fi relay: `GET /api/relay/stream?ch=<key>.down,...`.
 * Each event's data is `{"ch": channel, "d": message}`.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const channels = (url.searchParams.get("ch") ?? "")
    .split(",")
    .filter(isChannel)
    .slice(0, MAX_CHANNELS_PER_STREAM);
  if (channels.length === 0) return new Response("No valid channels", { status: 400 });

  const encoder = new TextEncoder();
  let stop = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      const unsubscribe = subscribe(channels, (ch, d) => {
        send(`data: ${JSON.stringify({ ch, d })}\n\n`);
      });
      const keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);
      stop = () => {
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      request.signal.addEventListener("abort", () => stop());
      // Tell the browser how soon to reconnect, and flush headers right away.
      send("retry: 1000\n\n");
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform stops the server's gzip from buffering the stream.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
