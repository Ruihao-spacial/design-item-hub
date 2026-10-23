import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSaveItemArgs, mapRevisionHistory } from '../src/itemPersistence.js';

test('buildSaveItemArgs sends the current calculation without legacy revision payloads', () => {
  const args = buildSaveItemArgs({
    itemId: 'item-1',
    label: 'Wall A',
    customName: '',
    inputs: { force: 12 },
    outputs: { capacity: 20 },
    refs: { source: 'item-0' },
    schemaVersion: 3,
    calcVersion: '2026.10',
  });

  assert.deepEqual(args, {
    p_item_id: 'item-1',
    p_label: 'Wall A',
    p_custom_name: null,
    p_inputs: { force: 12 },
    p_outputs: { capacity: 20 },
    p_refs: { source: 'item-0' },
    p_schema_version: 3,
    p_calc_version: '2026.10',
  });
  assert.equal('revisions' in args, false);
});

test('mapRevisionHistory exposes only ordered revision metadata', () => {
  const mapped = mapRevisionHistory([
    { updated_at: '2026-10-23T18:00:00Z', updated_by: '', inputs: { large: true } },
    { updated_at: '2026-10-21T18:00:00Z', updated_by: 'Maor', outputs: { large: true } },
  ]);

  assert.deepEqual(mapped, [
    { updatedAt: '2026-10-21T18:00:00Z', updatedBy: 'Maor' },
    { updatedAt: '2026-10-23T18:00:00Z', updatedBy: '—' },
  ]);
  assert.equal('inputs' in mapped[0], false);
  assert.equal('outputs' in mapped[0], false);
});
