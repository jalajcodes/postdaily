import { useId } from "react";

/** The PostDaily mark: a "P" whose bowl is a speech bubble, with an AI sparkle. Same as /logo.svg. */
export function Logo({ className = "size-7" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="PostDaily">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b8cff" />
          <stop offset="0.5" stopColor="#0a66c2" />
          <stop offset="1" stopColor="#4f3fe0" />
        </linearGradient>
        <radialGradient id={`${id}glow`} cx="0.22" cy="0.15" r="0.75">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}spark`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe17a" />
          <stop offset="1" stopColor="#ffb020" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${id}bg)`} />
      <rect width="512" height="512" rx="116" fill={`url(#${id}glow)`} />
      <path
        transform="translate(14 8)"
        d="M177 372 V149 H270 A76 76 0 0 1 270 301 H236 C200 301 177 322 177 360"
        fill="none"
        stroke="#fff"
        strokeWidth="74"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M394 70 C398 98 407 107 435 111 C407 115 398 124 394 152 C390 124 381 115 353 111 C381 107 390 98 394 70 Z"
        fill={`url(#${id}spark)`}
      />
    </svg>
  );
}
