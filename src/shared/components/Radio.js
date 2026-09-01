"use client";

import { forwardRef } from "react";
import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";

const Radio = forwardRef(function Radio(
  {
    checked = false,
    onChange,
    label,
    description,
    disabled = false,
    size = "md",
    className,
    id,
    name,
    value,
    title,
    "aria-label": ariaLabel,
    ...props
  },
  ref
) {
  const sizes = {
    sm: "size-3.5",
    md: "size-4",
    lg: "size-5",
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
        ref={ref}
        type="radio"
        id={id}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={handleChange}
        aria-label={ariaLabel || (typeof label === "string" ? label : title)}
        className={cn(
          "shrink-0 mt-0.5",
          sizes[size] || sizes.md
        )}
        {...props}
      />
      {(label || description) && (
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
        </div>
      )}
    </label>
  );
});

Radio.propTypes = {
  checked: PropTypes.bool,
  onChange: PropTypes.func,
  label: PropTypes.node,
  description: PropTypes.node,
  disabled: PropTypes.bool,
  size: PropTypes.oneOf(["sm", "md", "lg"]),
  className: PropTypes.string,
  id: PropTypes.string,
  name: PropTypes.string,
  value: PropTypes.any,
  title: PropTypes.string,
  "aria-label": PropTypes.string,
};

export default Radio;
