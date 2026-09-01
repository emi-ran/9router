"use client";

import React from "react";

export default function RememberMeCheckbox({ checked, onChange, disabled }) {
  return (
    <label className="flex items-center gap-2 text-sm text-text-muted select-none cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="w-4 h-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0 cursor-pointer disabled:opacity-50"
      />
      <span>Remember me</span>
    </label>
  );
}
