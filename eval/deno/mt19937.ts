/** MT19937 exactly as CPython's `random` implements it: init_by_array seeding,
 * genrand tempering, _randbits/_randbelow and the backwards Fisher-Yates
 * shuffle — so seeded selections match the python-era builder exactly. */

export class MT19937 {
  private mt = new Uint32Array(624);
  private index = 625; // force an initial twist

  private initGenrand(seed: number) {
    this.mt[0] = seed >>> 0;
    for (let i = 1; i < 624; i++) {
      this.mt[i] =
        (Math.imul(1812433253, this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)) +
          i) >>> 0;
    }
    this.index = 624;
  }

  private initByArray(key: number[]) {
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    let k = Math.max(624, key.length);
    for (; k > 0; k--) {
      this.mt[i] = (((this.mt[i] ^
        Math.imul(this.mt[i - 1] ^ (this.mt[i - 1] >>> 30), 1664525)) >>> 0) +
        key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (k = 623; k > 0; k--) {
      this.mt[i] = (((this.mt[i] ^
        Math.imul(this.mt[i - 1] ^ (this.mt[i - 1] >>> 30), 1566083941)) >>>
        0) - i) >>> 0;
      i++;
      if (i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
    }
    this.mt[0] = 0x80000000;
  }

  private nextInt32(): number {
    if (this.index >= 624) {
      for (let i = 0; i < 624; i++) {
        const y = (this.mt[i] & 0x80000000) |
          (this.mt[(i + 1) % 624] & 0x7fffffff);
        let next = this.mt[(i + 397) % 624] ^ (y >>> 1);
        if (y & 1) next ^= 0x9908b0df;
        this.mt[i] = next >>> 0;
      }
      this.index = 0;
    }
    let y = this.mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** CPython `random.random()`: genrand_res53 */
  random(): number {
    const a = this.nextInt32() >>> 5;
    const b = this.nextInt32() >>> 6;
    return (a * 67108864.0 + b) / 9007199254740992.0;
  }

  seed(n: number): this {
    this.initByArray([n >>> 0]);
    return this;
  }

  /** CPython `random._randbits(k)`: k random bits from whole genrand words,
   * little-endian assembly, truncated from the top. */
  private randbits(k: number): number {
    // CPython assembles whole little-endian genrand words; the final (most
    // significant) word is truncated from the top when k is not a multiple of 32
    const words = Math.floor((k - 1) / 32) + 1;
    let r = 0;
    let shift = 0;
    let remaining = k;
    for (let i = 0; i < words; i++, remaining -= 32, shift += 32) {
      let word = this.nextInt32(); // already unsigned
      if (remaining < 32) word = Math.floor(word / 2 ** (32 - remaining));
      r += word * 2 ** shift;
    }
    return r;
  }

  /** CPython `random._randbelow_with_getrandbits` */
  private randbelow(n: number): number {
    const k = n.toString(2).length; // bit_length
    let r = this.randbits(k);
    while (r >= n) r = this.randbits(k);
    return r;
  }

  /** CPython `random.shuffle`: backwards Fisher-Yates over _randbelow(i+1) */
  shuffle<T>(items: T[]) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
  }
}
