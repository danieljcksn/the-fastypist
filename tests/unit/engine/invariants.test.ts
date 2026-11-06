import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Config, type Op, type State, expire, init, letterStatus, step } from '@/engine/core';
import { generateWords } from '@/engine/generate';
import { layoutLines } from '@/engine/layout';
import { decodeLog, encodeLog } from '@/engine/log';
import { replay } from '@/engine/replay';
import { rawCx } from '@/engine/score';
import { LIST, RUNS, WORDS_CFG, arbRun, arbScript, arbSeed, arbWords, run, withHolds } from './arbitraries';

const canon = (s: State): string => JSON.stringify(s);

describe('engine invariants', () => {
  it('0. the generator reaches the states these properties are about', () => {
    let pastCut = 0;
    let finishedWords = 0;
    let deep = 0;
    let returned = 0;
    let extras = 0;
    let wrongLast = 0;
    for (const [c, w, o] of fc.sample(arbRun, 1000)) {
      const s = replay(c, w, o).state;
      if (c.mode === 'time' && o.some((x) => x.t >= s.startT + c.durationMs)) pastCut++;
      if (c.mode === 'words' && s.phase === 'finished') finishedWords++;
      if (s.w >= 5) deep++;
      if (o.some((x, i) => x.k === 'b' && o[i - 1]?.k === 's')) returned++;
      if (s.typed.some((y, i) => y.length > (w[i] ?? '').length)) extras++;
      if (s.allCommitted && s.typed[s.w] !== w[s.w]) wrongLast++;
    }
    for (const count of [pastCut, finishedWords, deep, returned, extras, wrongLast]) expect(count).toBeGreaterThan(20);
  });

  it('1. replay is deterministic', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const a = replay(c, w, o);
        const b = replay(c, w, o);
        return canon(a.state) === canon(b.state) && JSON.stringify(a.score) === JSON.stringify(b.score);
      }),
      RUNS,
    );
  });

  it('2. stepping live equals replay', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const s = run(c, w, o);
        expire(c, s);
        return canon(s) === canon(replay(c, w, o).state);
      }),
      RUNS,
    );
  });

  it('3. shifting every timestamp changes no score', () => {
    fc.assert(
      fc.property(arbRun, fc.nat(1_000_000), ([c, w, o], d) => {
        const shifted = o.map((x) => ({ ...x, t: x.t + d }));
        return JSON.stringify(replay(c, w, o).score) === JSON.stringify(replay(c, w, shifted).score);
      }),
      RUNS,
    );
  });

  it('4. typed.length is w+1 and w stays in range', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const s = init();
        for (const x of o) {
          step(c, w, s, x);
          if (s.typed.length !== s.w + 1 || s.w < 0 || s.w >= w.length) return false;
        }
        return true;
      }),
      RUNS,
    );
  });

  it('5. extras never exceed maxExtra', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const s = init();
        for (const x of o) {
          step(c, w, s, x);
          for (let i = 0; i <= s.w; i++) {
            if ((s.typed[i] ?? '').length - (w[i] ?? '').length > c.maxExtra) return false;
          }
        }
        return true;
      }),
      RUNS,
    );
  });

  it('6. keystroke counters never decrease, so correcting cannot launder an error', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const s = init();
        let good = 0;
        let bad = 0;
        for (const x of o) {
          step(c, w, s, x);
          if (s.correctKeys < good || s.wrongKeys < bad) return false;
          good = s.correctKeys;
          bad = s.wrongKeys;
        }
        return true;
      }),
      RUNS,
    );
  });

  it('6a. correct keys never exceed the slots reached, whatever the corrections', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const s = init();
        let furthest = 0;
        for (const x of o) {
          step(c, w, s, x);
          if (s.w > furthest) furthest = s.w;
        }
        let slots = 0;
        for (let i = 0; i <= furthest; i++) slots += (w[i] ?? '').length + 1;
        return s.correctKeys <= slots;
      }),
      RUNS,
    );
  });

  it('6b. repeating any press and deleting it earns at most one correct key', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const s = run(c, w, o);
        if (s.phase !== 'running') return true;
        const target = w[s.w] ?? '';
        const cur = s.typed[s.w] ?? '';
        if (cur.length >= target.length || s.w === w.length - 1) return true;
        const before = s.correctKeys;
        const t = s.lastT;
        for (let i = 0; i < 50; i++) {
          step(c, w, s, { k: 'c', ch: target.charAt(cur.length), t });
          step(c, w, s, { k: 'b', t });
        }
        return s.correctKeys <= before + 1;
      }),
      RUNS,
    );
  });

  it('6c. raw counts every press, so insertions are the three counters', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const r = replay(c, w, o).score;
        return r.rawCx === rawCx(r.correctKeys + r.wrongKeys + r.repeatKeys, r.elapsedMs);
      }),
      RUNS,
    );
  });

  it('7. a correct committed word stays locked', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const s = init();
        const locked = new Map<number, string>();
        for (const x of o) {
          step(c, w, s, x);
          for (const [i, v] of locked) if (s.typed[i] !== v) return false;
          for (let i = 0; i < s.w; i++) if (s.typed[i] === w[i]) locked.set(i, s.typed[i] ?? '');
        }
        return true;
      }),
      RUNS,
    );
  });

  it('8. finished is absorbing', () => {
    fc.assert(
      fc.property(arbRun, arbScript, ([c, w, o], more) => {
        const s = run(c, w, o);
        s.phase = 'finished';
        const before = canon(s);
        let t = s.lastT;
        for (const m of more) {
          t += m.dt;
          step(c, w, s, { k: 'c', ch: m.ch, t });
          step(c, w, s, { k: 's', t });
          step(c, w, s, { k: 'b', t });
          step(c, w, s, { k: 'w', t });
          step(c, w, s, { k: 'd', t });
        }
        return canon(s) === before;
      }),
      RUNS,
    );
  });

  it('9. ops at or past start+duration change nothing', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        if (c.mode !== 'time') return true;
        const first = o.find((x) => x.k === 'c' || x.k === 'd');
        if (first === undefined) return true;
        const cut = first.t + c.durationMs;
        const a = replay(c, w, o);
        const b = replay(c, w, o.filter((x) => x.t < cut));
        return canon(a.state) === canon(b.state) && JSON.stringify(a.score) === JSON.stringify(b.score);
      }),
      RUNS,
    );
  });

  it('10. credited chars are bounded by correct keys, and net by raw', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const r = replay(c, w, o);
        return r.score.scoredChars <= r.state.correctKeys && r.score.wpmCx <= r.score.rawCx;
      }),
      RUNS,
    );
  });

  it('11. accuracy is in [0,100] and elapsed is non-negative', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const r = replay(c, w, o).score;
        return r.accuracy >= 0 && r.accuracy <= 100 && r.accuracyBp >= 0 && r.accuracyBp <= 10000 && r.elapsedMs >= 0;
      }),
      RUNS,
    );
  });

  it('12. a perfect typist gets exactly 100 with every word correct', () => {
    fc.assert(
      fc.property(arbWords, fc.nat(300), (w, dt) => {
        const o: Op[] = [];
        let t = 0;
        w.forEach((x, i) => {
          for (const ch of x) {
            t += dt + 1;
            o.push({ k: 'c', ch, t });
          }
          if (i < w.length - 1) {
            t += dt + 1;
            o.push({ k: 's', t });
          }
        });
        const r = replay(WORDS_CFG, w, o);
        return (
          r.state.phase === 'finished' &&
          r.score.accuracy === 100 &&
          r.score.accuracyBp === 10000 &&
          r.score.finalTextBp === 10000 &&
          r.score.wordsCorrect === w.length &&
          r.score.wordsWrong === 0
        );
      }),
      RUNS,
    );
  });

  it('13. with stopOn set, no wrong word is committed', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        if (c.stopOn === 'none') return true;
        const s = replay(c, w, o).state;
        for (let i = 0; i < s.w; i++) if (s.typed[i] !== w[i]) return false;
        return true;
      }),
      RUNS,
    );
  });

  it('14. a log round trip replays identically', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const decoded = decodeLog(encodeLog(o));
        if (decoded === null) return false;
        return JSON.stringify(replay(c, w, o).score) === JSON.stringify(replay(c, w, decoded).score);
      }),
      RUNS,
    );
  });

  it('15. char then backspace restores the word', () => {
    fc.assert(
      fc.property(arbRun, fc.constantFrom(...'abc'), ([c, w, o], ch) => {
        if (c.stopOn === 'letter') return true;
        const s = run(c, w, o);
        if (s.phase !== 'running') return true;
        const cur = s.typed[s.w] ?? '';
        const target = w[s.w] ?? '';
        if (cur.length >= target.length && cur.length - target.length >= c.maxExtra) return true;
        if (s.w === w.length - 1) return true;
        const t = s.lastT;
        step(c, w, s, { k: 'c', ch, t });
        step(c, w, s, { k: 'b', t });
        return s.typed[s.w] === cur;
      }),
      RUNS,
    );
  });

  it('16. every typed letter is correct, wrong or extra', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const s = replay(c, w, o).state;
        for (let i = 0; i <= s.w; i++) {
          for (let j = 0; j < (s.typed[i] ?? '').length; j++) {
            if (!['correct', 'wrong', 'extra'].includes(letterStatus(w, s, i, j))) return false;
          }
        }
        return true;
      }),
      RUNS,
    );
  });

  it('17. the same seed gives the same words, with no repeat within 3', () => {
    fc.assert(
      fc.property(arbSeed, fc.integer({ min: 2, max: 400 }), (seed, count) => {
        const a = generateWords({ seed, list: LIST, count });
        const b = generateWords({ seed, list: LIST, count });
        if (a.join() !== b.join()) return false;
        for (let i = 1; i < a.length; i++) {
          for (let j = Math.max(0, i - 3); j < i; j++) if (a[i] === a[j]) return false;
        }
        return true;
      }),
      RUNS,
    );
  });

  it('18. asking for fewer words gives a prefix', () => {
    fc.assert(
      fc.property(arbSeed, fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 200 }), (seed, x, y) => {
        const [m, n] = x < y ? [x, y] : [y, x];
        const a = generateWords({ seed, list: LIST, count: m });
        const b = generateWords({ seed, list: LIST, count: n });
        return b.slice(0, m).join() === a.join();
      }),
      RUNS,
    );
  });

  it('19. lines partition the words in order and fit, unless one word is wider than the line', () => {
    fc.assert(
      fc.property(arbWords, fc.integer({ min: 8, max: 80 }), (w, cols) => {
        let next = 0;
        for (const line of layoutLines(w, cols)) {
          if (line.first !== next) return false;
          next = line.last + 1;
          const len = w.slice(line.first, line.last + 1).join(' ').length;
          if (len !== line.cols) return false;
          if (len > cols && line.first !== line.last) return false;
        }
        return next === w.length;
      }),
      RUNS,
    );
  });
});

