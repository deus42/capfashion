/**
 * The capsule style catalogue (production spec §7): a public starter set of clearly different fashion styles with
 * names that suit anyone. Each style has its idea, palette, materials, weather periods and key pieces for a men's
 * and a women's wardrobe; «Будь-який» shows both. A new account starts its capsules from here (spec §3).
 * Reviewed by the fashion-stylist role on 20.11.2026 (Sport Casual replaced Active Casual; Outdoor, Heritage and Urban
 * were set apart by fabric and palette; dated sources in the worklog); the owner has the final word before launch.
 */
import type { Period, Season, WardrobeFocus } from '../server/schema.ts';

type Text = { uk: string; en: string };
export interface CatalogueStyle {
  id: string;
  name: string;
  season: Season;
  periods: Period[];
  idea: Text;
  palette: Text;
  materials: Text;
  pieces: { men: Text[]; women: Text[] };
}

const p = (uk: string, en: string): Text => ({ uk, en });

export const STYLE_CATALOGUE: CatalogueStyle[] = [
  {
    id: 'smart-casual',
    name: 'Smart Casual',
    season: 'all',
    periods: ['spring', 'early-autumn', 'late-autumn', 'winter'],
    idea: p('Зібраний повсякденний стиль: чисті лінії й спокійні кольори, що пасують і до роботи, і до вечері.', 'Put-together everyday dressing: clean lines and calm colours that work for the office and for dinner.'),
    palette: p('темно-синій, білий, сірий, кемел', 'navy, white, grey, camel'),
    materials: p('бавовна оксфорд, меринос, вовняна фланель, замша', 'oxford cotton, merino, wool flannel, suede'),
    pieces: {
      men: [p('темно-синій неструктурований піджак', 'navy unstructured blazer'), p('біла сорочка оксфорд', 'white oxford shirt'), p('светр з мериносу', 'merino crewneck'), p('сірі вовняні штани', 'grey wool trousers'), p('темні прямі джинси', 'dark straight jeans'), p('замшеві лофери', 'suede loafers')],
      women: [p('темно-синій м’який жакет', 'navy soft-tailored blazer'), p('біла сорочка', 'crisp white shirt'), p('тонкий светр з мериносу', 'fine merino knit'), p('прямі вовняні штани', 'straight wool trousers'), p('спідниця міді в складку', 'pleated midi skirt'), p('шкіряні лофери', 'leather loafers')],
    },
  },
  {
    id: 'mediterranean-casual',
    name: 'Mediterranean Casual',
    season: 'warm',
    periods: ['spring', 'summer', 'early-autumn'],
    idea: p('Легкий стиль теплого узбережжя: льон, світлі тони, вільна посадка.', 'Easy dressing for a warm coast: linen, light tones and a relaxed fit.'),
    palette: p('білий, пісочний, небесно-блакитний, оливковий', 'white, sand, sky blue, olive'),
    materials: p('льон, бавовна, рафія, замша', 'linen, cotton, raffia, suede'),
    pieces: {
      men: [p('лляна сорочка', 'linen shirt'), p('в’язане поло', 'knitted polo'), p('лляна сорочка-куртка', 'linen overshirt'), p('лляні штани на зав’язках', 'linen drawstring trousers'), p('класичні шорти', 'tailored shorts'), p('замшеві лофери або еспадрильї', 'suede loafers or espadrilles')],
      women: [p('лляна сорочка', 'linen shirt'), p('в’язаний топ', 'knit tank'), p('широкі лляні штани', 'wide linen trousers'), p('сукня-сорочка міді', 'midi shirt dress'), p('тонкий бавовняний кардиган', 'light cotton cardigan'), p('пласкі сандалі або еспадрильї', 'flat sandals or espadrilles')],
    },
  },
  {
    id: 'outdoor-casual',
    name: 'Outdoor Casual',
    season: 'all',
    periods: ['spring', 'early-autumn', 'late-autumn', 'winter'],
    idea: p('Тихий технічний стиль для прогулянок, подорожей і міста: шари, легкі куртки-оболонки, мінімум логотипів.', 'Quiet technical dressing for walks, travel and the city: layers, light shells and minimal logos.'),
    palette: p('кам’яний, світло-сірий, оливковий, глибокий синій', 'stone, light grey, olive, deep blue'),
    materials: p('рипстоп, фліс, меринос, софтшел', 'ripstop, fleece, merino, softshell'),
    pieces: {
      men: [p('легка куртка-оболонка', 'light shell jacket'), p('флісова кофта', 'fleece jacket'), p('футболка з мериносу', 'merino tee'), p('стьобаний утеплений жилет', 'quilted insulated vest'), p('технічні штани', 'technical trousers'), p('трекінгові кросівки', 'trail sneakers')],
      women: [p('легка куртка-оболонка', 'light shell jacket'), p('флісова кофта', 'fleece jacket'), p('футболка з мериносу', 'merino tee'), p('стьобаний утеплений жилет', 'quilted insulated vest'), p('технічні штани', 'technical trousers'), p('трекінгові кросівки', 'trail sneakers')],
    },
  },
  {
    id: 'urban-casual',
    name: 'Urban Casual',
    season: 'transitional',
    periods: ['spring', 'early-autumn', 'late-autumn'],
    idea: p('Міський стиль на денімі, шкірі й замші, з чистими кросівками й без гучних логотипів.', 'City dressing built on denim, leather and suede, with clean sneakers and no loud logos.'),
    palette: p('чорний, вилинялий денім, білий, шоколадний', 'black, washed denim blue, white, chocolate brown'),
    materials: p('щільний бавовняний трикотаж, деним, шкіра, замша', 'heavy cotton jersey, denim, leather, suede'),
    pieces: {
      men: [p('шкіряна або замшева куртка', 'leather or suede jacket'), p('щільна футболка', 'heavyweight tee'), p('світшот', 'sweatshirt'), p('вільні прямі джинси', 'loose straight jeans'), p('вільні чорні штани', 'relaxed black trousers'), p('мінімалістичні шкіряні кросівки', 'minimal leather sneakers')],
      women: [p('шкіряна куртка', 'leather jacket'), p('футболка вільного крою', 'boxy tee'), p('світшот', 'sweatshirt'), p('прямі джинси вужчого крою', 'slim-straight jeans'), p('широкі чорні штани', 'baggy black trousers'), p('мінімалістичні шкіряні кросівки', 'minimal leather sneakers')],
    },
  },
  {
    id: 'workwear-casual',
    name: 'Workwear Casual',
    season: 'transitional',
    periods: ['spring', 'early-autumn', 'late-autumn'],
    idea: p('Міцні речі з робочого одягу: деним, канвас і чіткі шви, які з часом стають тільки кращими.', 'Sturdy pieces from workwear: denim, canvas and strong seams that only get better with time.'),
    palette: p('індиго, екрю, коричневий, оливковий', 'indigo, ecru, brown, olive'),
    materials: p('деним, канвас, шамбре, шкіра', 'denim, canvas, chambray, leather'),
    pieces: {
      men: [p('робоча куртка', 'chore jacket'), p('сорочка шамбре', 'chambray shirt'), p('щільна футболка або хенлі', 'heavy tee or henley'), p('джинси з сирого дениму', 'raw denim jeans'), p('штани карпентер', 'carpenter trousers'), p('шкіряні робочі черевики', 'leather work boots')],
      women: [p('робоча куртка', 'chore jacket'), p('сорочка шамбре', 'chambray shirt'), p('смугаста футболка', 'striped tee'), p('широкі джинси', 'wide jeans'), p('штани карпентер', 'carpenter trousers'), p('черевики на шнурівці', 'lace-up boots')],
    },
  },
  {
    id: 'minimal-casual',
    name: 'Minimal Casual',
    season: 'all',
    periods: ['spring', 'early-autumn', 'late-autumn', 'winter'],
    idea: p('Мінімалізм у північному дусі: монохром, чисті форми, добрі тканини й жодних зайвих деталей.', 'Minimalism in a northern spirit: monochrome, clean shapes, good fabrics and no extra details.'),
    palette: p('екрю, тауп, сірий, чорний', 'ecru, taupe, grey, black'),
    materials: p('вовна, кашемір, бавовна, шовк', 'wool, cashmere, cotton, silk'),
    pieces: {
      men: [p('вовняне пальто', 'wool overcoat'), p('светр з високим коміром', 'mock-neck knit'), p('біла футболка', 'white tee'), p('широкі класичні штани', 'wide tailored trousers'), p('чорні прямі джинси', 'black straight jeans'), p('мінімалістичні шкіряні черевики', 'minimal leather boots')],
      women: [p('довге вовняне пальто', 'long wool coat'), p('тонкий светр у рубчик', 'fine rib knit'), p('біла футболка', 'white tee'), p('широкі штани', 'wide trousers'), p('сукня-комбінація', 'slip dress'), p('шкіряні ботильйони', 'leather ankle boots')],
    },
  },
  {
    id: 'heritage-casual',
    name: 'Heritage Casual',
    season: 'cold',
    periods: ['early-autumn', 'late-autumn', 'winter'],
    idea: p('Британська класика поза офісом: твід, вельвет, в’язані речі й теплі відтінки.', 'British classics away from the office: tweed, corduroy, knitwear and warm shades.'),
    palette: p('коричневий, пляшково-зелений, бордовий, кремовий', 'brown, bottle green, burgundy, cream'),
    materials: p('твід, вельвет, вовна ягняти, вощена бавовна', 'tweed, corduroy, lambswool, waxed cotton'),
    pieces: {
      men: [p('твідовий піджак', 'tweed jacket'), p('вощена куртка', 'waxed jacket'), p('в’язаний светр', 'cable-knit sweater'), p('сорочка в клітинку таттерсол', 'tattersall shirt'), p('вельветові штани', 'corduroy trousers'), p('броги або челсі', 'brogues or chelsea boots')],
      women: [p('твідовий жакет', 'tweed blazer'), p('вощена куртка', 'waxed jacket'), p('в’язаний светр', 'cable-knit sweater'), p('сорочка в клітинку таттерсол', 'tattersall shirt'), p('спідниця міді в шотландку', 'tartan midi skirt'), p('челсі', 'chelsea boots')],
    },
  },
  {
    id: 'sport-casual',
    name: 'Sport Casual',
    season: 'all',
    periods: ['spring', 'summer', 'early-autumn', 'late-autumn'],
    idea: p('Ретро-спорт для міста: олімпійка, регбійка й поло в парі з однією скроєною річчю.', 'Retro sportswear for the city: track jackets, rugby and polo shirts, worn with one tailored piece.'),
    palette: p('темно-синій, білий, червоний, сірий меланж', 'navy, white, red, grey melange'),
    materials: p('бавовняне піке, щільна бавовна, спортивний трикотаж, нейлон', 'cotton piqué, heavy cotton, track knit, nylon'),
    pieces: {
      men: [p('олімпійка', 'track jacket'), p('регбійка', 'rugby shirt'), p('поло з піке', 'piqué polo'), p('прямі спортивні штани', 'straight track pants'), p('штани зі складками', 'pleated trousers'), p('низькі ретро-кросівки', 'retro low-profile sneakers')],
      women: [p('олімпійка', 'track jacket'), p('регбійка', 'rugby shirt'), p('поло з піке', 'piqué polo'), p('прямі спортивні штани', 'straight track pants'), p('міні-спідниця в складку', 'pleated mini skirt'), p('низькі ретро-кросівки', 'retro low-profile sneakers')],
    },
  },
];

/** Key pieces for the person's wardrobe; «Будь-який» takes from both, without repeats. */
export function stylePieces(style: CatalogueStyle, focus: WardrobeFocus | undefined): Text[] {
  if (focus === 'men') return style.pieces.men;
  if (focus === 'women') return style.pieces.women;
  const seen = new Set<string>();
  return [...style.pieces.men, ...style.pieces.women].filter((x) => !seen.has(x.en) && seen.add(x.en));
}

/** The capsule brief a style becomes: idea, palette, materials and key pieces, in the person's language. */
export function styleBrief(style: CatalogueStyle, focus: WardrobeFocus | undefined, lang: 'uk' | 'en'): string {
  const label = lang === 'en' ? { palette: 'Palette', materials: 'Materials', pieces: 'Key pieces' } : { palette: 'Палітра', materials: 'Матеріали', pieces: 'Опорні речі' };
  return [style.idea[lang], `${label.palette}: ${style.palette[lang]}.`, `${label.materials}: ${style.materials[lang]}.`, `${label.pieces}: ${stylePieces(style, focus).map((x) => x[lang]).join(', ')}.`].join(' ');
}
