// Who the AI work is for (production spec §7): the reply language, what clothes to dress the person in, and where
// they live — read from their profile instead of being written into the prompts.
import type { DB } from './schema.ts';

/** The language every model text is written in: the profile's, Ukrainian when none was chosen. */
export const replyLanguage = (db: DB) => (db.profile.language === 'en' ? 'English' : 'Ukrainian');

const FOCUS_LINE = {
  men: 'Dress the person in menswear.',
  women: 'Dress the person in womenswear.',
  any: 'Dress the person in clothes of any gender, following their wardrobe and preferences.',
} as const;

/** «Який одяг підбирати?» for prompts. */
export const focusLine = (db: DB) => FOCUS_LINE[db.profile.wardrobeFocus ?? 'any'];

/** Shop sections to search in: the person's choice, or both. */
export const shopSection = (db: DB) => (db.profile.wardrobeFocus === 'men' ? "men's" : db.profile.wardrobeFocus === 'women' ? "women's" : "men's or women's");

/** The country part of the shopping place («Tower Center, Rijeka, Croatia» → «Croatia»); empty when unknown. */
export function placeCountry(db: DB): string {
  const parts = (db.profile.location ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts.at(-1)! : '';
}
