import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Deck, Slide } from '../contracts/types';
import { renderPage } from '../lib/pdf';

/**
 * Renders one slide at 16:9 (or the PDF page's own aspect), fitted inside its
 * parent. PDF decks render with PDF.js; demo / text-only decks get a designed
 * lecture-slide layout; image-only slides show the image.
 */
export function SlideView({
  deck,
  slide,
  emphasis,
  className = '',
}: {
  deck: Deck;
  slide: Slide;
  /** Key term to highlight (rescue mode). */
  emphasis?: string | null;
  className?: string;
  /** Kept for callers; slides sit on a tone step, never a shadow. */
  shadow?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className={`relative grid h-full w-full min-h-0 min-w-0 place-items-center ${className}`}>
      {size && size.w > 0 && (
        deck.pdfUrl ? (
          <PdfSlide url={deck.pdfUrl} index={slide.index} box={size} />
        ) : slide.imageUrl ? (
          <img src={slide.imageUrl} alt={slide.title} className="max-h-full max-w-full rounded-[var(--r-paper)] object-contain" />
        ) : (
          <TextSlide slide={slide} box={size} emphasis={emphasis} />
        )
      )}
    </div>
  );
}

function PdfSlide({ url, index, box }: { url: string; index: number; box: { w: number; h: number } }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    setReady(false);
    if (canvas.current)
      renderPage(url, index, canvas.current, { width: box.w, height: box.h })
        .then(() => alive && setReady(true))
        .catch((err: Error) => {
          if (err?.name !== 'RenderingCancelledException') console.warn('Slide render failed', err);
        });
    return () => {
      alive = false;
    };
  }, [url, index, box.w, box.h]);
  return (
    <canvas
      ref={canvas}
      className="rounded-[var(--r-paper)] bg-white transition-opacity duration-150"
      style={{ opacity: ready ? 1 : 0 }}
      aria-label={`Slide ${index + 1}`}
    />
  );
}

/** Splits demo text into lead + bullets, rendering ==terms== as highlighter swipes. */
function rich(text: string, emphasis?: string | null) {
  const parts = text.split(/(==.+?==)/g);
  return parts.map((p, i) => {
    const m = p.match(/^==(.+)==$/);
    if (!m) return <span key={i}>{p}</span>;
    const on = !emphasis || emphasis.toLowerCase() === m[1].toLowerCase();
    return (
      <span key={i} className={on ? 'hl' : 'font-semibold'}>
        {m[1]}
      </span>
    );
  });
}

function TextSlide({ slide, box, emphasis }: { slide: Slide; box: { w: number; h: number }; emphasis?: string | null }) {
  // A tall, narrow room (a phone held upright in study mode) gets the slide
  // reflowed as a page at reading size; a 16:9 slide would set its text at 7px.
  if (box.w < 520 && box.h > box.w * 1.3) return <TextPage slide={slide} box={box} emphasis={emphasis} />;
  const ratio = 16 / 9;
  const w = Math.min(box.w, box.h * ratio);
  const h = w / ratio;
  // type scales with the slide, like a real deck
  const u = w / 100;
  const [lead, ...rest] = slide.text.split('\n');
  const bullets = rest.filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  const extra = rest.filter((l) => !l.startsWith('- '));
  const isTitle = slide.index === 0;

  return (
    <article
      className="relative overflow-hidden rounded-[var(--r-paper)] bg-slide text-ink"
      style={{ width: w, height: h, padding: `${u * 6}px ${u * 7}px` }}
      aria-label={`Slide ${slide.index + 1}: ${slide.title}`}
    >
      {isTitle ? (
        <div className="flex h-full flex-col justify-center">
          <h2 style={{ fontSize: u * 6.8, lineHeight: 1.02, letterSpacing: '-0.025em' }}>{slide.title}</h2>
          <p className="mt-[2%] text-graphite" style={{ fontSize: u * 2.2 }}>
            {lead}
          </p>
          {extra.map((l, i) => (
            <p key={i} className="text-graphite" style={{ fontSize: u * 2.2 }}>
              {l}
            </p>
          ))}
        </div>
      ) : (
        <>
          <h2 style={{ fontSize: u * 4.2, letterSpacing: '-0.02em' }}>{slide.title}</h2>
          <p className="max-w-[88%]" style={{ fontSize: u * 2.25, marginTop: u * 2.2, lineHeight: 1.4 }}>
            {rich(lead, emphasis)}
          </p>
          {bullets.length > 0 && (
            <ul className="grid list-none p-0" style={{ fontSize: u * 2, marginTop: u * 2.6, gap: u * 1.1 }}>
              {bullets.map((b, i) => (
                <li key={i} className="flex text-graphite" style={{ gap: u * 1.4 }}>
                  <span className="mt-[0.55em] h-[0.32em] w-[0.32em] flex-none rounded-full bg-pencil" aria-hidden />
                  <span>{rich(b, emphasis)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

function TextPage({ slide, box, emphasis }: { slide: Slide; box: { w: number; h: number }; emphasis?: string | null }) {
  const [lead, ...rest] = slide.text.split('\n');
  const bullets = rest.filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  const extra = rest.filter((l) => !l.startsWith('- '));
  const isTitle = slide.index === 0;
  return (
    <article
      className="relative w-full overflow-y-auto rounded-[var(--r-paper)] bg-slide px-6 py-8 text-ink"
      style={{ maxHeight: box.h, minHeight: Math.min(box.h, box.w * 1.1) }}
      aria-label={`Slide ${slide.index + 1}: ${slide.title}`}
    >
      {isTitle ? (
        <div className="flex h-full flex-col justify-center">
          <h2 className="text-[34px] leading-[1.02] tracking-[-0.025em]">{slide.title}</h2>
          {[lead, ...extra].map((l, i) => (
            <p key={i} className={`text-[17px] text-graphite ${i === 0 ? 'mt-4' : ''}`}>
              {l}
            </p>
          ))}
        </div>
      ) : (
        <>
          <h2 className="text-[24px] tracking-[-0.02em]">{slide.title}</h2>
          <p className="mt-4 text-[18px] leading-[1.45]">{rich(lead, emphasis)}</p>
          {bullets.length > 0 && (
            <ul className="mt-5 grid list-none gap-2.5 p-0 text-[17px] leading-[1.4]">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-3 text-graphite">
                  <span className="mt-[0.55em] h-[0.32em] w-[0.32em] flex-none rounded-full bg-pencil" aria-hidden />
                  <span>{rich(b, emphasis)}</span>
                </li>
              ))}
            </ul>
          )}
          {extra.map((l, i) => (
            <p key={i} className="mt-4 text-[17px] text-graphite">
              {rich(l, emphasis)}
            </p>
          ))}
        </>
      )}
    </article>
  );
}
