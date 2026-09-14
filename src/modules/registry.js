import { seismicMassTakeoff } from './seismicMassTakeoff.js';
import { shearWallDesign } from './shearWallDesign.js';
import { flatLoadCalculator } from './flatLoadCalculator.js';
import { seismicBaseShear } from './seismicBaseShear.js';
import { elfDiaphragmCollector } from './elfDiaphragmCollector.js';

// Adding a new design item: create modules/yourModule.js exporting an object
// with the same shape as the ones below, import it here, and push it on.
// No other file needs to change.
export const DESIGN_ITEM_MODULES = [flatLoadCalculator, seismicMassTakeoff, seismicBaseShear, elfDiaphragmCollector, shearWallDesign];

export function getModule(typeId) {
  return DESIGN_ITEM_MODULES.find((m) => m.id === typeId);
}
