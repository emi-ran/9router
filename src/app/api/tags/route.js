import { buildModelsList } from "../v1/models/route.js";

export async function GET() {
  const data = await buildModelsList(["llm"]);
  return Response.json({ models: data.map((model) => ({ name: model.id, model: model.id })) }, { headers: { "Access-Control-Allow-Origin": "*" } });
}

export async function OPTIONS() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" } });
}
