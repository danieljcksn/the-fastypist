import { describe, expect, it } from 'vitest';
import { isOffensive, normalizeUsername, usernameProblem } from '@/server/username';

describe('username rules', () => {
  it.each(['ana', 'daniel_c', 'a-b-c', '123', 'typist', 'a'.repeat(20), 'maria-silva', 'joao99'])('accepts %s', (name) => {
    expect(usernameProblem(name)).toBeNull();
  });

  it.each(['ab', '', '_ana', '-ana', 'Ana', 'ana silva', 'a'.repeat(21), 'josé', 'ana!', 'ana.b'])('refuses the format of %s', (name) => {
    expect(usernameProblem(name)).toBe('format');
  });

  it.each(['admin', 'api', 'settings', 'sign-in', 'today', 'pt-br', 'fastypist', 'typist-48213'])('reserves %s', (name) => {
    expect(usernameProblem(name)).toBe('reserved');
  });

  it.each([
    'fuck',
    'f_u_c_k',
    'fuuuck',
    'sh1t',
    'b1tch',
    'n1gger',
    'merda',
    'porra',
    'p0rra',
    'caralho',
    'filho-da-puta',
    'buceta123',
    'cu',
    'ass_hat',
    'pau-mandado',
    'puta',
    'viado',
  ])('flags %s', (name) => {
    expect(isOffensive(name)).toBe(true);
  });

  it.each([
    'class',
    'classic',
    'assassin',
    'bass',
    'documento',
    'computador',
    'therapist',
    'pauline',
    'paulo',
    'cunha',
    'scott',
    'hancock',
    'peacock',
    'retardar',
    'macaco',
    'maria',
    'especular',
  ])('leaves %s alone', (name) => {
    expect(isOffensive(name)).toBe(false);
  });

  it('folds case and space, so one name has one spelling', () => {
    expect(normalizeUsername('  AnA  ')).toBe('ana');
  });
});

describe('passing for the site', () => {
  it.each(['admin-', 'admin_', 'adm1n', 'a-d-m-i-n', 'r00t', 'staff_', 'fastypist_', 'the-fastypist', 'fastypist-team', 'official-fastypist', 'f4stypist'])(
    'reserves %s, however it is spelled',
    (name) => {
      expect(usernameProblem(name)).toBe('reserved');
    },
  );

  it.each(['typist48213', 'typist_48213', 'typist-48213'])('keeps %s for generated names', (name) => {
    expect(usernameProblem(name)).toBe('reserved');
  });

  it.each(['adminton', 'rooted', 'testing', 'typist', 'typist-ana', 'maria-silva', 'me2you', 'bot-tom', '123'])('leaves %s alone', (name) => {
    expect(usernameProblem(name)).toBeNull();
  });
});
