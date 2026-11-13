'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      aria-label={dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="craft-pill inline-flex h-9 w-9 items-center justify-center rounded-full border border-border-color bg-bg-surface text-text-primary transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:focus-visible:ring-[#d97324]"
    >
      {mounted && dark ? (
        <Sun className="h-4 w-4 text-[#f29a4b]" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
