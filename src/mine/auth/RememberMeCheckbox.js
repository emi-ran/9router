"use client";

import React from "react";

export default function RememberMeCheckbox({ checked, onChange, disabled }) {
  return (
    <label
      className={`group flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm select-none transition-colors focus-within:ring-2 focus-within:ring-primary/30 ${
        checked
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-surface/40 text-text-muted hover:border-primary/30 hover:bg-surface-2"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only"
      />
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          checked
            ? "border-primary bg-primary text-white"
            : "border-border bg-bg group-hover:border-primary/50"
        }`}
        aria-hidden="true"
      >
        {checked && (
          <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-current stroke-[2.5]" focusable="false">
            <path d="m3.25 8.25 2.9 2.9 6.6-6.5" />
          </svg>
        )}
      </span>
      <span className="font-medium">Remember me</span>
    </label>
  );
}
