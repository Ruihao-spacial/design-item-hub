import { ASSEMBLY_TYPES } from './modules/flatLoadMaterials.js';

const isPresent = value => value !== '' && value !== null && value !== undefined;
const asNumber = value => Number(value);

function requirePositive(errors, value, label, { allowZero = false } = {}) {
  if (!isPresent(value) || !Number.isFinite(asNumber(value)) || (allowZero ? asNumber(value) < 0 : asNumber(value) <= 0)) {
    errors.push(`${label} must be ${allowZero ? 'zero or greater' : 'greater than zero'}.`);
  }
}

function validateFlatLoad(inputs, errors) {
  const tabs = Array.isArray(inputs.tabs) ? inputs.tabs : [];
  if (tabs.length === 0) errors.push('Add at least one load assembly.');

  tabs.forEach((tab, index) => {
    const label = tab.name?.trim() || `Assembly ${index + 1}`;
    if (!tab.type || !ASSEMBLY_TYPES[tab.type]) errors.push(`${label} must have a recognized assembly type.`);
    if (isPresent(tab.liveLoad)) requirePositive(errors, tab.liveLoad, `${label} live load`, { allowZero: true });
    if (tab.includeLLinSeismic) {
      const percent = asNumber(tab.seismicLLPercent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        errors.push(`${label} seismic live-load percentage must be between 0 and 100.`);
      }
    }
    if (isPresent(tab.roofSlope)) requirePositive(errors, tab.roofSlope, `${label} roof slope`, { allowZero: true });

    for (const item of (tab.items || [])) {
      const itemLabel = item.name?.trim() || 'Custom load';
      requirePositive(errors, item.psf, `${label}: ${itemLabel} load`, { allowZero: true });
      if (item.perInch) requirePositive(errors, item.thickness, `${label}: ${itemLabel} thickness`);
      if (item.coverageEligible && isPresent(item.coveragePercent)) {
        const coverage = asNumber(item.coveragePercent);
        if (!Number.isFinite(coverage) || coverage < 0 || coverage > 100) {
          errors.push(`${label}: ${itemLabel} coverage must be between 0 and 100.`);
        }
      }
    }
  });
}

function validateMassTakeoff(inputs, errors) {
  const levels = Array.isArray(inputs.levels) ? inputs.levels : [];
  if (levels.length === 0) errors.push('Add at least one building level.');

  levels.forEach((level, index) => {
    const label = level.name?.trim() || `Level ${index + 1}`;
    if (!level.name?.trim()) errors.push(`Level ${index + 1} needs a name.`);
    requirePositive(errors, level.hx, `${label} elevation`);

    let hasMass = false;
    for (const row of (level.areaMasses || [])) {
      if (!isPresent(row.area) && !isPresent(row.psf)) continue;
      requirePositive(errors, row.area, `${label} area`);
      requirePositive(errors, row.psf, `${label} area load`);
      hasMass = true;
    }
    for (const row of (level.lineMasses || [])) {
      if (!isPresent(row.length) && !isPresent(row.psf) && !isPresent(row.tribHeight)) continue;
      requirePositive(errors, row.length, `${label} line length`);
      requirePositive(errors, row.psf, `${label} line load`);
      requirePositive(errors, row.tribHeight, `${label} tributary height`);
      hasMass = true;
    }
    for (const row of (level.pointMasses || [])) {
      if (!isPresent(row.weight)) continue;
      requirePositive(errors, row.weight, `${label} point weight`);
      hasMass = true;
    }
    if (!hasMass) errors.push(`${label} must include at least one mass entry.`);
  });
}

function validateBaseShear(inputs, errors) {
  requirePositive(errors, inputs.ss, 'Sₛ');
  requirePositive(errors, inputs.s1, 'S₁');
  requirePositive(errors, inputs.sms, 'Sₘₛ');
  requirePositive(errors, inputs.sm1, 'Sₘ₁');
  requirePositive(errors, inputs.hn, 'Structural height hₙ');
  requirePositive(errors, inputs.tl, 'Long-period transition period Tₗ');
  if (isPresent(inputs.tComputed)) requirePositive(errors, inputs.tComputed, 'Computed period T');
  if (!inputs.systemKey) errors.push('Select a seismic-force-resisting system.');
  if (inputs.systemKey === 'custom') {
    requirePositive(errors, inputs.rManual, 'Response modification factor R');
    requirePositive(errors, inputs.omega0Manual, 'Overstrength factor Ω₀');
    requirePositive(errors, inputs.cdManual, 'Deflection amplification factor Cᴅ');
  }
}

