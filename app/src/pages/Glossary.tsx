import { useEffect } from 'react';

// Five-part legend from the specification (§3): what it is, how to recognise
// it, why it is proposed, what fit to check, what to reject in a store.
interface Term {
  id: string;
  name: string;
  what: string;
  recognise: string;
  why: string;
  fit: string;
  reject: string;
}

export const TERMS: Term[] = [
  { id: 'chinos', name: 'Chinos (чіноси)', what: 'Штани з щільного бавовняного твілу, легші й мʼякші за джинси.', recognise: 'Косі бічні кишені, гладка тканина без потертостей, часто без заклепок.', why: 'Основа всіх трьох капсул: розумніші за джинси, комфортніші за класичні штани.', fit: 'Вільно в стегнах при присіданні, пояс без зазору ззаду, мінімальний залом над взуттям.', reject: 'Блиск синтетики, перекручені шви, тканина просвічує, кишені відстовбурчуються.' },
  { id: 'overshirt', name: 'Overshirt', what: 'Щільна сорочка-куртка, яку носять поверх футболки чи светра.', recognise: 'Щільніша за сорочку тканина, дві накладні кишені, прямий низ, часто кнопки.', why: 'Легкий верхній шар Urban Casual замість піджака чи худі.', fit: 'Relaxed без зайвого обʼєму: вільно поверх светра, рукав до зап’ястя, довжина до середини сідниць.', reject: 'Тонка тканина як у сорочки, крива планка, плечі звисають або тиснуть.' },
  { id: 'oxford', name: 'Oxford (Oxford cloth button-down)', what: 'Casual-сорочка з тканини оксфорд — фактурного плетіння «рогожка».', recognise: 'Помітна фактура в клітинку при наближенні, часто комір на ґудзиках.', why: 'Головний верх Mediterranean; працює з закоченими рукавами й під светр.', fit: 'Шов плеча на плечі, ґудзики не тягнуть на грудях, рукав до кісточки.', reject: 'Глянцева «офісна» тканина, вузький приталений крій, що тягне на ґудзиках.' },
  { id: 'knit-polo', name: 'Трикотажне поло (knit polo)', what: 'Поло з вʼязаного трикотажу замість звичайного піке.', recognise: 'Видно петлі вʼязки, мʼякий комір, часто без ґудзиків чи з 2–3 ґудзиками.', why: 'Робить Refined Casual дорожчим на вигляд без формальності.', fit: 'Мʼяко облягає без натягу на животі; рукав до середини біцепса.', reject: 'Тонкий синтетичний трикотаж, що скочується; комір без форми.' },
  { id: 'chore', name: 'Chore jacket', what: 'Робоча куртка-піджак із цупкої бавовни.', recognise: 'Три накладні кишені, пряма форма, без підкладки.', why: 'Варіант бежевого шару для Layered Casual і Soft Autumn.', fit: 'Вільно поверх светра, не обмежує руки.', reject: 'Жорстка тканина, що ламається на згинах; рукава закороткі.' },
  { id: 'suede', name: 'Замша (suede)', what: 'Шкіра з ворсистою поверхнею.', recognise: 'Матова оксамитова поверхня, змінює відтінок, якщо провести пальцем.', why: 'Коричнева замша теплішає образ і поєднує всі капсули.', fit: 'Запас ~1 см перед пальцями, пʼята не вискакує.', reject: 'Плями, нерівний ворс, клей на швах.' },
  { id: 'desert', name: 'Desert boots', what: 'Низькі замшеві черевики до щиколотки на легкій підошві.', recognise: '2–3 пари люверсів, гладкий верх, часто креп-підошва.', why: 'Холодніша альтернатива кедам у Mediterranean.', fit: 'Щиколотка не тисне, пальці вільні.', reject: 'Тверда пластикова підошва, зморшки на носку з коробки.' },
  { id: 'slim', name: 'Slim', what: 'Вузький крій по всій довжині.', recognise: 'Тканина близько до тіла в стегнах і литках.', why: 'Тут не пропонується: власник обрав комфорт без skinny.', fit: 'Якщо slim — має бути вільно при присіданні.', reject: 'Тягне в паху чи на стегнах.' },
  { id: 'regular', name: 'Regular', what: 'Стандартний крій без звуження і без зайвого обʼєму.', recognise: 'Тканина рівно спадає від стегна.', why: 'Безпечна база для комфорту.', fit: 'Вільно в стегнах, рівна лінія вниз.', reject: 'Мішкуватість у сидінні.' },
  { id: 'tapered', name: 'Tapered', what: 'Звуження від коліна до низу.', recognise: 'Ширше в стегні, вужче біля щиколотки.', why: '«Regular tapered» — охайно з кедами без skinny-ефекту.', fit: 'Низ не обтягує литку; щиколотка вільна.', reject: 'Звуження обтягує литку.' },
  { id: 'relaxed', name: 'Relaxed', what: 'Навмисно вільний крій.', recognise: 'Помітний обʼєм у стегнах і по всій довжині.', why: 'Для overshirt і верхнього шару — комфорт.', fit: 'Обʼєм без провисання плечей.', reject: 'Тканина збирається складками.' },
  { id: 'straight', name: 'Straight', what: 'Прямий крій однакової ширини від коліна до низу.', recognise: 'Штанина рівна, без звуження.', why: 'Альтернатива tapered для бежевих чінос.', fit: 'Низ лягає на взуття без великого залому.', reject: 'Задовгі, утворюють гармошку.' },
  { id: 'tailored', name: 'Tailored', what: 'Скроєно під фігуру, ближче до класики.', recognise: 'Чіткі лінії, стрілки чи виточки.', why: 'Тут лише для порівняння — капсули casual.', fit: 'Чітко по фігурі без натягу.', reject: 'Тягне при русі.' },
];

