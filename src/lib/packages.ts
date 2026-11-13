// Shared (client + server): extra apt packages for the box images.

/** Debian package names (no versions, no options). */
export const PACKAGE_RE = /^[a-z0-9][a-z0-9+.-]{0,62}$/;
export const MAX_PACKAGES = 60;

/** Split free text (spaces, commas, new lines) into package names. */
export const parsePackageList = (text: string) => [
  ...new Set(
    text
      .split(/[\s,]+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  ),
];
