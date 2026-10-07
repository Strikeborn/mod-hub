import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  itemCount: number;
};

/**
 * Horizontal carousel (8 x 3 cards visible). Each wheel notch moves ONE column with a short,
 * gentle ease — no long full-page slides. Respects "reduce motion" (jumps instantly).
 */
export function ModCarousel({ children, itemCount }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let target = el.scrollLeft;
    let anim = 0;

    const step = () => {
      const first = el.firstElementChild as HTMLElement | null;
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      return (first?.getBoundingClientRect().width ?? el.clientWidth / 8) + gap;
    };

    const animateTo = (to: number) => {
      cancelAnimationFrame(anim);
      if (reduce) {
        el.scrollLeft = to;
        return;
      }
      const from = el.scrollLeft;
      const start = performance.now();
      const dur = 180;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - (1 - t) * (1 - t); // ease-out, short and soft
        el.scrollLeft = from + (to - from) * eased;
        if (t < 1) anim = requestAnimationFrame(tick);
      };
      anim = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!delta) return;
      e.preventDefault();
      const col = step();
      const max = el.scrollWidth - el.clientWidth;
      // Snap the running target to a column, then move one column per notch.
      target = Math.round((anim ? target : el.scrollLeft) / col) * col + Math.sign(delta) * col;
      target = Math.max(0, Math.min(max, target));
      animateTo(target);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(anim);
      el.removeEventListener('wheel', onWheel);
    };
  }, [itemCount]);

  return (
    <div className="mod-carousel" ref={ref}>
      {children}
    </div>
  );
}
