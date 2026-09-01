"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";

export default function CompactSelect({ value, options, onChange, ariaLabel, className, openUp = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((visible) => !visible)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((visible) => !visible);
          }
        }}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-2.5 text-left text-xs font-medium text-text-primary shadow-[var(--shadow-soft)] transition-colors hover:border-border hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="truncate">{selected?.label}</span>
        <span className={`material-symbols-outlined text-[16px] text-text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">expand_more</span>
      </button>
      {open && (
        <div role="listbox" aria-label={ariaLabel} className={`absolute left-0 z-50 min-w-full overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-xl ring-1 ring-black/10 dark:ring-white/10 ${openUp ? "bottom-full mb-1" : "top-full mt-1"}`}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${isSelected ? "bg-primary/15 font-semibold text-primary" : "text-text-primary hover:bg-surface-2"}`}
              >
                <span>{option.label}</span>
                {isSelected && <span className="material-symbols-outlined text-[15px]" aria-hidden="true">check</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

CompactSelect.propTypes = {
  value: PropTypes.string.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({
    value: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
  })).isRequired,
  onChange: PropTypes.func.isRequired,
  ariaLabel: PropTypes.string.isRequired,
  className: PropTypes.string,
  openUp: PropTypes.bool,
};
