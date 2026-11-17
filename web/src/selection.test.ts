import { afterEach, describe, expect, it } from 'vitest';
import { currentSelection, onSelect, resetSelection, select, type Selection } from './selection';

afterEach(() => resetSelection());

describe('selection', () => {
  it('notifies listeners and keeps the current selection', () => {
    const seen: (Selection | null)[] = [];
    onSelect((s) => seen.push(s));
    const s: Selection = { ref: { layer: 'buildings', tile: '0_0', key: 'fix:B1' }, source: 'pick' };
    select(s);
    expect(currentSelection()).toEqual(s);
    select(null);
    expect(currentSelection()).toBeNull();
    expect(seen).toEqual([s, null]);
  });

  it('unsubscribes', () => {
    let n = 0;
    const off = onSelect(() => n++);
    select({ ref: { layer: 'landmark', landmarkId: 'duomo' }, source: 'search' });
    off();
    select(null);
    expect(n).toBe(1);
  });
});
