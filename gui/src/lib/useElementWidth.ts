import { useLayoutEffect, useState } from 'react';

/** The width of an element, kept current as it changes. Zero while there is no element. */
export function useElementWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) { setWidth(0); return; }
    const update = () => setWidth(Math.round(element.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}
