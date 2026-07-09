import { describe, expect, it } from 'vitest';
import { toSlug } from '../../src/output/slug.js';

describe('toSlug', () => {
  it('senkt Groß- in Kleinbuchstaben und ersetzt Sonderzeichen durch "-"', () => {
    expect(toSlug('Login Screen!')).toBe('login-screen');
    expect(toSlug('Anmeldung & Registrierung')).toBe('anmeldung-registrierung');
  });

  it('entfernt führende Unterstriche ("_misc" ⇒ "misc")', () => {
    expect(toSlug('_misc')).toBe('misc');
    expect(toSlug('__private-flow')).toBe('private-flow');
  });

  it('fasst Mehrfach-"-" zusammen und trimmt Ränder', () => {
    expect(toSlug('a---b')).toBe('a-b');
    expect(toSlug('-auth-')).toBe('auth');
    expect(toSlug('ä ö ü')).toBe('seite'); // Nicht-ASCII fällt komplett weg
  });

  it('liefert "seite" bei leerem Ergebnis', () => {
    expect(toSlug('')).toBe('seite');
    expect(toSlug('___')).toBe('seite');
    expect(toSlug('!!!')).toBe('seite');
  });

  it('lässt bereits gültige Slugs unverändert', () => {
    expect(toSlug('auth')).toBe('auth');
    expect(toSlug('onboarding-2')).toBe('onboarding-2');
  });

  it('ist deterministisch', () => {
    expect(toSlug('Login Screen!')).toBe(toSlug('Login Screen!'));
  });
});
