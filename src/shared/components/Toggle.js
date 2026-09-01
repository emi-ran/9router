"use client";

import { forwardRef } from "react";
import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";

const Toggle = forwardRef(function Toggle(
  {
    checked = false,
    onChange,
    label,
    description,
    disabled = false,
    size = "md",
    variant = "default",
    className,
    title,
    id,
    name,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    ...props
  },
  ref
) {
  const sizes = {
    sm: {
      track: "w-8 h-[18px]",
      thumb: "size-3.5",
      translate: "translate-x-[14px]",
      translateOff: "translate-x-[2px]",
      icon: "text-[10px]",
    },
    md: {
      track: "w-11 h-6",
      thumb: "size-5",
      translate: "translate-x-5",
      translateOff: "translate-x-[2px]",
      icon: "text-[12px]",
    },
    lg: {
      track: "w-14 h-7",
      thumb: "size-6",
      translate: "translate-x-7",
      translateOff: "translate-x-[2px]",
      icon: "text-[14px]",
    },
  };

  const currentSize = sizes[size] || sizes.md;

  const handleClick = (e) => {
    if (disabled) return;
    if (onChange) {
      onChange(!checked, e);
    }
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      handleClick(e);
    }
  };

  const isConnection = variant === "connection";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-3 select-none",
        disabled && "opacity-45 cursor-not-allowed",
        className
      )}
    >
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel || (typeof label === "string" ? label : title)}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        title={title}
        id={id}
        name={name}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative inline-flex items-center shrink-0 cursor-pointer rounded-full p-0",
          "border transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "active:not(:disabled):scale-[0.96]",
          checked
            ? "border-primary bg-primary shadow-[0_2px_8px_-1px_rgba(229,106,74,0.35)] hover:border-primary-hover hover:bg-primary-hover"
            : isConnection
            ? "border-border-subtle bg-surface-3 hover:border-text-muted/60"
            : "border-black/15 bg-black/10 hover:border-black/30 hover:bg-black/15 dark:border-white/15 dark:bg-white/10 dark:hover:border-white/30 dark:hover:bg-white/15",
          currentSize.track,
          disabled && "cursor-not-allowed pointer-events-none"
        )}
        {...props}
      >
        <span
          className={cn(
            "pointer-events-none inline-flex items-center justify-center rounded-full bg-white text-primary",
            "shadow-[0_1px_3px_0_rgba(0,0,0,0.25),0_1px_2px_-1px_rgba(0,0,0,0.15)]",
            "transform transition-transform duration-200 ease-out",
            checked ? currentSize.translate : currentSize.translateOff,
            currentSize.thumb
          )}
        >
          {isConnection && checked && (
            <span
              className={cn(
                "material-symbols-outlined font-bold leading-none select-none",
                currentSize.icon
              )}
              aria-hidden="true"
            >
              check
            </span>
          )}
        </span>
      </button>
      {(label || description) && (
        <div
          className={cn(
            "flex flex-col",
            !disabled && "cursor-pointer"
          )}
          onClick={handleClick}
        >
          {label && (
            <span className="text-sm font-medium text-text-main leading-tight">
              {label}
            </span>
          )}
          {description && (
            <span className="text-xs text-text-muted leading-normal mt-0.5">
              {description}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

Toggle.propTypes = {
  checked: PropTypes.bool,
  onChange: PropTypes.func,
  label: PropTypes.node,
  description: PropTypes.node,
  disabled: PropTypes.bool,
  size: PropTypes.oneOf(["sm", "md", "lg"]),
  variant: PropTypes.oneOf(["default", "connection"]),
  className: PropTypes.string,
  title: PropTypes.string,
  id: PropTypes.string,
  name: PropTypes.string,
  "aria-label": PropTypes.string,
  "aria-labelledby": PropTypes.string,
};

export default Toggle;
