"use client";

import { useEffect, useState } from "react";
import { Card, Toggle } from "@/shared/components";
import useSettingsStore from "@/store/settingsStore";

// Same `voiceEnabled` setting as the Endpoint page. The real value is kept unless the save succeeds.
export function VoiceCallsCard() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    useSettingsStore.getState().fetchSettings().then((settings) => {
      if (!active) return;
      if (settings) setEnabled(settings.voiceEnabled === true);
      else setError("Could not load the current voice call setting.");
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  const handleChange = async () => {
    const next = !enabled;
    setSaving(true);
    setError("");
    const updated = await useSettingsStore.getState().patchSettings({ voiceEnabled: next });
    setSaving(false);
    if (updated) setEnabled(next);
    else setError("Could not save the voice call setting. It is unchanged.");
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">Voice calls (/v1/live)</p>
          <p className="text-sm text-text-muted">
            Unofficial. Spends Codex account quota. Always requires an API key, even when Require API key is off.
          </p>
        </div>
        <Toggle checked={enabled} disabled={!loaded || saving} onChange={handleChange} aria-label="Voice calls (/v1/live)" />
      </div>
      {error && <p role="alert" className="text-xs text-red-500 mt-2 break-words">{error}</p>}
    </Card>
  );
}