const MATCHERS: Record<string, RegExp> = {
  chinos: /chinos|чінос/i,
  overshirt: /overshirt/i,
  oxford: /oxford/i,
  'knit-polo': /трикотажне поло|knit polo/i,
  chore: /chore/i,
  suede: /замш|suede/i,
  desert: /desert/i,
  slim: /\bslim\b/i,
  regular: /\bregular\b/i,
  tapered: /tapered/i,
  relaxed: /relaxed/i,
  straight: /straight/i,
  tailored: /tailored/i,
};

/** Terms mentioned in a text, for contextual legend links. */
export function termsIn(...texts: (string | undefined)[]) {
  const text = texts.filter(Boolean).join(' ');
  return TERMS.filter((t) => MATCHERS[t.id]?.test(text));
}

export function TermLinks({ texts }: { texts: (string | undefined)[] }) {
  const found = termsIn(...texts);
  if (!found.length) return null;
  return (
    <div className="chips">
      {found.map((t) => (
        <a key={t.id} className="badge info" href={`/glossary?term=${t.id}`} title={t.what}>
          ? {t.name}
        </a>
      ))}
    </div>
  );
}

export function GlossaryPage({ focus }: { focus?: string }) {
  useEffect(() => {
    if (focus) document.getElementById(`term-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus]);
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <h1>Довідка</h1>
        </div>
      </div>
      <div className="card pad">
        {TERMS.map((t) => (
          <div key={t.id} id={`term-${t.id}`} className="term">
            <div className="term-head">
              <b>{t.name}</b>
            </div>
            <ol>
              <li><span>Що це:</span> {t.what}</li>
              <li><span>Як упізнати:</span> {t.recognise}</li>
              <li><span>Чому пропонується тобі:</span> {t.why}</li>
              <li><span>Яку посадку перевірити:</span> {t.fit}</li>
              <li><span>Коли відхилити в магазині:</span> {t.reject}</li>
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
