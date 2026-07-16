import { describe, expect, it } from 'vitest';
import { toSlug } from '../../src/output/slug.js';

describe('toSlug', () => {
  it('lowercases and replaces special characters with "-"', () => {
    expect(toSlug('Login Screen!')).toBe('login-screen');
    expect(toSlug('Anmeldung & Registrierung')).toBe('anmeldung-registrierung');
  });

  it('removes leading underscores ("_misc" ⇒ "misc")', () => {
    expect(toSlug('_misc')).toBe('misc');
    expect(toSlug('__private-flow')).toBe('private-flow');
  });

  it('collapses repeated "-" and trims the edges', () => {
    expect(toSlug('a---b')).toBe('a-b');
    expect(toSlug('-auth-')).toBe('auth');
    expect(toSlug('ä ö ü')).toBe('page'); // non-ASCII is dropped entirely
  });

  it('returns "page" for an empty result', () => {
    expect(toSlug('')).toBe('page');
    expect(toSlug('___')).toBe('page');
    expect(toSlug('!!!')).toBe('page');
  });

  it('leaves already-valid slugs unchanged', () => {
    expect(toSlug('auth')).toBe('auth');
    expect(toSlug('onboarding-2')).toBe('onboarding-2');
  });

  it('is deterministic', () => {
    expect(toSlug('Login Screen!')).toBe(toSlug('Login Screen!'));
  });
});
