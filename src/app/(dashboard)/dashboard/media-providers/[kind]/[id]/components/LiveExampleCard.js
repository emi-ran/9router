"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Card } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { createLiveCall, checkCallOptions, DEFAULT_VOICE, LIVE_MODEL } from "@/mine/voice/client.js";
import { BROWSER_EXAMPLE, LIVE_NOTE, RESPONSE_EXAMPLE, buildCurlExample, buildServerExample } from "@/mine/voice/example.js";
import { Row } from "./exampleShared";

const subscribeOrigin = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

const TABS = [
  { id: "browser", label: "Browser" },
  { id: "server", label: "Server (Node)" },
  { id: "curl", label: "curl" },
];
const MAX_TRANSCRIPT_LINES = 200;
const IDLE = { phase: "idle", reason: "", error: "", expiresAt: null, canStart: true, canEnd: false };

function statusLine(call, remaining) {
  switch (call.phase) {
    case "mic": return "Asking for microphone access...";
    case "connecting": return "Connecting...";
    case "connected": return `Connected · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} left`;
    case "ended": return `Ended: ${call.reason || "call finished"}`;
    default: return "Idle";
  }
}

// Live voice call demo. The gateway key stays in component state and is never written to code examples.
export function LiveExampleCard() {
  const endpoint = useSyncExternalStore(subscribeOrigin, getOrigin, getServerOrigin);
  const [apiKey, setApiKey] = useState("");
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [instructions, setInstructions] = useState("");
  const [tab, setTab] = useState("browser");
  const [call, setCall] = useState(IDLE);
  const [transcript, setTranscript] = useState([]);
  const [clock, setClock] = useState(0);
  const controllerRef = useRef(null);
  const audioRef = useRef(null);
  const mountedRef = useRef(false);
  const { copied, copy } = useCopyToClipboard();

  const optionError = checkCallOptions({ voice, instructions });
  const origin = endpoint || "";
  const code = tab === "browser" ? BROWSER_EXAMPLE
    : tab === "server" ? buildServerExample({ origin, voice, instructions })
      : buildCurlExample({ origin, voice, instructions });

  const getController = () => {
    if (!controllerRef.current) {
      controllerRef.current = createLiveCall({
        fetch: (url, init) => fetch(url, init),
        RTCPeerConnection: window.RTCPeerConnection,
        getUserMedia: navigator.mediaDevices?.getUserMedia
          ? (constraints) => navigator.mediaDevices.getUserMedia(constraints)
          : undefined,
        onUpdate: (next) => {
          if (!mountedRef.current) return;
          setCall(next);
          setClock(Date.now());
        },
        onRemoteStream: (stream) => { if (audioRef.current) audioRef.current.srcObject = stream; },
        onEvent: (line) => { if (mountedRef.current) setTranscript((prev) => [...prev.slice(-(MAX_TRANSCRIPT_LINES - 1)), line]); },
      });
    }
    return controllerRef.current;
  };

  useEffect(() => {
    mountedRef.current = true;
    const leave = () => { controllerRef.current?.end("left the page", { keepalive: true }); };
    window.addEventListener("pagehide", leave);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);

  useEffect(() => {
    if (call.phase !== "connected") return undefined;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [call.phase]);

  const remaining = call.expiresAt ? Math.max(0, Math.ceil(call.expiresAt - clock / 1000)) : 0;
  const canStart = call.canStart && !!apiKey && !optionError;

  const handleStart = () => {
    if (!canStart) return;
    setTranscript([]);
    void getController().start({ apiKey, voice, instructions });
  };

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">Example</h2>
      <div className="flex flex-col gap-2.5">
        <Row label="Model"><code>{LIVE_MODEL}</code></Row>
        <Row label="Endpoint"><code className="text-xs break-all">{endpoint}/v1/live</code></Row>
        <Row label="API Key">
          <input type="password" aria-label="Gateway API key" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Gateway API key (required)" className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background" />
        </Row>
        <Row label="Voice">
          <input type="text" aria-label="Voice" aria-invalid={!!optionError} value={voice} onChange={(e) => setVoice(e.target.value)} maxLength={32} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background" />
        </Row>
        <Row label="Instructions (optional)">
          <textarea aria-label="Instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={16000} rows={3} placeholder="You are a helpful voice assistant." className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background" />
        </Row>
        {optionError && <p role="alert" className="text-xs text-red-500 break-words">{optionError}</p>}
        <p className="text-xs text-text-muted">Use a 9Router gateway key, not your Codex OAuth token. Examples use YOUR_KEY or an environment variable.</p>
        <p className="text-xs text-text-muted">{LIVE_NOTE}</p>

        <div className="flex flex-wrap justify-between gap-2 mt-2">
          <span className="text-xs font-semibold text-text-muted uppercase">Call</span>
          <div className="flex gap-3">
            <button type="button" onClick={handleStart} disabled={!canStart} className="px-3 py-1 rounded-lg bg-primary text-white text-xs disabled:opacity-50">Start call</button>
            <button type="button" onClick={() => getController().end("ended by user")} disabled={!call.canEnd} className="px-3 py-1 rounded-lg border border-border text-xs disabled:opacity-50">End call</button>
          </div>
        </div>
        <p role="status" className="text-xs text-text-muted">{statusLine(call, remaining)}</p>
        {call.error && <p role="alert" className="text-xs text-red-500 break-words">{call.error}</p>}
        <audio ref={audioRef} autoPlay />
        {transcript.length > 0 && (
          <ul aria-label="Transcript" className="flex flex-col gap-1 text-xs max-h-48 overflow-y-auto">
            {transcript.map((line, index) => (
              <li key={index} className="break-words"><span className="font-medium">{line.speaker}: </span>{line.text}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap justify-between gap-2 mt-2">
          <span className="text-xs font-semibold text-text-muted uppercase">Request</span>
          <button type="button" onClick={() => copy(code)} className="text-xs text-primary">{copied ? "Copied" : "Copy"}</button>
        </div>
        <div role="group" aria-label="Request example" className="flex flex-wrap gap-1.5">
          {TABS.map((item) => (
            <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => setTab(item.id)} className={`px-2.5 py-1 rounded-lg text-xs border border-border ${tab === item.id ? "bg-primary text-white" : ""}`}>{item.label}</button>
          ))}
        </div>
        <pre className="max-w-full bg-sidebar rounded-lg px-3 py-2.5 text-xs overflow-x-auto whitespace-pre">{code}</pre>

        <span className="text-xs font-semibold text-text-muted uppercase mt-2">Response (example)</span>
        <pre className="max-w-full bg-sidebar rounded-lg px-3 py-2.5 text-xs overflow-x-auto whitespace-pre">{RESPONSE_EXAMPLE}</pre>
      </div>
    </Card>
  );
}
