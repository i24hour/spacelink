"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps the water aesthetic, but avoids scroll jank on phones by:
 * 1) Promoting the layer to its own compositor
 * 2) Pausing CSS animations while the user is actively scrolling
 */
export function WaterBackground() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let scrolling = false;

    const setScrolling = (next: boolean) => {
      if (scrolling === next) return;
      scrolling = next;
      root.classList.toggle("is-scrolling", next);
      document.documentElement.classList.toggle("water-scrolling", next);
    };

    const onScroll = () => {
      setScrolling(true);
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setScrolling(false), 140);
    };

    // Capture scroll from any nested scroller + window
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("touchmove", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("touchmove", onScroll);
      if (idleTimer) clearTimeout(idleTimer);
      document.documentElement.classList.remove("water-scrolling");
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="water-scene pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      aria-hidden
    >
      <div className="water-blob water-blob-1" />
      <div className="water-blob water-blob-2" />
      <div className="water-blob water-blob-3" />
      <div className="water-blob water-blob-4" />
      <div className="water-wave" />
      <div className="water-wave water-wave-2" />
      <div className="water-grain" />
    </div>
  );
}