describe('dead keys and holds', () => {
  const dropDead = (o: readonly Op[]): Op[] => o.filter((x) => x.k !== 'd');

  it('dead keys never change text', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const s = init();
        for (const x of o) {
          const before = JSON.stringify([s.typed, s.w, s.correctKeys, s.wrongKeys]);
          step(c, w, s, x);
          if (x.k === 'd' && JSON.stringify([s.typed, s.w, s.correctKeys, s.wrongKeys]) !== before) return false;
        }
        return true;
      }),
      RUNS,
    );
  });

  it('in words mode, removing the dead keys changes no text and no key counts', () => {
    fc.assert(
      fc.property(arbRun, ([c, w, o]) => {
        const cfg: Config = { ...c, mode: 'words' };
        const a = replay(cfg, w, o).state;
        const b = replay(cfg, w, dropDead(o)).state;
        return JSON.stringify([a.typed, a.w, a.correctKeys, a.wrongKeys]) === JSON.stringify([b.typed, b.w, b.correctKeys, b.wrongKeys]);
      }),
      RUNS,
    );
  });

  it('a dead key starts the clock when idle', () => {
    const s = init();
    step(WORDS_CFG, ['não'], s, { k: 'd', t: 500 });
    expect(s).toMatchObject({ phase: 'running', startT: 500, deadKeys: 1, wrongKeys: 0, correctKeys: 0, typed: [''] });
  });

  it('h never changes the score', () => {
    const arbHolds = fc.array(fc.option(fc.nat(100_000), { nil: undefined }), { minLength: 1, maxLength: 16 });
    fc.assert(
      fc.property(arbRun, arbHolds, ([c, w, o], holds) => {
        const plain = replay(c, w, o);
        const held = replay(c, w, withHolds(o, holds));
        return canon(plain.state) === canon(held.state) && JSON.stringify(plain.score) === JSON.stringify(held.score);
      }),
      RUNS,
    );
  });
});
