/** Aktuelle Schema-Version, die dieses Paket beschreibt (semver-gepflegt, NFR7). */
export const SCHEMA_VERSION = '1.0';

/** Major-Version, die der Core unterstützt. Inkompatible Majors werden abgelehnt (V6). */
export const SUPPORTED_SCHEMA_MAJOR = 1;

/** Zerlegt "major.minor"; null bei ungültigem Format. */
export function parseSchemaVersion(
  version: string,
): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * V6/NFR7: Gleiche Major-Version ⇒ kompatibel (Minor-Erweiterungen des
 * Schemas sind rückwärtskompatibel zu pflegen).
 */
export function isSupportedSchemaVersion(version: string): boolean {
  const parsed = parseSchemaVersion(version);
  return parsed !== null && parsed.major === SUPPORTED_SCHEMA_MAJOR;
}
