import { Moon, Sun } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import clsx from 'clsx';

type Theme = 'light' | 'dark';
const storageKey = 'chal-jhootha-theme';

let cachedTheme: Theme | null = null;

function initialTheme(): Theme {
  if (cachedTheme) return cachedTheme;
  const saved = window.localStorage.getItem(storageKey);
  if (saved === 'light' || saved === 'dark') {
    cachedTheme = saved;
    return saved;
  }
  cachedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return cachedTheme;
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useLayoutEffect(() => {
    cachedTheme = theme;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(storageKey, theme);
  }, [theme]);

  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      className={clsx('icon-btn', className)}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Use light theme' : 'Use dark theme'}
      title={isDark ? 'Use light theme' : 'Use dark theme'}
    >
      {isDark ? <Sun size={20} strokeWidth={2.5} /> : <Moon size={20} strokeWidth={2.5} />}
    </button>
  );
}
