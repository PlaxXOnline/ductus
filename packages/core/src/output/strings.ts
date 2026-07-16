/**
 * Locale-dependent strings that end up in generated output (MDX headings,
 * Mermaid sections, segment titles). English is the default; German is used
 * when the configured app locale starts with "de" — mirroring the journey
 * website template (templates/journey/src/lib/strings.ts).
 */

export interface OutputStrings {
  /** Heading of the main-path section (MDX `## …` and Mermaid journey section). */
  mainPathHeading: string;
  /** Heading of the flowchart section in MDX pages. */
  flowchartHeading: string;
  /** Title of the faithfulness aside (`:::caution[…]`). */
  faithfulnessTitle: string;
  /** Intro sentence of the faithfulness aside, before the violation list. */
  faithfulnessIntro: string;
  /** Title of the catch-all "_misc" segment (flows into prompts and pages). */
  miscSegmentTitle: string;
}

const de: OutputStrings = {
  mainPathHeading: 'Hauptpfad',
  flowchartHeading: 'Ablaufdiagramm',
  faithfulnessTitle: 'Faithfulness-Warnung',
  faithfulnessIntro:
    'Der Faithfulness-Judge hat Aussagen gefunden, die nicht durch den Journey-Graphen gedeckt sind:',
  miscSegmentTitle: 'Weitere Bereiche',
};

const en: OutputStrings = {
  mainPathHeading: 'Main path',
  flowchartHeading: 'Flowchart',
  faithfulnessTitle: 'Faithfulness warning',
  faithfulnessIntro:
    'The faithfulness judge found claims that are not covered by the journey graph:',
  miscSegmentTitle: 'Other areas',
};

/** Strings for the given locale: German for "de*", English for everything else. */
export function outputStrings(locale: string): OutputStrings {
  return locale.toLowerCase().startsWith('de') ? de : en;
}
