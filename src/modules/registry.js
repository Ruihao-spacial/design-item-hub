import { seismicMassTakeoff } from './seismicMassTakeoff.js';
import { shearWallDesign } from './shearWallDesign.js';
import { flatLoadCalculator } from './flatLoadCalculator.js';
import { seismicBaseShear } from './seismicBaseShear.js';
import { elfDiaphragmCollector } from './elfDiaphragmCollector.js';
import { diaphragmToLrs } from './diaphragmToLrs.js';
import { diaphragmAnalysis } from './diaphragmAnalysis.js';

// Adding a new design item: create modules/yourModule.js exporting an object
// with the same shape as the ones below, import it here, and push it on.
// No other file needs to change.
export const DESIGN_ITEM_MODULES = [flatLoadCalculator, seismicMassTakeoff, seismicBaseShear, elfDiaphragmCollector, diaphragmToLrs, diaphragmAnalysis, shearWallDesign];

// A module may list formerIds: ids it had before a rename. Saves keep an item's type, so items stored under an old
// id must still find their module.
export function getModule(typeId) {
  return DESIGN_ITEM_MODULES.find((m) => m.id === typeId) || DESIGN_ITEM_MODULES.find((m) => (m.formerIds || []).includes(typeId));
}
