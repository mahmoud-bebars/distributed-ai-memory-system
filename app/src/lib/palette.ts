// Deterministic accent-hue cycling for anything that needs a stable "which
// color is this project/entity" mapping without a server-assigned field.
// Hashing the slug (rather than list index) keeps a project's color fixed
// even as other projects are added, removed, or reordered.
export const ACCENT_HUES = [
  "blue",
  "violet",
  "teal",
  "amber",
  "rose",
  "green",
  "cyan",
  "fuchsia",
  "indigo",
] as const;

export type AccentHue = (typeof ACCENT_HUES)[number];

export function hueFor(key: string): AccentHue {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % ACCENT_HUES.length;
  return ACCENT_HUES[index];
}

export function accentVar(hue: AccentHue): string {
  return `var(--accent-${hue})`;
}
