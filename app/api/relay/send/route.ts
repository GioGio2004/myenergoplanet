import { MAX_MESSAGE_LENGTH, isChannel, publish } from "@/lib/relay/hub";

/** Wi-Fi relay: `POST /api/relay/send` with `{"ch": channel, "d": message}`. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const { ch, d } = (body ?? {}) as { ch?: unknown; d?: unknown };
  if (typeof ch !== "string" || !isChannel(ch)) return new Response("Bad channel", { status: 400 });
  if (typeof d !== "string" || d.length > MAX_MESSAGE_LENGTH) {
    return new Response("Bad message", { status: 400 });
  }
  const delivered = publish(ch, d);
  return Response.json({ delivered }, { headers: { "Cache-Control": "no-store" } });
}
