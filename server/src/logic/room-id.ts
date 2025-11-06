const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const BASE = ALPHABET.length;

export interface RoomIdGeneratorOptions {
  seed?: number;
}

export class RoomIdGenerator {
  private issued = new Set<string>();
  private counter: number;

  constructor(options: RoomIdGeneratorOptions = {}) {
    this.counter = options.seed ?? createSeed();
  }

  generate(): string {
    for (let attempt = 0; attempt < BASE * CODE_LENGTH; attempt += 1) {
      const candidate = encodeBase32(this.counter);
      this.counter = (this.counter + 1) % Math.pow(BASE, CODE_LENGTH);

      if (!this.issued.has(candidate)) {
        this.issued.add(candidate);
        return candidate;
      }
    }

    throw new Error('Failed to allocate a unique room ID');
  }
}

function encodeBase32(value: number): string {
  let remainder = value;
  let result = '';

  for (let i = 0; i < CODE_LENGTH; i += 1) {
    const index = remainder % BASE;
    result = ALPHABET[index] + result;
    remainder = Math.floor(remainder / BASE);
  }

  return result.padStart(CODE_LENGTH, ALPHABET[0]);
}

function createSeed(): number {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] % Math.pow(BASE, CODE_LENGTH);
  }

  return Math.floor(Math.random() * Math.pow(BASE, CODE_LENGTH));
}

let sharedGenerator: RoomIdGenerator | null = null;

export function getDefaultRoomIdGenerator(): RoomIdGenerator {
  if (sharedGenerator === null) {
    sharedGenerator = new RoomIdGenerator();
  }
  return sharedGenerator;
}

export function resetDefaultRoomIdGenerator(): void {
  sharedGenerator = null;
}

export function isValidRoomId(id: string): boolean {
  if (id.length !== CODE_LENGTH) {
    return false;
  }

  return [...id].every((char) => ALPHABET.includes(char.toUpperCase()));
}
