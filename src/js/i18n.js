import { settings } from './lib/store.js';
import en from './i18n/en.js';
import id from './i18n/id.js';

const dicts = { en, id };
let lang = settings.get('lang') || ((navigator.language || '').toLowerCase().startsWith('id') ? 'id' : 'en');

export const getLang = () => lang;
export const languages = Object.keys(dicts);

export function setLang(next) {
  lang = dicts[next] ? next : 'en';
  settings.set('lang', lang);
  document.documentElement.lang = lang;
}

export function t(key, vars) {
  let s = dicts[lang][key] ?? dicts.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}

export function plural(n, oneKey, manyKey) {
  return t(n === 1 ? oneKey : manyKey, { n });
}

export function formatDate(ts) {
  return new Date(ts).toLocaleString(lang === 'id' ? 'id-ID' : 'en-US', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
