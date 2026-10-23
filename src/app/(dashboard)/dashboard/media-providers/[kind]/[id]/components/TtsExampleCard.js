"use client";

import { useState, useSyncExternalStore } from "react";
import { Card } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { buildSpeechRequest, buildSpeechCurl, readSpeechResponse } from "@/mine/tts/example.js";
import { Row } from "./exampleShared";

const subscribeOrigin = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export function TtsExampleCard() {
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState("en-US");
  const [speed, setSpeed] = useState(1);
  const [apiKey, setApiKey] = useState("");
  const endpoint = useSyncExternalStore(subscribeOrigin, getOrigin, getServerOrigin);
  const [audioUrl, setAudioUrl] = useState("");
  const [latency, setLatency] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const { copied, copy } = useCopyToClipboard();
  const curl = buildSpeechCurl(endpoint, input, language, Number(speed));

  const handleRun = async () => {
    if (!input.trim() || running) return;
    setRunning(true); setError(""); setLatency(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl("");
    const start = Date.now();
    try {
      const response = await fetch("/api/v1/audio/speech", buildSpeechRequest({ input, language, speed: Number(speed), apiKey }));
      const audio = await readSpeechResponse(response);
      setAudioUrl(URL.createObjectURL(audio));
      setLatency(Date.now() - start);
    } catch (e) {
      setError(e.message || "Network error");
    } finally { setRunning(false); }
  };

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">Example</h2>
      <div className="flex flex-col gap-2.5">
        <Row label="Model"><code>cx/speak</code></Row>
        <Row label="Endpoint"><code className="text-xs break-all">{endpoint}/v1/audio/speech</code></Row>
        <Row label="Text">
          <textarea aria-label="Text to synthesize" value={input} onChange={(e) => setInput(e.target.value)} maxLength={4000} rows={4} placeholder="Enter text to synthesize" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background resize-y" />
        </Row>
        <Row label="Language"><input aria-label="Pronunciation language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en-US" className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background" /><p className="mt-1 text-xs text-text-muted">Language tag used for pronunciation (for example, en-US or tr).</p></Row>
        <Row label="Speed"><input aria-label="Speech speed" type="number" min="0.5" max="2" step="0.1" value={speed} onChange={(e) => setSpeed(e.target.value)} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background" /></Row>
        <Row label="Audio format"><code>mp3</code></Row>
        <Row label="API Key"><input type="password" aria-label="Gateway API key" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Gateway API key (if required)" className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background" /></Row>
        <p className="text-xs text-text-muted">Use a 9Router gateway key, not your Codex OAuth token.</p>
        <div className="flex flex-wrap justify-between gap-2 mt-2">
          <span className="text-xs font-semibold text-text-muted uppercase">Request</span>
          <div className="flex gap-3">
            <button onClick={() => copy(curl)} className="text-xs text-primary">{copied ? "Copied" : "Copy curl"}</button>
            <button onClick={handleRun} disabled={running || !input.trim()} className="px-3 py-1 rounded-lg bg-primary text-white text-xs disabled:opacity-50">{running ? "Generating..." : "Run"}</button>
          </div>
        </div>
        <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs overflow-x-auto whitespace-pre-wrap break-all">{curl}</pre>
        {error && <p role="alert" className="text-xs text-red-500 break-words">{error}</p>}
        <div className="flex justify-between gap-2 mt-2"><span className="text-xs font-semibold text-text-muted uppercase">Response {latency !== null ? `· ${latency}ms` : ""}</span></div>
        {audioUrl && <div className="flex flex-col gap-2"><audio controls src={audioUrl} className="w-full">Audio playback is not supported by this browser.</audio><a href={audioUrl} download={`speech.${format}`} className="text-xs text-primary hover:underline">Download audio</a></div>}
      </div>
    </Card>
  );
}
