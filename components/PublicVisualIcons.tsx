type ServiceIconKind = "sourcing" | "aog" | "repair";

const sharedSvgProps = {
  "aria-hidden": true,
  focusable: false,
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.8,
  viewBox: "0 0 32 32",
};

export function ServiceIcon({ kind }: { kind: ServiceIconKind }) {
  if (kind === "sourcing") {
    return (
      <svg {...sharedSvgProps}>
        <circle cx="13.5" cy="13.5" r="7.5" />
        <path d="m19 19 7 7" />
        <path d="M10 10.5h7M10 13.5h4.5M10 16.5h5.5" />
        <path d="M23 8.5v-3M21.5 7h3" />
      </svg>
    );
  }

  if (kind === "aog") {
    return (
      <svg {...sharedSvgProps}>
        <path d="M5.5 17v-3a10.5 10.5 0 0 1 21 0v3" />
        <path d="M8.5 15H6a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2.5zM23.5 15H26a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2.5z" />
        <path d="M23.5 23c0 2.5-2.1 4-5.2 4H16" />
        <circle cx="16" cy="12" r="3.5" />
        <path d="M16 10v2.2l1.6 1" />
      </svg>
    );
  }

  return (
    <svg {...sharedSvgProps}>
      <path d="M12.7 18.7 6.2 25.2a2.8 2.8 0 1 0 4 4l6.5-6.5" />
      <path d="M12 10.5a6.5 6.5 0 0 0 8.3 8.3l7-7-4.8-1.3-1.3-4.8-7 7A6.5 6.5 0 0 1 12 10.5Z" />
      <path d="M5.5 13.5A11.5 11.5 0 0 1 8 7.8M4 9.5l4.2-1.8.7 4.5" />
      <path d="M26.5 18.5A11.5 11.5 0 0 1 24 24.2M28 22.5l-4.2 1.8-.7-4.5" />
    </svg>
  );
}

export function AircraftSilhouetteIcon() {
  return (
    <svg aria-hidden="true" className="platform-aircraft-icon" focusable="false" viewBox="0 0 48 24">
      <path
        d="M45 11.2 30.5 8.8 22.1 1.7h-3.6l4.4 7.1-12.2 1.8-5.1-3.2H2.8l2.8 4.2v.8l-2.8 4.2h2.8l5.1-3.2 12.2 1.8-4.4 7.1h3.6l8.4-7.1L45 12.8c1.3-.2 1.3-1.4 0-1.6Z"
        fill="currentColor"
      />
    </svg>
  );
}
