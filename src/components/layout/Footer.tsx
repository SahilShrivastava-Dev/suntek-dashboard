import React from 'react';
import { useTranslation } from 'react-i18next';

/** v2 global footer — "All times shown in IST" / copyright (per mockups). */
export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="flex items-center justify-between gap-3 flex-wrap mt-8 pt-5 border-t border-slate-200/70 text-[12px] text-slate-400">
      <span>{t('footer.timesIST')}</span>
      <span>{t('footer.copyright')}</span>
    </footer>
  );
}
