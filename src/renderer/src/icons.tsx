import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 18, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  )
}

export const Icon = {
  Compose: (p: P) => (
    <Svg {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  ),
  Queue: (p: P) => (
    <Svg {...p}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1" />
      <circle cx="3.5" cy="12" r="1" />
      <circle cx="3.5" cy="18" r="1" />
    </Svg>
  ),
  Calendar: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="3" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </Svg>
  ),
  History: (p: P) => (
    <Svg {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </Svg>
  ),
  Accounts: (p: P) => (
    <Svg {...p}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0" />
      <path d="M17 11a3.5 3.5 0 1 0-1.5-6.7M22 21a6 6 0 0 0-4-5.7" />
    </Svg>
  ),
  Settings: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </Svg>
  ),
  Guide: (p: P) => (
    <Svg {...p}>
      <path d="M4 19.5V5a2 2 0 0 1 2-2h14v15H6a2 2 0 0 0-2 2Zm0 0A2 2 0 0 0 6 22h14" />
      <path d="M9 7h7M9 11h5" />
    </Svg>
  ),
  Upload: (p: P) => (
    <Svg {...p}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M20 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3" />
    </Svg>
  ),
  Image: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m4 18 5-5 4 4 2.5-2.5L20 19" />
    </Svg>
  ),
  GridMany: (p: P) => (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="4.5" height="4.5" rx="1" />
      <rect x="9.75" y="3.5" width="4.5" height="4.5" rx="1" />
      <rect x="16" y="3.5" width="4.5" height="4.5" rx="1" />
      <rect x="3.5" y="9.75" width="4.5" height="4.5" rx="1" />
      <rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1" />
      <rect x="16" y="9.75" width="4.5" height="4.5" rx="1" />
      <rect x="3.5" y="16" width="4.5" height="4.5" rx="1" />
      <rect x="9.75" y="16" width="4.5" height="4.5" rx="1" />
      <rect x="16" y="16" width="4.5" height="4.5" rx="1" />
    </Svg>
  ),
  GridFew: (p: P) => (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.5" />
    </Svg>
  ),
  Plus: (p: P) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  X: (p: P) => (
    <Svg {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  ),
  Check: (p: P) => (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  ),
  Alert: (p: P) => (
    <Svg {...p}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  ),
  Error: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </Svg>
  ),
  Clock: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  Send: (p: P) => (
    <Svg {...p}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </Svg>
  ),
  Trash: (p: P) => (
    <Svg {...p}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </Svg>
  ),
  Edit: (p: P) => (
    <Svg {...p}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </Svg>
  ),
  More: (p: P) => (
    <Svg {...p}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </Svg>
  ),
  External: (p: P) => (
    <Svg {...p}>
      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Svg>
  ),
  ChevronLeft: (p: P) => (
    <Svg {...p}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  ),
  ChevronRight: (p: P) => (
    <Svg {...p}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  ),
  ChevronDown: (p: P) => (
    <Svg {...p}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
  Retry: (p: P) => (
    <Svg {...p}>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </Svg>
  ),
  Pause: (p: P) => (
    <Svg {...p}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </Svg>
  ),
  Play: (p: P) => (
    <Svg {...p}>
      <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.3-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  Volume: (p: P) => (
    <Svg {...p}>
      <path d="M11 5 6 9H2v6h4l5 4Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </Svg>
  ),
  Mute: (p: P) => (
    <Svg {...p}>
      <path d="M11 5 6 9H2v6h4l5 4Z" />
      <path d="m22 9-6 6M16 9l6 6" />
    </Svg>
  ),
  Heart: (p: P) => (
    <Svg {...p}>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8Z" />
    </Svg>
  ),
  Comment: (p: P) => (
    <Svg {...p}>
      <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5Z" />
    </Svg>
  ),
  Share: (p: P) => (
    <Svg {...p}>
      <path d="m22 2-7 20-4-9-9-4Z" />
    </Svg>
  ),
  ThumbUp: (p: P) => (
    <Svg {...p}>
      <path d="M7 10v11M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18.4 21H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3l4-8a3 3 0 0 1 4 3.9Z" />
    </Svg>
  ),
  Film: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" />
    </Svg>
  ),
  Sparkle: (p: P) => (
    <Svg {...p}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z" />
    </Svg>
  ),
  Folder: (p: P) => (
    <Svg {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Svg>
  ),
  Link: (p: P) => (
    <Svg {...p}>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </Svg>
  ),
  Lock: (p: P) => (
    <Svg {...p}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  ),
  Wand: (p: P) => (
    <Svg {...p}>
      <path d="m15 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1ZM4 20 15 9" />
    </Svg>
  ),
  Library: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <path d="M15.5 14.5v5l4-2.5Z" />
    </Svg>
  ),
  Eye: (p: P) => (
    <Svg {...p}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  Chart: (p: P) => (
    <Svg {...p}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Svg>
  ),
  Home: (p: P) => (
    <Svg {...p}>
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z" />
    </Svg>
  ),
  Search: (p: P) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  ),
  Users: (p: P) => (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </Svg>
  ),
  TrendUp: (p: P) => (
    <Svg {...p}>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </Svg>
  ),
  Grip: (p: P) => (
    <Svg {...p}>
      <circle cx="9" cy="6" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="18" r="1" />
    </Svg>
  )
}

/** Simplified platform marks used as small indicators. */
export function InstagramMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Instagram">
      <defs>
        <radialGradient id="igg" cx="30%" cy="107%" r="150%">
          <stop offset="0" stopColor="#fdf497" />
          <stop offset="0.05" stopColor="#fdf497" />
          <stop offset="0.45" stopColor="#fd5949" />
          <stop offset="0.6" stopColor="#d6249f" />
          <stop offset="0.9" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#igg)" />
      <rect x="6.5" y="6.5" width="11" height="11" rx="5.5" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="#fff" />
    </svg>
  )
}

export function YouTubeMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="YouTube">
      <rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="#FF0033" />
      <path d="M10 8.8v6.4l5.5-3.2Z" fill="#fff" />
    </svg>
  )
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Cadence">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff7a59" />
          <stop offset="0.5" stopColor="#ff3d77" />
          <stop offset="1" stopColor="#7c5cff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#lg)" />
      <path d="M9 19.5v-7M13 22v-12M17 20v-8M21 17.5v-3" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="24.5" cy="16" r="1.4" fill="#fff" />
    </svg>
  )
}