function validateElf(inputs, errors) {
  requirePositive(errors, inputs.sds, 'Sᴅₛ');
  requirePositive(errors, inputs.cs, 'Seismic response coefficient Cₛ');
  requirePositive(errors, inputs.ie, 'Importance factor Iₑ');
  requirePositive(errors, inputs.omega0, 'Overstrength factor Ω₀');
  requirePositive(errors, inputs.rho, 'Redundancy factor ρ');
  requirePositive(errors, inputs.k, 'Vertical distribution exponent k');

  const levels = Array.isArray(inputs.levels) ? inputs.levels : [];
  if (levels.length === 0) errors.push('Add at least one building level.');
  levels.forEach((level, index) => {
    const label = level.name?.trim() || `Level ${index + 1}`;
    if (!level.name?.trim()) errors.push(`Level ${index + 1} needs a name.`);
    requirePositive(errors, level.wx, `${label} seismic weight wₓ`);
    requirePositive(errors, level.hx, `${label} height hₓ`);
    if (isPresent(level.wpx)) requirePositive(errors, level.wpx, `${label} diaphragm weight wₚₓ`);
  });
}

// Opening geometry that cannot be built. Pier widths and h/b are design checks shown in the results.
function validateWallOpenings(errors, wall, wallLabel, level) {
  const openings = Array.isArray(wall.openings) ? wall.openings : [];
  if (!openings.length) return;
  const length = asNumber(wall.length);
  const height = level ? asNumber(level.floorToFloor) : NaN;
  if (wall.method === 'ftao' && openings.length > 3) errors.push(`${wallLabel}: FTAO covers 1–3 openings.`);
  const sorted = [...openings].sort((a, b) => asNumber(a.offset) - asNumber(b.offset));
  sorted.forEach((o, i) => {
    const label = `${wallLabel} opening ${i + 1}`;
    const offset = asNumber(o.offset), width = asNumber(o.width), sill = asNumber(o.sill), head = asNumber(o.head);
    if (!(width > 0)) errors.push(`${label} needs a width.`);
    if (!(offset >= 0) || (Number.isFinite(length) && offset + width > length + 0.01)) errors.push(`${label} must be inside the wall.`);
    if (!(sill > 0)) errors.push(`${label} needs a sill height above the floor (split the wall for a door).`);
    if (!(head > sill)) errors.push(`${label} head must be above its sill.`);
    if (Number.isFinite(height) && height > 0 && !(head < height)) errors.push(`${label} head must be below the floor-to-floor height.`);
    const prev = sorted[i - 1];
    if (prev && offset < asNumber(prev.offset) + asNumber(prev.width) - 0.01) errors.push(`${label} overlaps opening ${i}.`);
  });
}

function validateShearWall(inputs, errors) {
  const loadType = inputs.loadType || 'seismic';
  if (loadType === 'seismic' || loadType === 'both') requirePositive(errors, inputs.sds, 'Sᴅₛ');

  const levels = Array.isArray(inputs.levels) ? inputs.levels : [];
  if (levels.length === 0) errors.push('Add at least one shear-wall level.');
  const levelIds = new Set();
  levels.forEach((level, index) => {
    const label = level.name?.trim() || `Level ${index + 1}`;
    if (!level.name?.trim()) errors.push(`Level ${index + 1} needs a name.`);
    requirePositive(errors, level.floorToFloor, `${label} floor-to-floor height`);
    levelIds.add(level.id);
  });

  const directions = Array.isArray(inputs.directions) ? inputs.directions : [];
  if (directions.length === 0) errors.push('Add at least one design direction.');
  directions.forEach((direction, directionIndex) => {
    const directionLabel = direction.name?.trim() || `Direction ${directionIndex + 1}`;
    const lines = Array.isArray(direction.lines) ? direction.lines : [];
    if (lines.length === 0) errors.push(`${directionLabel} needs at least one wall line.`);
    lines.forEach((line, lineIndex) => {
      const lineLabel = line.name?.trim() || `${directionLabel} line ${lineIndex + 1}`;
      requirePositive(errors, line.totalLength, `${lineLabel} total length`);
      const lineLength = asNumber(line.totalLength);
      const walls = Array.isArray(line.walls) ? line.walls : [];
      if (walls.length === 0) errors.push(`${lineLabel} needs at least one wall segment.`);
      walls.forEach((wall, wallIndex) => {
        const wallLabel = wall.mark?.trim() || `${lineLabel} wall ${wallIndex + 1}`;
        requirePositive(errors, wall.length, `${wallLabel} length`);
        requirePositive(errors, wall.position, `${wallLabel} position`, { allowZero: true });
        if (!levelIds.has(wall.levelId)) errors.push(`${wallLabel} must reference an existing level.`);
        const end = asNumber(wall.position) + asNumber(wall.length);
        if (Number.isFinite(lineLength) && Number.isFinite(end) && end > lineLength) {
          errors.push(`${wallLabel} extends beyond ${lineLabel}.`);
        }
        validateWallOpenings(errors, wall, wallLabel, levels.find(l => l.id === wall.levelId));
      });
    });
  });
}

export function validateEngineeringInputs(moduleId, inputs = {}) {
  const errors = [];
  const validators = {
    flat_load_calculator: validateFlatLoad,
    seismic_mass_takeoff: validateMassTakeoff,
    seismic_base_shear: validateBaseShear,
    elf_diaphragm_collector: validateElf,
    shear_wall_design: validateShearWall,
  };
  const validator = validators[moduleId];
  if (validator) validator(inputs, errors);
  return [...new Set(errors)];
}
