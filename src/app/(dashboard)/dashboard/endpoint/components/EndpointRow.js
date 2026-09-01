"use client";

import { Input } from "@/shared/components";

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      <span className={`text-xs font-mono px-1.5 py-1 rounded shrink-0 min-w-[70px] sm:min-w-[80px] text-center ${
          (badge === "CF" || badge === "TS") ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
        }`}>{label}</span>
      <Input value={url} readOnly className="flex-1 min-w-0 font-mono text-sm" />
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onCopy(url, copyId)}
          className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0 flex items-center justify-center"
          title="Copy URL"
          aria-label="Copy URL"
        >
          <span className="material-symbols-outlined text-[18px]">{copied === copyId ? "check" : "content_copy"}</span>
        </button>
        {actions}
      </div>
    </div>
  );
}
