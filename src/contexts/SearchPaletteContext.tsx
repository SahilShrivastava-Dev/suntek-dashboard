import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { CommandPalette } from '../components/search/CommandPalette';

interface SearchPaletteValue {
  /** Open the global quick-search palette, optionally pre-filled with a query. */
  openPalette: (initialQuery?: string) => void;
}

const SearchPaletteContext = createContext<SearchPaletteValue>({ openPalette: () => {} });

export function useSearchPalette(): SearchPaletteValue {
  return useContext(SearchPaletteContext);
}

/**
 * Hosts the global quick-search palette and the Cmd/Ctrl+K shortcut. Mounted in
 * DashboardLayout so the palette is available on every dashboard page and any
 * component (sidebar, top bar) can open it via useSearchPalette().
 */
export function SearchPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState('');
  const openPalette = useCallback((q = '') => { setInitialQuery(q); setOpen(true); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <SearchPaletteContext.Provider value={{ openPalette }}>
      {children}
      <CommandPalette open={open} initialQuery={initialQuery} onClose={() => setOpen(false)} />
    </SearchPaletteContext.Provider>
  );
}
