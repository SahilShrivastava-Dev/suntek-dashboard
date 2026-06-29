/**
 * i18n engine (react-i18next).
 *
 * Language follows the user's saved `preferred_language` (set by them in
 * Settings or by an admin in User Management) — RoleContext applies it on login
 * via applyLanguage(). The TopBar globe switcher changes it on the fly.
 *
 * Only UI LABELS are translated; data (names, IDs, batch/part numbers, plants)
 * always renders as entered. Missing keys fall back to English, so the app
 * never breaks or shows blanks while more screens are translated.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import hi from './locales/hi';

const STORAGE_KEY = 'suntek.lang';

/** Languages with a filled translation file (others fall back to English). */
export const AVAILABLE_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी · Hindi' },
];

export function storedLanguage(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'en';
  } catch {
    return 'en';
  }
}

/** Switch the UI language and remember it for the next boot (avoids a flash). */
export function applyLanguage(code: string | null | undefined): void {
  const lng = code || 'en';
  if (i18n.language !== lng) i18n.changeLanguage(lng);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* storage unavailable — language is session-only */
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
  },
  lng: storedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  // Resources are bundled synchronously, so never suspend (no boundary needed).
  react: { useSuspense: false },
});

export default i18n;
