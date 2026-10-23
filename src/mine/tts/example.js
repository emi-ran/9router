const MODEL = "cx/speak";
const PATH = "/v1/audio/speech";
export function buildSpeechRequest({ input, language = "en-US", speed = 1, apiKey = "" }) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Enter text to synthesize");
  if (typeof language !== "string" || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) throw new Error("Language must be a valid tag, such as en-US or tr");
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error("Speed must be between 0.5 and 2");
  return { method: "POST", headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ model: MODEL, input: input.trim(), response_format: "mp3", pronunciation_language: language, speed }) };
}
const shellQuote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;
export function buildSpeechCurl(endpoint, input, language = "en-US", speed = 1) {
  if (typeof language !== "string" || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) throw new Error("Language must be a valid tag, such as en-US or tr");
  const body = JSON.stringify({ model: MODEL, input: input || "Hello, world!", pronunciation_language: language, speed, response_format: "mp3" });
  return [`curl -X POST ${shellQuote(`${endpoint}${PATH}`)}`, `  -H 'Content-Type: application/json'`, `  -H 'Authorization: Bearer YOUR_KEY'`, `  -d ${shellQuote(body)}`, `  --output speech.mp3`].join(" \\\n");
}
export async function readSpeechResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const data = contentType.includes("application/json") ? await response.json() : await response.text();
    const message = data?.error?.message || data?.error || data;
    throw new Error(typeof message === "string" && message ? message : `HTTP ${response.status}`);
  }
  if (!contentType.toLowerCase().startsWith("audio/")) throw new Error("The speech endpoint did not return audio");
  const blob = await response.blob();
  if (!blob.size) throw new Error("The speech endpoint returned empty audio");
  return blob;
}
