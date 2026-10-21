import { handleCodexTranscription } from "@/mine/stt/codex.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function OPTIONS() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key",
  } });
}
export async function POST(request) {
  return handleCodexTranscription(request);
}
