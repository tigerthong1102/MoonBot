import {readdirSync, readFileSync} from 'node:fs';

const folder = new URL('./locales/', import.meta.url);
export const siteLocales = Object.fromEntries(readdirSync(folder).filter(name=>name.endsWith('.json')).map(name=>{
  const copy = JSON.parse(readFileSync(new URL(name,folder),'utf8'));
  if (name !== copy.lang+'.json') throw Error('Locale filename does not match its language: '+name);
  return [copy.lang,copy];
}));

export function sitePath(lang, route) {
  return (lang === 'vi' ? '/' : '/' + lang + '/') + route;
}

export function languageLinks(lang, route) {
  return Object.values(siteLocales).filter(other => other.lang !== lang).map(other =>
    '<a href="' + sitePath(other.lang, route) + '" lang="' + other.lang + '" hreflang="' + other.lang + '">' + other.language + '</a>'
  ).join('');
}
