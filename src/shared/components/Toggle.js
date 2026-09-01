"use client";

import { cn } from "@/shared/utils/cn";

export default function Toggle({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  size = "md",
  variant = "default",
  className,
}) {
  const sizes = {
    sm: { track: "w-8 h-4", thumb: "size-3", translate: "translate-x-4" },
    md: { track: "w-11 h-6", thumb: "size-5", translate: "translate-x-5" },
    lg: { track: "w-14 h-7", thumb: "size-6", translate: "translate-x-7" },
  };

  const handleClick = () => {
    if (!disabled && onChange) onChange(!checked);
  };

  const isConnection = variant === "connection";

  return (
    <div
      className={cn(
        "flex items-center gap-3",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          "relative inline-flex shrink-0 cursor-pointer rounded-full",
          "border transition-[background-color,border-color,box-shadow] duration-200 ease-out",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isConnection
            ? (checked
              ? "border-primary bg-primary shadow-[var(--shadow-focus)]"
              : "border-border-subtle bg-surface-3 hover:border-text-muted/60")
            : (checked ? "border-brand-500 bg-brand-500" : "border-transparent bg-surface-3"),
          sizes[size].track,
          disabled && "cursor-not-allowed"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-flex items-center justify-center rounded-full bg-white shadow-sm",
            "transform transition-transform duration-200 ease-out",
            checked ? sizes[size].translate : "translate-x-0.5",
            sizes[size].thumb,
            "mt-0.5"
          )}
          >
            {isConnection && checked && (
              <span className="material-symbols-outlined text-[10px] font-bold leading-none text-primary" aria-hidden="true">
                check
              </span>
            )}
          </span>
      </button>
      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <span className="text-sm font-medium text-text-main">{label}</span>
          )}
          {description && (
            <span className="text-xs text-text-muted">{description}</span>
          )}
        </div>
      )}
    </div>
  );
}
