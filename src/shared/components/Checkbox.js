"use client";

import { forwardRef, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";

const Checkbox = forwardRef(function Checkbox(
  {
    checked = false,
    indeterminate = false,
    onChange,
    label,
    description,
    disabled = false,
    size = "md",
    error,
    className,
    id,
    name,
    title,
    "aria-label": ariaLabel,
    ...props
  },
  ref
) {
  const innerRef = useRef(null);
  const inputRef = ref || innerRef;

  useEffect(() => {
    if (inputRef && "current" in inputRef && inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate, inputRef]);

  const sizes = {
    sm: "size-3.5 rounded text-xs",
    md: "size-4 rounded text-sm",
    lg: "size-5 rounded-md text-base",
  };

  const handleChange = (e) => {
    if (disabled) return;
    if (onChange) {
      onChange(e);
    }
  };

  return (
    <label
      className={cn(
        "inline-flex items-start gap-2.5 select-none",
        disabled ? "opacity-45 cursor-not-allowed" : "cursor-pointer",
        className
      )}
      title={title}
    >
      <input
        ref={inputRef}
        type="checkbox"
        id={id}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={handleChange}
        aria-label={ariaLabel || (typeof label === "string" ? label : title)}
        aria-invalid={!!error}
        className={cn(
          "shrink-0 mt-0.5",
          sizes[size] || sizes.md,
          error && "!border-danger !ring-danger/30"
        )}
        {...props}
      />
      {(label || description || error) && (
        <div className="flex flex-col leading-tight min-w-0">
          {label && (
            <span className="text-sm font-medium text-text-main">
              {label}
            </span>
          )}
          {description && (
            <span className="text-xs text-text-muted mt-0.5">
              {description}
            </span>
          )}
          {error && (
            <span className="text-xs text-danger mt-0.5">
              {error}
            </span>
          )}
        </div>
      )}
    </label>
  );
});

Checkbox.propTypes = {
  checked: PropTypes.bool,
  indeterminate: PropTypes.bool,
  onChange: PropTypes.func,
  label: PropTypes.node,
  description: PropTypes.node,
  disabled: PropTypes.bool,
  size: PropTypes.oneOf(["sm", "md", "lg"]),
  error: PropTypes.string,
  className: PropTypes.string,
  id: PropTypes.string,
  name: PropTypes.string,
  title: PropTypes.string,
  "aria-label": PropTypes.string,
};

export default Checkbox;
