// Authored line-icon set — one geometry (24 grid, 1.75 stroke, round caps and
// joins), `currentColor`, sized to 1em so a button's font-size drives the icon.
// Replaces the emoji/glyph stand-ins the UI used to lean on.
import type { ReactNode } from "react";

function Svg({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type P = { className?: string };

export const BellIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </Svg>
);

export const BellOffIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    <path d="M18.63 13A17.9 17.9 0 0 1 18 8" />
    <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
    <path d="M18 8a6 6 0 0 0-9.33-5" />
    <line x1="3" y1="3" x2="21" y2="21" />
  </Svg>
);

export const TrashIcon = ({ className }: P) => (
  <Svg className={className}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </Svg>
);

export const PlusIcon = ({ className }: P) => (
  <Svg className={className}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);

export const CloseIcon = ({ className }: P) => (
  <Svg className={className}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Svg>
);

export const CheckIcon = ({ className }: P) => (
  <Svg className={className}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>
);

export const PencilIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Svg>
);

export const ChevronRightIcon = ({ className }: P) => (
  <Svg className={className}>
    <polyline points="9 18 15 12 9 6" />
  </Svg>
);

export const ChevronLeftIcon = ({ className }: P) => (
  <Svg className={className}>
    <polyline points="15 18 9 12 15 6" />
  </Svg>
);

export const FolderIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);

export const PaperclipIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Svg>
);

export const StopIcon = ({ className }: P) => (
  <Svg className={className}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const MicIcon = ({ className }: P) => (
  <Svg className={className}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="22" />
  </Svg>
);

export const CircleIcon = ({ className }: P) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="8" />
  </Svg>
);

export const RadioDotIcon = ({ className }: P) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" />
  </Svg>
);

export const SquareIcon = ({ className }: P) => (
  <Svg className={className}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
  </Svg>
);

export const CheckSquareIcon = ({ className }: P) => (
  <Svg className={className}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <polyline points="8.5 12 11 14.5 15.5 9.5" />
  </Svg>
);
