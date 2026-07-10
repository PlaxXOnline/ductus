/**
 * Slug-Bildung für Dateinamen und Sidebar-Links der Ausgabe-Module.
 * Deterministisch: gleiche Eingabe ⇒ gleiche Ausgabe (NFR2).
 */

/**
 * Wandelt eine Node-/Segment-id in einen URL-/Dateinamen-tauglichen Slug um.
 * Führende Unterstriche fallen weg, damit z. B. "_misc" zu "misc" wird
 * (Starlight interpretiert führende Unterstriche als versteckte Seiten).
 */
export function toSlug(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/^_+/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'seite' : slug;
}
