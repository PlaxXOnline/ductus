import { describe, expect, it } from 'vitest';
import { outputStrings } from '../../src/output/strings.js';

describe('outputStrings', () => {
  it('returns English strings for locale "en"', () => {
    const strings = outputStrings('en');
    expect(strings.mainPathHeading).toBe('Main path');
    expect(strings.flowchartHeading).toBe('Flowchart');
    expect(strings.faithfulnessTitle).toBe('Faithfulness warning');
    expect(strings.miscSegmentTitle).toBe('Other areas');
  });

  it('returns German strings for "de" locales (case-insensitive, region variants)', () => {
    for (const locale of ['de', 'de-DE', 'de-AT', 'DE']) {
      const strings = outputStrings(locale);
      expect(strings.mainPathHeading).toBe('Hauptpfad');
      expect(strings.flowchartHeading).toBe('Ablaufdiagramm');
      expect(strings.faithfulnessTitle).toBe('Faithfulness-Warnung');
      expect(strings.miscSegmentTitle).toBe('Weitere Bereiche');
    }
  });

  it('falls back to English for any non-German locale', () => {
    expect(outputStrings('fr').mainPathHeading).toBe('Main path');
    expect(outputStrings('es-MX').flowchartHeading).toBe('Flowchart');
    expect(outputStrings('').miscSegmentTitle).toBe('Other areas');
  });
});
