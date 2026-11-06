// Générateur pseudo-aléatoire déterministe (mulberry32), une graine par flux.

export interface Rng {
  /** Réel dans [0, 1[. */
  next(): number;
  float(min: number, max: number): number;
  /** Entier dans [min, max] (bornes incluses). */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

/** Hachage FNV-1a 32 bits d'une clé composite. */
function hash(keys: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const char of keys.join('\u0000')) {
    h ^= char.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Flux indépendant et reproductible pour une clé (graine, camion, usage…). */
export function createRng(...keys: (string | number)[]): Rng {
  let state = hash(keys);
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const rng: Rng = {
    next,
    float: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new Error('pick() sur une liste vide');
      return items[Math.floor(next() * items.length)];
    },
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
  return rng;
}

export const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
