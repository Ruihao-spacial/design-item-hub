import test from 'node:test';
import assert from 'node:assert/strict';

import { validateEngineeringInputs } from '../src/validation.js';
import { seismicBaseShear } from '../src/modules/seismicBaseShear.js';
import { elfDiaphragmCollector } from '../src/modules/elfDiaphragmCollector.js';
import { accumulateStoryShear, checkAspectRatio, distributeByCapacity } from '../src/modules/shearWallCalc.js';

test('base shear calculation returns finite, code-bounded coefficients', () => {
  const output = seismicBaseShear.calc({
    groundMotionSource: 'asce_hazard', ss: 1.5, s1: 0.6, sms: 1.2, sm1: 0.75,
    siteClass: 'D', riskCategory: 'II', systemKey: 'a15', flexibleDiaphragm: false,
    periodType: 'other', hn: 30, tl: 8, tComputed: '',
  });

  assert.equal(output.sds, 0.8);
  assert.equal(output.sd1, 0.5);
  assert.ok(Number.isFinite(output.cs) && output.cs > 0);
  assert.ok(output.cs >= output.csMin);
  assert.ok(output.k >= 1 && output.k <= 2);
});

test('ELF forces sum to base shear and increase with height distribution', () => {
  const output = elfDiaphragmCollector.calc({
    sds: 0.8, cs: 0.1, ie: 1, omega0: 3, rho: 1, k: 1,
    levels: [
      { name: 'Roof', wx: 100, hx: 30, wpx: 100 },
      { name: 'Level 2', wx: 100, hx: 15, wpx: 100 },
    ],
  });

  assert.equal(output.baseShear, 20);
  assert.equal(output.elfTable.reduce((sum, level) => sum + level.fx, 0), output.baseShear);
  assert.ok(output.elfTable[0].fx > output.elfTable[1].fx);
  assert.ok(output.collectorTable.every(level => level.designForce >= 0));
});

test('story shear accumulation and capacity distribution conserve demand', () => {
  const levels = [{ id: 'roof' }, { id: 'second' }];
  const story = accumulateStoryShear({ roof: { seismic: 4 }, second: { seismic: 6 } }, levels);
  assert.deepEqual(story, {
    roof: { seismic: 4, wind: 0 },
    second: { seismic: 10, wind: 0 },
  });

  const shares = distributeByCapacity(
    [{ id: 'a', length: 4 }, { id: 'b', length: 8 }],
    30,
    { a: 100, b: 100 },
  );
  assert.equal(shares.reduce((sum, wall) => sum + wall.share, 0), 30);
  assert.equal(shares[1].share, shares[0].share * 2);
  assert.equal(checkAspectRatio(4, 8).reductionFactor, 1);
  assert.ok(checkAspectRatio(3, 9).reductionFactor < 1);
});

test('validation blocks incomplete structural calculations', () => {
  assert.ok(validateEngineeringInputs('seismic_base_shear', {}).length >= 6);
  assert.ok(validateEngineeringInputs('elf_diaphragm_collector', {
    sds: 0.8, cs: 0.1, ie: 1, omega0: 3, rho: 1, k: 1,
    levels: [{ name: 'Roof', wx: '', hx: 30 }],
  }).some(message => message.includes('seismic weight')));
  assert.ok(validateEngineeringInputs('shear_wall_design', {
    sds: 0.8, loadType: 'seismic',
    levels: [{ id: 'roof', name: 'Roof', floorToFloor: 10 }],
    directions: [{ name: 'N-S', lines: [{ name: 'Line 1', totalLength: 20, walls: [] }] }],
  }).some(message => message.includes('wall segment')));
});
