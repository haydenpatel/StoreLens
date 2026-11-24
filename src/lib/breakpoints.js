// The width at which the filter sidebar docks beside the grid instead of
// sliding over it. Tailwind's `xl:` variant must switch at the same width, so
// src/index.css sets `--breakpoint-xl` to this value (a test keeps them equal).
// In rem, as Tailwind's are, so a larger default font size moves both together.
export const DESKTOP_MIN_WIDTH = "80rem";
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH})`;
