// Hand-rolled rather than the obscenity package: a username check needs a small list and a normalizer, the pt-BR list would
// have to be written by hand anyway, and that package's value is an English dataset and a matcher built for running text.

export const USERNAME_FORMAT = /^[a-z0-9][a-z0-9_-]{2,19}$/;

// Routes, roles and anything that could pass for the site speaking. Generated names stay ours, so a forced rename can't collide.
const RESERVED = new Set([
  'about', 'account', 'accounts', 'admin', 'administrator', 'api', 'app', 'auth', 'blog', 'bot', 'clerk', 'contact', 'dashboard',
  'delete', 'docs', 'drill', 'export', 'fastypist', 'help', 'home', 'info', 'legal', 'login', 'logout', 'me', 'mod', 'moderator',
  'new', 'null', 'official', 'owner', 'privacy', 'profile', 'progress', 'pt-br', 'public', 'reports', 'results', 'root', 'security',
  'settings', 'sign-in', 'sign-up', 'signin', 'signup', 'staff', 'standings', 'static', 'support', 'system', 'terms', 'test',
  'thefastypist', 'today', 'undefined', 'user', 'users', 'welcome', 'word-lists',
]);
const GENERATED = /^typist-\d+$/;

// Long enough to be unambiguous anywhere in a name.
const OFFENSIVE_ANYWHERE = [
  'asshole', 'bastard', 'bitch', 'blowjob', 'bollocks', 'bugger', 'cocksuck', 'cunt', 'dickhead', 'faggot', 'fuck', 'hitler', 'jerkoff',
  'motherfuck', 'nazi', 'nigga', 'nigger', 'pedophile', 'porn', 'shit', 'slut', 'tranny', 'twat', 'whore',
  'arrombad', 'babaca', 'boceta', 'buceta', 'cacete', 'caralh', 'cuzao', 'desgracad', 'escrot', 'filhadaputa', 'filhodaputa',
  'foder', 'fodase', 'fodido', 'merda', 'pedofil', 'porra', 'punheta', 'putinha', 'quenga', 'sifud', 'vagabunda', 'viado', 'xoxota',
];

// Unsafe to search inside a name: "cu" is in "documento", "puta" in "computador", "rapist" in "therapist", "retard" in "retardar".
const OFFENSIVE_TOKEN = new Set([
  'ass', 'cock', 'cu', 'cum', 'dick', 'fag', 'foda', 'fode', 'kike', 'pau', 'pica', 'puta', 'puto', 'rape', 'rapist', 'retard', 'sex', 'tit', 'tits', 'xana',
]);

const LEET: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' };

function unleet(text: string): string {
  let out = '';
  for (const ch of text) out += LEET[ch] ?? ch;
  return out;
}

/** "fuuuck" reads as the word it spells. Compared squeezed on both sides, so "porra" still matches itself. */
function squeeze(text: string): string {
  return text.replace(/(.)\1+/g, '$1');
}

export function isOffensive(username: string): boolean {
  const tokens = username.split(/[-_]+/).filter(Boolean).map(unleet);
  const squeezed = squeeze(tokens.join(''));
  if (OFFENSIVE_ANYWHERE.some((word) => squeezed.includes(squeeze(word)))) return true;
  return tokens.some((token) => OFFENSIVE_TOKEN.has(token) || OFFENSIVE_TOKEN.has(squeeze(token)));
}

export type UsernameProblem = 'format' | 'reserved' | 'offensive';

/** Case and surrounding space never matter: one spelling per name, so "Ana" and "ana" can't both exist. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function usernameProblem(username: string): UsernameProblem | null {
  if (!USERNAME_FORMAT.test(username)) return 'format';
  if (RESERVED.has(username) || GENERATED.test(username)) return 'reserved';
  return isOffensive(username) ? 'offensive' : null;
}
