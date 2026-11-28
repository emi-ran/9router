// Pure string builders for the /v1/live examples. No gateway key is ever a parameter:
// examples use YOUR_KEY or an environment variable. User text is escaped here.
import { DEFAULT_VOICE, LIVE_MODEL } from "./client.js";

export { LIVE_MODEL };

const shellQuote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;

export const LIVE_NOTE = "/v1/live sends no CORS headers. Third-party web apps must call their own backend, and must not ship the gateway key to the browser.";

// Minimal browser client. It talks to the integrator's own backend (/voice), never to /v1/live.
export const BROWSER_EXAMPLE = `<button id="start">Start call</button>
<button id="end">End call</button>
<audio id="remote" autoplay></audio>
<script type="module">
  const startButton = document.getElementById("start");
  let pc = null;
  let stream = null;
  let callId = null;

  const hangUp = (id) => fetch("/voice/" + encodeURIComponent(id), { method: "DELETE", keepalive: true });

  async function stop() {
    const id = callId;
    stream?.getTracks().forEach((track) => track.stop());
    pc?.close();
    callId = stream = pc = null;
    startButton.disabled = false;
    if (id) await hangUp(id);
  }

  startButton.onclick = async () => {
    startButton.disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const peer = (pc = new RTCPeerConnection());
      for (const track of stream.getTracks()) peer.addTrack(track, stream);
      peer.ontrack = (event) => { document.getElementById("remote").srcObject = event.streams[0]; };
      const events = peer.createDataChannel("oai-events");
      events.onmessage = ({ data }) => { if (JSON.parse(data).type === "session.closed") stop(); };
      await peer.setLocalDescription(await peer.createOffer());
      await new Promise((resolve) => {
        if (peer.iceGatheringState === "complete") return resolve();
        peer.onicegatheringstatechange = () => { if (peer.iceGatheringState === "complete") resolve(); };
        setTimeout(resolve, 3000);
      });
      // Your backend adds the gateway key and forwards the offer (see Server (Node)).
      const res = await fetch("/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: peer.localDescription.sdp }),
      });
      const answer = await res.json();
      if (!res.ok) throw new Error(answer.error?.message || "HTTP " + res.status);
      if (pc !== peer) return hangUp(answer.id); // ended while connecting
      callId = answer.id;
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    } catch (error) {
      console.error(error);
      await stop();
    }
  };

  document.getElementById("end").onclick = stop;
  addEventListener("pagehide", stop);
</script>`;

// Tiny Node backend (Node 18+) that forwards both calls to 9router with the key from the environment.
export function buildServerExample({ origin = "", voice = DEFAULT_VOICE, instructions = "" } = {}) {
  return `import http from "node:http";

const ENDPOINT = ${JSON.stringify(`${origin}/v1/live`)};
const KEY = process.env.NINE_ROUTER_KEY; // never send this key to the browser
const VOICE = ${JSON.stringify(voice || DEFAULT_VOICE)};
const INSTRUCTIONS = ${JSON.stringify(instructions || "")};
const AUTH = { Authorization: \`Bearer \${KEY}\` };

async function readBody(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text;
}

// Add your own user check before exposing this: anyone who can reach /voice spends your Codex quota.
http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  try {
    if (req.method === "POST" && path === "/voice") {
      const { sdp } = JSON.parse(await readBody(req));
      const upstream = await fetch(ENDPOINT, {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ sdp, voice: VOICE, instructions: INSTRUCTIONS }),
      });
      res.writeHead(upstream.status, { "Content-Type": "application/json" });
      res.end(await upstream.text());
    } else if (req.method === "DELETE" && /^\\/voice\\/[A-Za-z0-9_-]{1,128}$/.test(path)) {
      const upstream = await fetch(\`\${ENDPOINT}/\${path.slice("/voice/".length)}\`, { method: "DELETE", headers: AUTH });
      res.writeHead(upstream.status, { "Content-Type": "application/json" });
      res.end(await upstream.text());
    } else {
      res.writeHead(404).end();
    }
  } catch {
    res.writeHead(500).end();
  }
}).listen(3000, "127.0.0.1");`;
}

export function buildCurlExample({ origin = "", voice = DEFAULT_VOICE, instructions = "" } = {}) {
  const body = JSON.stringify({
    sdp: "v=0 ...paste the offer SDP here...",
    model: LIVE_MODEL,
    voice: voice || DEFAULT_VOICE,
    ...(instructions ? { instructions } : {}),
  });
  return [
    `curl -X POST ${shellQuote(`${origin}/v1/live`)} \\`,
    `  -H 'Authorization: Bearer YOUR_KEY' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d ${shellQuote(body)}`,
    "",
    `# Hang up with the id from the create response (same key)`,
    `curl -X DELETE ${shellQuote(`${origin}/v1/live/CALL_ID`)} \\`,
    `  -H 'Authorization: Bearer YOUR_KEY'`,
  ].join("\n");
}

export const RESPONSE_EXAMPLE = `{
  "id": "CALL_ID",
  "sdp": "v=0 ...answer SDP...",
  "expires_at": 1767225600
}`;
