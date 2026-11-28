import { handleVoiceDelete } from "@/mine/voice/handler.js";

// No OPTIONS handler and no Access-Control-* headers (see ../route.js).
export const runtime = "nodejs";
export const maxDuration = 60;

export async function DELETE(request, { params }) {
  const { id } = await params;
  return handleVoiceDelete(request, id);
}
