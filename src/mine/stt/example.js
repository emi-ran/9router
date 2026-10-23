// Browser-only request helpers: gateway keys never become upstream OAuth credentials.
const MODEL = "cx/transcribe";
const PATH = "/v1/audio/transcriptions";
function checkFormat(format) {
  if (format !== "json" && format !== "text") throw new Error("Unsupported response format");
}

function checkLanguage(language) {
  if (language !== "" && !/^[a-zA-Z]{2}$/.test(language)) throw new Error("Language must be a two-letter code, such as tr or en");
}

export function buildTranscriptionRequest(file, format = "json", apiKey = "", language = "") {
  checkFormat(format);
  checkLanguage(language);
  const body = new FormData();
  body.append("file", file);
  body.append("model", MODEL);
  body.append("response_format", format);
  if (language) body.append("language", language.toLowerCase());
  return { method: "POST", headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, body };
}

const shellQuote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;
export function buildTranscriptionCurl(endpoint, filename = "audio.mp3", format = "json", language = "") {
  checkFormat(format);
  checkLanguage(language);
  // curl's multipart parser needs its own filename quoting inside the shell argument.
  const escapedFilename = filename.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return [
    `curl -X POST ${shellQuote(`${endpoint}${PATH}`)}`,
    `  -H 'Authorization: Bearer YOUR_KEY'`,
    `  -F ${shellQuote(`file=@"${escapedFilename}"`)}`,
    `  -F 'model=${MODEL}'`,
    `  -F 'response_format=${format}'`,
    ...(language ? [`  -F 'language=${language.toLowerCase()}'`] : []),
  ].join(" \\\n");
}

export async function readTranscriptionResponse(response) {
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json() : await response.text();
  if (!response.ok) {
    const message = data?.error?.message || data?.error || data;
    throw new Error(typeof message === "string" && message ? message : `HTTP ${response.status}`);
  }
  return data;
}
