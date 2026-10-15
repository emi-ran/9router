"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function Tooltip({ text, children, position = "top", color }) {
  const anchorRef = useRef(null);
  const tooltipId = useId();
  const [style, setStyle] = useState(null);

  // Render via portal + fixed positioning so overflow/scroll ancestors can't clip the bubble
  const handleMouseEnter = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const midX = rect.left + rect.width / 2;
    const midY = rect.top + rect.height / 2;
    let pos;
    if (position === "bottom") pos = { top: rect.bottom + 6, left: midX, transform: "translateX(-50%)" };
    else if (position === "left") pos = { right: window.innerWidth - rect.left + 6, top: midY, transform: "translateY(-50%)" };
    else if (position === "right") pos = { left: rect.right + 6, top: midY, transform: "translateY(-50%)" };
    else pos = { bottom: window.innerHeight - rect.top + 6, left: midX, transform: "translateX(-50%)" };
    setStyle({ position: "fixed", ...pos });
  };

  // A fixed portal must not remain at stale coordinates when an ancestor scrolls.
  const visible = style !== null;
  useEffect(() => {
    if (!visible) return;
    const hide = () => setStyle(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [visible]);

  return (
    <div
      ref={anchorRef}
      className="relative inline-flex"
      aria-describedby={style ? tooltipId : undefined}
      onFocus={handleMouseEnter}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setStyle(null);
      }}
      onKeyDown={(event) => { if (event.key === "Escape") setStyle(null); }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setStyle(null)}
    >
      {children}
      {style && createPortal(
        <div
          id={tooltipId}
          role="tooltip"
          className={`pointer-events-none z-50 w-max max-w-56 rounded px-2 py-1 text-[11px] leading-snug text-white whitespace-normal ${color ? "" : "bg-gray-900"}`}
          style={{ ...style, ...(color ? { backgroundColor: color } : {}) }}
        >
          {text}
        </div>,
        document.body
      )}
    </div>
  );
}