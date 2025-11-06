import { describe, expect, it } from 'vitest';
import {
  RoomIdGenerator,
  isValidRoomId,
  getDefaultRoomIdGenerator,
  resetDefaultRoomIdGenerator,
} from '../src/logic/room-id';

describe('RoomIdGenerator', () => {
  it('生成されたIDが6桁で制限文字のみを含むこと', () => {
    const generator = new RoomIdGenerator({ seed: 0 });
    const id = generator.generate();

    expect(id).toHaveLength(6);
    expect(isValidRoomId(id)).toBe(true);
  });

  it('10万回生成しても衝突しないこと', () => {
    const generator = new RoomIdGenerator({ seed: 0 });
    const issued = new Set<string>();

    for (let i = 0; i < 100_000; i += 1) {
      const id = generator.generate();
      expect(issued.has(id)).toBe(false);
      issued.add(id);
    }
  });

  it('遅延初期化されたデフォルトジェネレーターを使い回す', () => {
    resetDefaultRoomIdGenerator();
    const first = getDefaultRoomIdGenerator();
    const second = getDefaultRoomIdGenerator();
    expect(first).toBe(second);
  });
});
