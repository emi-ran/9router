import { handleVoiceCreate } from "@/mine/voice/handler.js";

// No OPTIONS handler and no Access-Control-* headers: this endpoint is not for browsers directly.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  return handleVoiceCreate(request);
}
