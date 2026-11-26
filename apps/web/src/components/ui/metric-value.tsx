'use client';

import React, { useEffect, useRef, useState } from 'react';

export function MetricValue({ value, ready, suffix = '' }: { value: number; ready: boolean; suffix?: string }) {
  const [display, setDisplay] = useState<number | null>(null);
  const animated = useRef(false);

  useEffect(() => {
    if (!ready || animated.current) return;
    animated.current = true;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches || !Number.isFinite(value) || value === 0) return;
    let frame = 0;
    const start = performance.now();
    const stop = () => {
      cancelAnimationFrame(frame);
      setDisplay(null);
    };
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 220);
      setDisplay(progress < 1 ? Math.round(value * (1 - (1 - progress) ** 3)) : null);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    preference.addEventListener('change', stop);
    return () => { cancelAnimationFrame(frame); preference.removeEventListener('change', stop); };
  }, [ready, value]);

  if (!ready) return <span aria-label="Carregando indicador">—</span>;
  return <span className="tabular-nums">
    <span className="sr-only">{value.toLocaleString('pt-BR')}{suffix}</span>
    <span aria-hidden="true">{(display ?? value).toLocaleString('pt-BR')}{suffix}</span>
  </span>;
}
