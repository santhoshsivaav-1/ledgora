import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import AuthGate from '../features/auth/AuthGate';
import PublicCatalogPage from '../features/catalog/PublicCatalogPage';
import UpgradeSheetHost from '../components/ui/UpgradeSheet';
import { createQueryClient } from '../lib/queryClient';

// Dark mode (change 3.2). A UI preference, so it is one of the few things that still lives in localStorage.
const THEME_KEY = 'freegstbill_theme';
interface ThemeValue {
  dark: boolean;
  toggle: () => void;
}
const ThemeContext = createContext<ThemeValue>({ dark: false, toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      /* private window */
    }
  }, [dark]);
  const value = useMemo(() => ({ dark, toggle: () => setDark((d) => !d) }), [dark]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Everything the app sits inside, outermost first: the router (URLs), the server-data cache (Query), the theme, and the
 * sign-in gate, which supplies the signed-in user and organization (read them with useSession()).
 */
// The public catalogue (/c/<slug>, P9-S6) needs no sign-in, so it is drawn outside the gate.
const publicSlug = typeof window !== 'undefined' ? /^\/c\/([a-z0-9-]{3,40})\/?$/i.exec(window.location.pathname)?.[1] : undefined;

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  if (publicSlug) return <PublicCatalogPage slug={publicSlug.toLowerCase()} />;
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthGate>{children}</AuthGate>
          <UpgradeSheetHost />
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
