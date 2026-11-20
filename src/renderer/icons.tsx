// Line icons in the BIM Crew style: Lucide shapes, 24-unit grid, round caps, 1.9 stroke, colour from the text (currentColor).
// One small component instead of a font or a package: the app has no network at run time and the set is short.
// Add a shape here, then use <Icon name="…" />. Decorative by default (aria-hidden); pass `label` when it stands alone.
import type { ReactElement } from "react";

const SHAPES = {
	dashboard: (
		<>
			<rect width="7" height="9" x="3" y="3" rx="1" />
			<rect width="7" height="5" x="14" y="3" rx="1" />
			<rect width="7" height="9" x="14" y="12" rx="1" />
			<rect width="7" height="5" x="3" y="16" rx="1" />
		</>
	),
	calendar: (
		<>
			<path d="M8 2v4M16 2v4" />
			<rect width="18" height="18" x="3" y="4" rx="2" />
			<path d="M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
		</>
	),
	door: (
		<>
			<path d="M13 4h3a2 2 0 0 1 2 2v14M2 20h3M13 20h9M10 12v.01" />
			<path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z" />
		</>
	),
	checks: <path d="M13 5h8M13 12h8M13 19h8M3 17l2 2 4-4M3 7l2 2 4-4" />,
	database: (
		<>
			<ellipse cx="12" cy="5" rx="9" ry="3" />
			<path d="M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0" />
		</>
	),
	folder: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
	book: <path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />,
	history: <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2" />,
	box: (
		<>
			<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
			<path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
		</>
	),
	branch: (
		<>
			<path d="M6 3v12" />
			<circle cx="18" cy="6" r="3" />
			<circle cx="6" cy="18" r="3" />
			<path d="M18 9a9 9 0 0 1-9 9" />
		</>
	),
	layers: (
		<>
			<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
			<path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65M22 12.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
		</>
	),
	winFloat: (
		<>
			<path d="M15 3h6v6M10 14 21 3" />
			<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
		</>
	),
	winPop: (
		<>
			<rect width="14" height="14" x="8" y="8" rx="2" />
			<path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
		</>
	),
	winMin: <path d="M5 12h14" />,
	winMax: <rect width="16" height="16" x="4" y="4" rx="2" />,
	winRestore: (
		<>
			<rect width="12" height="12" x="3" y="9" rx="2" />
			<path d="M9 9V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4" />
		</>
	),
	dockLeft: (
		<>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M9 3v18" />
			<path d="M3 5h6v14H3z" fill="currentColor" stroke="none" opacity="0.45" />
		</>
	),
	/** the slim column beside the chat: the chat's strip on the left, the column filled next to it */
	dockEdge: (
		<>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M8 3v18M12 3v18" />
			<path d="M8 5h4v14H8z" fill="currentColor" stroke="none" opacity="0.45" />
		</>
	),
	dockRight: (
		<>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M15 3v18" />
			<path d="M15 5h6v14h-6z" fill="currentColor" stroke="none" opacity="0.45" />
		</>
	),
	dockTop: (
		<>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M3 9h18" />
			<path d="M5 3h14v6H5z" fill="currentColor" stroke="none" opacity="0.45" />
		</>
	),
	dockBottom: (
		<>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M3 15h18" />
			<path d="M5 15h14v6H5z" fill="currentColor" stroke="none" opacity="0.45" />
		</>
	),
	messages: (
		<>
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
			<path d="M13 8H7M17 12H7" />
		</>
	),
	zap: <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />,
	bot: (
		<>
			<path d="M12 8V4H8" />
			<rect width="16" height="12" x="4" y="8" rx="2" />
			<path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
		</>
	),
	sliders: <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />,
	panelClose: (
		<>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M9 3v18M16 15l-3-3 3-3" />
		</>
	),
	panelOpen: (
		<>
			<rect width="18" height="18" x="3" y="3" rx="2" />
			<path d="M9 3v18M14 9l3 3-3 3" />
		</>
	),
	send: <path d="m5 12 7-7 7 7M12 19V5" />,
	paperclip: <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
	plus: <path d="M5 12h14M12 5v14" />,
	x: <path d="M18 6 6 18M6 6l12 12" />,
	chevronDown: <path d="m6 9 6 6 6-6" />,
	chevronRight: <path d="m9 18 6-6-6-6" />,
	arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
	square: <rect width="14" height="14" x="5" y="5" rx="2" />,
	play: <path d="M6 3l14 9-14 9z" />,
	alert: (
		<>
			<circle cx="12" cy="12" r="10" />
			<path d="M12 8v4M12 16h.01" />
		</>
	),
	// task states
	circle: <circle cx="12" cy="12" r="9" />,
	circleCheck: (
		<>
			<circle cx="12" cy="12" r="9" />
			<path d="m8.5 12.5 2.5 2.5 4.5-5" />
		</>
	),
	circleProgress: (
		<>
			<circle cx="12" cy="12" r="9" opacity="0.28" />
			<path d="M12 3a9 9 0 0 1 9 9" />
		</>
	),
	note: (
		<>
			<path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<path d="M14 3v5h6M8 13h8M8 17h5" />
		</>
	),
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof SHAPES;

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
	return (
		<svg
			className="ic"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.9}
			strokeLinecap="round"
			strokeLinejoin="round"
			role={label ? "img" : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
		>
			{SHAPES[name]}
		</svg>
	);
}

/** The rail icon of each page id (Rail.tsx); a page without one falls back to its glyph from shared/pages. */
export const PAGE_ICON: Record<string, IconName> = {
	parskats: "dashboard",
	grafiks: "calendar",
	telpas: "door",
	prasibas: "checks",
	avoti: "database",
	faili: "folder",
	normativi: "book",
	atmina: "history",
	nodevumi: "box",
	versijas: "branch",
	koordinacija: "layers",
};
