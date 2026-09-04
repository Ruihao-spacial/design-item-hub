// Material catalogs for the Flat Load Calculator.
// Roof/Ceiling/Floor/Deck ported from the firm's dead_load_generator.html reference tool.
// Ext Wall / Int Wall built from "Dead Loading Wall Int.xlsx" (richer wall material library).
//
// Each material: { name, psf, kind: 'flat' | 'perInch', defaultThick?, group? }
//   flat     -> psf is used as-is (× quantity)
//   perInch  -> psf is psf-per-inch; multiplied by the layer's thickness (× quantity)
// Each layer: { key, label, sub?, loadCategory: 'framing' | 'superimposed', materials }

const NONE = { name: '— None —', psf: 0, kind: 'flat' };

// ── Shared wall framing catalog (used by both Ext Wall and Int Wall) ──
// Values and formulas transcribed from Dead Loading Wall Int.xlsx.
const WALL_FRAMING_MATERIALS = [
  NONE,
  { name: '2x4 wood studs @ 12 in', psf: 1.40, kind: 'flat', group: 'Wood Studs' },
  { name: '2x4 wood studs @ 16 in', psf: 1.05, kind: 'flat', group: 'Wood Studs' },
  { name: '2x4 wood studs @ 24 in', psf: 0.70, kind: 'flat', group: 'Wood Studs' },
  { name: '2x6 wood studs @ 12 in', psf: 2.20, kind: 'flat', group: 'Wood Studs' },
  { name: '2x6 wood studs @ 16 in', psf: 1.65, kind: 'flat', group: 'Wood Studs' },
  { name: '2x6 wood studs @ 24 in', psf: 1.10, kind: 'flat', group: 'Wood Studs' },
  { name: '2x8 wood studs @ 16 in', psf: 2.18, kind: 'flat', group: 'Wood Studs' },
  { name: '2x8 wood studs @ 24 in', psf: 1.45, kind: 'flat', group: 'Wood Studs' },
  { name: '2x4 studs @ 16 in, double (staggered/chase wall)', psf: 2.10, kind: 'flat', group: 'Wood Studs' },
  { name: '3x4 wood studs @ 16 in', psf: 1.73, kind: 'flat', group: 'Wood Studs' },
  { name: '3x6 wood studs @ 16 in', psf: 2.72, kind: 'flat', group: 'Wood Studs' },
  { name: '4x4 posts @ 48 in', psf: 0.81, kind: 'flat', group: 'Wood Studs' },
  { name: '4x6 posts @ 48 in', psf: 1.27, kind: 'flat', group: 'Wood Studs' },
  { name: '362S162-33 (20ga) CFS @ 16 in', psf: 0.70, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '362S162-33 (20ga) CFS @ 24 in', psf: 0.47, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '362S162-43 (18ga) CFS @ 16 in', psf: 0.91, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '362S162-43 (18ga) CFS @ 24 in', psf: 0.61, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '362S162-54 (16ga) CFS @ 16 in', psf: 1.14, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '362S162-68 (14ga) CFS @ 16 in', psf: 1.43, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '600S162-33 (20ga) CFS @ 16 in', psf: 0.91, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '600S162-43 (18ga) CFS @ 16 in', psf: 1.18, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '600S162-43 (18ga) CFS @ 24 in', psf: 0.79, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '600S162-54 (16ga) CFS @ 16 in', psf: 1.49, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '600S162-68 (14ga) CFS @ 16 in', psf: 1.87, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '600S162-97 (12ga) CFS @ 16 in', psf: 2.66, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '800S162-54 (16ga) CFS @ 16 in', psf: 1.77, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '800S162-68 (14ga) CFS @ 16 in', psf: 2.23, kind: 'flat', group: 'Cold-Formed Steel' },
  { name: '6" concrete wall, normal weight', psf: 75.00, kind: 'flat', group: 'Concrete' },
  { name: '8" concrete wall, normal weight', psf: 100.00, kind: 'flat', group: 'Concrete' },
  { name: '10" concrete wall, normal weight', psf: 125.00, kind: 'flat', group: 'Concrete' },
  { name: '12" concrete wall, normal weight', psf: 150.00, kind: 'flat', group: 'Concrete' },
  { name: '14" concrete wall, normal weight', psf: 175.00, kind: 'flat', group: 'Concrete' },
  { name: '16" concrete wall, normal weight', psf: 200.00, kind: 'flat', group: 'Concrete' },
  { name: '8" concrete wall, lightweight', psf: 73.33, kind: 'flat', group: 'Concrete' },
  { name: '12" concrete wall, lightweight', psf: 110.00, kind: 'flat', group: 'Concrete' },
  { name: 'ICF wall, 6" core + 5" EPS', psf: 79.00, kind: 'flat', group: 'Concrete' },
  { name: 'Tilt-up panel, 7-1/4"', psf: 90.63, kind: 'flat', group: 'Concrete' },
  { name: '6" CMU, normal wt, ungrouted', psf: 37.13, kind: 'flat', group: 'CMU' },
  { name: '6" CMU, normal wt, grout @ 32 in', psf: 43.91, kind: 'flat', group: 'CMU' },
  { name: '6" CMU, normal wt, grout @ 16 in', psf: 50.69, kind: 'flat', group: 'CMU' },
  { name: '6" CMU, normal wt, solid grouted', psf: 64.25, kind: 'flat', group: 'CMU' },
  { name: '6" CMU, light wt, ungrouted', psf: 28.88, kind: 'flat', group: 'CMU' },
  { name: '6" CMU, light wt, solid grouted', psf: 56.00, kind: 'flat', group: 'CMU' },
  { name: '8" CMU, normal wt, ungrouted', psf: 48.38, kind: 'flat', group: 'CMU' },
  { name: '8" CMU, normal wt, grout @ 48 in', psf: 54.84, kind: 'flat', group: 'CMU' },
  { name: '8" CMU, normal wt, grout @ 32 in', psf: 58.07, kind: 'flat', group: 'CMU' },
  { name: '8" CMU, normal wt, grout @ 24 in', psf: 61.31, kind: 'flat', group: 'CMU' },
  { name: '8" CMU, normal wt, grout @ 16 in', psf: 67.77, kind: 'flat', group: 'CMU' },
  { name: '8" CMU, normal wt, solid grouted', psf: 87.17, kind: 'flat', group: 'CMU' },
  { name: '8" CMU, medium wt, ungrouted', psf: 41.21, kind: 'flat', group: 'CMU' },
  { name: '8" CMU, medium wt, solid grouted', psf: 80.00, kind: 'flat', group: 'CMU' },
  { name: '8" CMU, light wt, ungrouted', psf: 37.63, kind: 'flat', group: 'CMU' },
  { name: '8" CMU, light wt, grout @ 32 in', psf: 47.32, kind: 'flat', group: 'CMU' },
  { name: '8" CMU, light wt, grout @ 16 in', psf: 57.02, kind: 'flat', group: 'CMU' },
  { name: '8" CMU, light wt, solid grouted', psf: 76.42, kind: 'flat', group: 'CMU' },
  { name: '10" CMU, normal wt, ungrouted', psf: 59.63, kind: 'flat', group: 'CMU' },
  { name: '10" CMU, normal wt, grout @ 32 in', psf: 72.24, kind: 'flat', group: 'CMU' },
  { name: '10" CMU, normal wt, solid grouted', psf: 110.08, kind: 'flat', group: 'CMU' },
  { name: '12" CMU, normal wt, ungrouted', psf: 68.63, kind: 'flat', group: 'CMU' },
  { name: '12" CMU, normal wt, grout @ 48 in', psf: 79.37, kind: 'flat', group: 'CMU' },
  { name: '12" CMU, normal wt, grout @ 32 in', psf: 84.74, kind: 'flat', group: 'CMU' },
  { name: '12" CMU, normal wt, grout @ 16 in', psf: 100.85, kind: 'flat', group: 'CMU' },
  { name: '12" CMU, normal wt, solid grouted', psf: 133.08, kind: 'flat', group: 'CMU' },
  { name: '12" CMU, light wt, solid grouted', psf: 117.83, kind: 'flat', group: 'CMU' },
  { name: '4" clay brick wythe (incl. mortar)', psf: 39.00, kind: 'flat', group: 'Clay Masonry' },
  { name: '8" clay brick wall', psf: 79.00, kind: 'flat', group: 'Clay Masonry' },
  { name: '12" clay brick wall', psf: 115.00, kind: 'flat', group: 'Clay Masonry' },
  { name: '4" structural clay tile', psf: 25.00, kind: 'flat', group: 'Clay Masonry' },
  { name: '4" hollow clay tile', psf: 18.00, kind: 'flat', group: 'Clay Masonry' },
  { name: '4" brick + 4" CMU backup', psf: 74.00, kind: 'flat', group: 'Clay Masonry' },
  { name: '4" glass block', psf: 20.00, kind: 'flat', group: 'Clay Masonry' },
];

const WALL_FRAMING_EXTRAS = [
  NONE,
  { name: 'Plates, blocking & headers allowance (wood)', psf: 0.70, kind: 'flat' },
  { name: 'CFS track, bridging & clips allowance', psf: 0.30, kind: 'flat' },
];

const WALL_INTERIOR_FINISH = [
  NONE,
  { name: '1/2" gypsum board', psf: 2.20, kind: 'flat' },
  { name: '5/8" gypsum board', psf: 2.80, kind: 'flat' },
  { name: '5/8" gypsum board, type X', psf: 2.80, kind: 'flat' },
  { name: 'Two layers 5/8" gypsum board', psf: 5.60, kind: 'flat' },
  { name: 'Two layers 1/2" gypsum board', psf: 4.40, kind: 'flat' },
  { name: '5/8" gyp bd on 7/8" hat channel furring', psf: 3.20, kind: 'flat' },
  { name: '5/8" gyp bd on resilient channel', psf: 3.10, kind: 'flat' },
  { name: '1/2" abuse-resistant gypsum board', psf: 2.50, kind: 'flat' },
  { name: 'Gypsum veneer plaster on 1/2" base', psf: 3.00, kind: 'flat' },
  { name: 'Plaster on wood lath', psf: 8.00, kind: 'flat' },
  { name: 'Plaster on metal lath (3/4")', psf: 8.00, kind: 'flat' },
  { name: '1/2" cement board (Durock type)', psf: 3.00, kind: 'flat' },
  { name: '1/2" fiber-cement backer (HardieBacker type)', psf: 2.40, kind: 'flat' },
  { name: '5/8" exterior grade cement board', psf: 3.60, kind: 'flat' },
  { name: 'Ceramic tile 1/4", thinset', psf: 3.50, kind: 'flat' },
  { name: 'Ceramic tile 3/8", thinset on 1/2" cem bd', psf: 7.70, kind: 'flat' },
  { name: 'Ceramic/quarry tile 3/4" on 1/2" mortar bed', psf: 16.00, kind: 'flat' },
  { name: 'Ceramic/quarry tile 3/4" on 1" mortar bed', psf: 23.00, kind: 'flat' },
  { name: 'Porcelain tile 3/8", thinset', psf: 4.60, kind: 'flat' },
  { name: 'Glass mosaic tile 1/4", thinset', psf: 3.30, kind: 'flat' },
  { name: 'Stone tile 3/8" (marble/granite), thinset', psf: 5.30, kind: 'flat' },
  { name: 'Stone tile 3/4" on 1/2" mortar bed', psf: 16.60, kind: 'flat' },
  { name: 'Stone slab 1-1/4" (marble/granite)', psf: 17.70, kind: 'flat' },
  { name: 'Slate tile 1/2"', psf: 7.30, kind: 'flat' },
  { name: 'Terrazzo 1-1/2"', psf: 18.80, kind: 'flat' },
  { name: 'Mortar bed, per inch', psf: 12.00, kind: 'perInch', defaultThick: 1 },
  { name: 'Wood paneling 3/4"', psf: 2.50, kind: 'flat' },
  { name: 'Wood paneling/veneer 1/4"', psf: 0.80, kind: 'flat' },
  { name: 'Wood wainscot + trim', psf: 2.50, kind: 'flat' },
  { name: 'Tongue & groove 1x wood boards', psf: 2.50, kind: 'flat' },
  { name: 'Acoustic wall panel (fabric-wrapped)', psf: 1.00, kind: 'flat' },
  { name: 'FRP wall panel', psf: 0.80, kind: 'flat' },
  { name: 'Stainless/metal wall panel (interior)', psf: 1.50, kind: 'flat' },
  { name: 'Mirror, 1/4" glass', psf: 3.30, kind: 'flat' },
  { name: 'Vinyl wall covering/paint', psf: 0.10, kind: 'flat' },
];

const WALL_CONTINUOUS_INSULATION = [
  NONE,
  { name: 'Mineral wool board (cont.), per inch', psf: 0.33, kind: 'perInch', defaultThick: 2 },
  { name: 'XPS rigid (cont.), per inch', psf: 0.15, kind: 'perInch', defaultThick: 2 },
  { name: 'Polyiso rigid (cont.), per inch', psf: 0.17, kind: 'perInch', defaultThick: 2 },
  { name: 'EPS rigid (cont.), per inch', psf: 0.08, kind: 'perInch', defaultThick: 2 },
];

const WALL_CAVITY_INSULATION = [
  NONE,
  { name: 'Fiberglass batt R-13, 3-1/2"', psf: 0.53, kind: 'flat' },
  { name: 'Fiberglass batt R-15, 3-1/2"', psf: 0.70, kind: 'flat' },
  { name: 'Fiberglass batt R-19, 6-1/4"', psf: 0.94, kind: 'flat' },
  { name: 'Fiberglass batt R-21, 5-1/2"', psf: 1.10, kind: 'flat' },
  { name: 'Fiberglass batt R-30, 9-1/2"', psf: 1.43, kind: 'flat' },
  { name: 'Mineral wool batt, 3-1/2"', psf: 0.73, kind: 'flat' },
  { name: 'Mineral wool batt, 5-1/2"', psf: 1.15, kind: 'flat' },
  { name: 'Closed-cell spray foam, per inch', psf: 0.17, kind: 'perInch', defaultThick: 3.5 },
  { name: 'Open-cell spray foam, per inch', psf: 0.04, kind: 'perInch', defaultThick: 3.5 },
  { name: 'Dense-pack cellulose, per inch', psf: 0.29, kind: 'perInch', defaultThick: 5.5 },
];

const WALL_SHEATHING = [
  NONE,
  { name: '3/8" plywood', psf: 1.10, kind: 'flat' },
  { name: '1/2" plywood', psf: 1.50, kind: 'flat' },
  { name: '5/8" plywood', psf: 1.80, kind: 'flat' },
  { name: '3/4" plywood', psf: 2.30, kind: 'flat' },
  { name: '1-1/8" plywood', psf: 3.40, kind: 'flat' },
  { name: '7/16" OSB', psf: 1.40, kind: 'flat' },
  { name: '15/32" OSB', psf: 1.50, kind: 'flat' },
  { name: '7/16" integrated WRB panel (ZIP type)', psf: 1.50, kind: 'flat' },
  { name: '1x diagonal board sheathing', psf: 2.30, kind: 'flat' },
  { name: '1/2" exterior gypsum sheathing', psf: 2.00, kind: 'flat' },
  { name: '5/8" exterior gypsum sheathing', psf: 2.50, kind: 'flat' },
  { name: '1/2" glass-mat sheathing (DensGlass type)', psf: 2.10, kind: 'flat' },
  { name: '26 ga metal sheathing/strap bracing', psf: 0.80, kind: 'flat' },
  { name: 'Sheathing, both faces (2x 1/2" ply)', psf: 3.00, kind: 'flat' },
];

const WALL_WEATHER_BARRIER = [
  NONE,
  { name: 'Building paper/housewrap', psf: 0.10, kind: 'flat' },
  { name: 'Two-layer grade D building paper', psf: 0.20, kind: 'flat' },
  { name: 'Fluid-applied air & water barrier', psf: 0.20, kind: 'flat' },
  { name: 'Self-adhered sheet membrane', psf: 0.40, kind: 'flat' },
  { name: '1x wood rainscreen furring @ 16 in', psf: 0.60, kind: 'flat' },
  { name: '3/4" drainage mat', psf: 0.20, kind: 'flat' },
  { name: 'Hat channel/Z-girt subframing', psf: 0.60, kind: 'flat' },
  { name: 'Thermally-broken clip & rail system', psf: 1.50, kind: 'flat' },
  { name: 'Metal lath + paper (for stucco/veneer)', psf: 0.60, kind: 'flat' },
  { name: 'Brick veneer ties & air space', psf: 0.30, kind: 'flat' },
];

const WALL_EXTERIOR_FINISH = [
  NONE,
  { name: '3-coat stucco 7/8" (incl. lath)', psf: 10.00, kind: 'flat' },
  { name: '3-coat stucco 1/2" (incl. lath)', psf: 6.00, kind: 'flat' },
  { name: '3-coat stucco 3/4" (incl. lath)', psf: 8.50, kind: 'flat' },
  { name: '3-coat stucco 1" (incl. lath)', psf: 11.00, kind: 'flat' },
  { name: '3-coat stucco 1-1/4" (incl. lath)', psf: 13.50, kind: 'flat' },
  { name: 'One-coat stucco 3/8" over foam', psf: 5.00, kind: 'flat' },
  { name: 'EIFS (synthetic stucco on EPS)', psf: 3.00, kind: 'flat' },
  { name: 'Interior cement plaster (3/4")', psf: 8.00, kind: 'flat' },
  { name: 'Fiber-cement lap siding 5/16" (Hardie type)', psf: 2.30, kind: 'flat' },
  { name: 'Fiber-cement panel 5/16"', psf: 2.50, kind: 'flat' },
  { name: 'Fiber-cement panel 1/2"', psf: 3.60, kind: 'flat' },
  { name: 'Fiber-cement board & batten 5/16"', psf: 2.60, kind: 'flat' },
  { name: 'Wood lap/bevel siding 3/4"', psf: 2.20, kind: 'flat' },
  { name: 'Wood shingle/shake siding', psf: 2.50, kind: 'flat' },
  { name: 'Wood board & batten 1x', psf: 2.50, kind: 'flat' },
  { name: 'T1-11 plywood siding 5/8"', psf: 1.80, kind: 'flat' },
  { name: 'Composite/engineered wood siding', psf: 1.80, kind: 'flat' },
  { name: 'Vinyl siding', psf: 0.50, kind: 'flat' },
  { name: 'Aluminum siding', psf: 0.50, kind: 'flat' },
  { name: '26 ga corrugated metal panel', psf: 1.20, kind: 'flat' },
  { name: '24 ga standing seam metal panel', psf: 1.60, kind: 'flat' },
  { name: '22 ga metal wall panel', psf: 2.00, kind: 'flat' },
  { name: 'Insulated metal panel (IMP) 2"', psf: 3.00, kind: 'flat' },
  { name: 'ACM/composite metal panel', psf: 2.00, kind: 'flat' },
  { name: '4" clay brick veneer (incl. mortar)', psf: 39.00, kind: 'flat' },
  { name: 'Thin brick veneer 1/2" (adhered)', psf: 10.00, kind: 'flat' },
  { name: 'Adhered manufactured stone veneer (incl. mortar)', psf: 15.00, kind: 'flat' },
  { name: 'Adhered natural thin stone veneer 1-1/4"', psf: 20.00, kind: 'flat' },
  { name: 'Anchored natural stone veneer 4"', psf: 55.00, kind: 'flat' },
  { name: 'Stone panel 2" on rail system', psf: 30.00, kind: 'flat' },
  { name: 'Exterior porcelain tile 3/8" on mortar', psf: 9.00, kind: 'flat' },
  { name: 'Terracotta rainscreen panel', psf: 12.00, kind: 'flat' },
  { name: 'Precast concrete panel 2"', psf: 25.00, kind: 'flat' },
  { name: 'GFRC panel 3/4" + frame', psf: 9.00, kind: 'flat' },
  { name: 'Glass curtain wall/storefront', psf: 12.00, kind: 'flat' },
  { name: 'Window/glazing (typical unit)', psf: 8.00, kind: 'flat' },
];

const WALL_MEP_ALLOWANCES = [
  { name: 'Electrical — conduit, boxes, wiring', psf: 0.50 },
  { name: 'Plumbing — supply & waste in wall', psf: 1.00 },
  { name: 'Plumbing — wet wall/stack (heavy)', psf: 3.00 },
  { name: 'Mechanical — ductwork in wall chase', psf: 0.50 },
  { name: 'Fire sprinkler piping', psf: 0.50 },
  { name: 'Blocking/backing for fixtures & cabinets', psf: 0.50 },
  { name: 'Wall-hung cabinets & countertops allowance', psf: 3.00 },
  { name: 'Wall-hung equipment allowance', psf: 2.00 },
  { name: 'MEP combined allowance (typical)', psf: 2.00 },
  { name: 'Miscellaneous', psf: 1.00 },
];

// ── Roof / Ceiling / Floor / Deck — ported from dead_load_generator.html ──

const ROOF = {
  label: 'Roof', short: 'R', defaultName: 'Roof',
  hasLiveLoad: true, defaultLL: 20,
  llPresets: [
    { label: 'Ordinary roof, flat/low slope (Lr)', psf: 20 },
    { label: 'Sloped 4:12 to 12:12 (Lr reduced)', psf: 16 },
    { label: 'Steep slope >12:12 (Lr reduced)', psf: 12 },
  ],
  llRef: 'IBC/CBC Table 1607.1 · roof live load Lr (further reductions per ASCE 4.8). Use snow load Sg/Pf if it controls.',
  layers: [
    { key: 'finish', label: 'Roof Finish', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Asphalt/wood shingle — design value (incl. re-roof allow.)', psf: 6, kind: 'flat', group: 'Design values' },
      { name: 'Asphalt shingle — design value (incl. re-roof allow.)', psf: 4, kind: 'flat', group: 'Design values' },
      { name: 'Asphalt shingle (3-tab)', psf: 2, kind: 'flat', group: 'Asphalt/Wood' },
      { name: 'Asphalt shingle (architectural/laminated)', psf: 4, kind: 'flat', group: 'Asphalt/Wood' },
      { name: 'Wood shingles/shakes', psf: 3, kind: 'flat', group: 'Asphalt/Wood' },
      { name: 'Standing seam metal, 24 ga', psf: 1.5, kind: 'flat', group: 'Metal' },
      { name: 'Standing seam metal, 22 ga', psf: 2, kind: 'flat', group: 'Metal' },
      { name: 'Corrugated metal roofing', psf: 1.5, kind: 'flat', group: 'Metal' },
      { name: 'Concrete tile (lightweight)', psf: 6, kind: 'flat', group: 'Tile' },
      { name: 'Concrete tile (standard)', psf: 10, kind: 'flat', group: 'Tile' },
      { name: 'Clay tile — Spanish', psf: 19, kind: 'flat', group: 'Tile' },
      { name: 'Clay tile — Roman', psf: 12, kind: 'flat', group: 'Tile' },
      { name: 'Three-ply built-up', psf: 1, kind: 'flat', group: 'Membrane' },
      { name: 'Four-ply felt & gravel', psf: 5.5, kind: 'flat', group: 'Membrane' },
      { name: 'TPO/EPDM single-ply', psf: 0.7, kind: 'flat', group: 'Membrane' },
      { name: 'Modified bitumen', psf: 1.5, kind: 'flat', group: 'Membrane' },
      { name: 'Vegetated — extensive', psf: 25, kind: 'flat', group: 'Other' },
      { name: 'Vegetated — intensive', psf: 75, kind: 'flat', group: 'Other' },
    ] },
    { key: 'waterproof', label: 'Water Proofing', loadCategory: 'superimposed', materials: [
      NONE,
      { name: '15# felt underlayment', psf: 0.3, kind: 'flat' },
      { name: '30# felt underlayment', psf: 0.5, kind: 'flat' },
      { name: 'Synthetic underlayment', psf: 0.3, kind: 'flat' },
      { name: 'Ice & water shield', psf: 0.4, kind: 'flat' },
      { name: 'Bituminous, gravel-covered', psf: 5.5, kind: 'flat' },
      { name: 'Single-ply sheet membrane', psf: 0.7, kind: 'flat' },
    ] },
    { key: 'rigidInsul', label: 'Roof Insulation', sub: 'Rigid (over deck)', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Polyisocyanurate', psf: 0.2, kind: 'perInch', defaultThick: 2 },
      { name: 'XPS (extruded polystyrene)', psf: 0.2, kind: 'perInch', defaultThick: 2 },
      { name: 'EPS (expanded polystyrene)', psf: 0.1, kind: 'perInch', defaultThick: 2 },
      { name: 'Fiberboard', psf: 1.5, kind: 'perInch', defaultThick: 1 },
      { name: 'Rigid insulation, 1/2" (lump)', psf: 0.75, kind: 'flat' },
    ] },
    { key: 'sheathing', label: 'Roof Sheathing', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Plywood, 3/8"', psf: 1.2, kind: 'flat' },
      { name: 'Plywood, 1/2"', psf: 1.6, kind: 'flat' },
      { name: 'Plywood, 19/32" (5/8")', psf: 2.0, kind: 'flat' },
      { name: 'Plywood, 23/32" (3/4")', psf: 2.4, kind: 'flat' },
      { name: 'OSB, 7/16"', psf: 1.4, kind: 'flat' },
      { name: 'OSB, 15/32" (1/2")', psf: 1.6, kind: 'flat' },
      { name: 'OSB, 19/32" (5/8")', psf: 2.0, kind: 'flat' },
      { name: 'Wood decking, 2" (Doug fir)', psf: 5, kind: 'flat' },
      { name: 'Wood decking, 3" (Doug fir)', psf: 8, kind: 'flat' },
    ] },
    { key: 'framing', label: 'Roof Framing', loadCategory: 'framing', materials: [
      NONE,
      { name: '2x4 rafters @ 16" o.c.', psf: 1.5, kind: 'flat' },
      { name: '2x6 rafters @ 16" o.c.', psf: 2, kind: 'flat' },
      { name: '2x8 rafters @ 16" o.c.', psf: 2.5, kind: 'flat' },
      { name: '2x10 rafters @ 16" o.c.', psf: 3, kind: 'flat' },
      { name: '2x12 rafters @ 16" o.c.', psf: 3.5, kind: 'flat' },
      { name: 'Wood trusses @ 24" o.c.', psf: 3, kind: 'flat' },
      { name: 'TJI 110, 11-7/8" @ 16" o.c.', psf: 1.9, kind: 'flat' },
      { name: 'TJI 210, 11-7/8" @ 16" o.c.', psf: 2.1, kind: 'flat' },
      { name: 'TJI 360, 11-7/8" @ 16" o.c.', psf: 2.3, kind: 'flat' },
      { name: 'TJI 560, 11-7/8" @ 16" o.c.', psf: 3.0, kind: 'flat' },
      { name: 'Glulam beam allowance', psf: 1, kind: 'flat' },
    ] },
    { key: 'cavityInsul', label: 'Insulation', sub: 'Cavity (between framing)', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Fiberglass batt', psf: 0.07, kind: 'perInch', defaultThick: 10 },
      { name: 'Blown cellulose', psf: 0.4, kind: 'perInch', defaultThick: 10 },
      { name: 'Batt R-30 (lump)', psf: 0.5, kind: 'flat' },
      { name: 'Batt R-38 (lump)', psf: 0.7, kind: 'flat' },
    ] },
    { key: 'ceilingBelow', label: 'Ceiling Below / Soffit', loadCategory: 'superimposed', materials: [
      { name: '— None / exposed —', psf: 0, kind: 'flat' },
      { name: '1/2" gypsum board', psf: 2.2, kind: 'flat' },
      { name: '5/8" gypsum board (Type X)', psf: 2.8, kind: 'flat' },
      { name: 'T&G cedar 3/4"', psf: 2.3, kind: 'flat' },
      { name: 'Suspended acoustical tile', psf: 3.5, kind: 'flat' },
    ] },
  ],
  allowances: { label: 'Misc.', items: [
    { name: 'Solar PV array', psf: 4, coverageEligible: true },
    { name: 'Mechanical/HVAC', psf: 0.5 },
    { name: 'Sprinklers', psf: 0.5 },
    { name: 'Recessed lighting', psf: 0.5 },
    { name: 'Miscellaneous', psf: 1 },
  ] },
};

const CEILING = {
  label: 'Ceiling', short: 'C', defaultName: 'Ceiling',
  hasLiveLoad: true, defaultLL: 10,
  llPresets: [
    { label: 'Attic — no storage', psf: 10 },
    { label: 'Attic — limited storage', psf: 20 },
  ],
  llRef: 'IBC/CBC Table 1607.1 · attic live load',
  layers: [
    { key: 'finish', label: 'Ceiling Finish', loadCategory: 'superimposed', materials: [
      NONE,
      { name: '1/2" gypsum board', psf: 2.2, kind: 'flat' },
      { name: '5/8" gypsum board (Type X)', psf: 2.8, kind: 'flat' },
      { name: 'Double layer 5/8" gypsum', psf: 5.6, kind: 'flat' },
      { name: 'Acoustical fiberboard', psf: 1, kind: 'flat' },
      { name: 'Plaster on wood lath', psf: 8, kind: 'flat' },
    ] },
    { key: 'suspended', label: 'Suspended System', loadCategory: 'superimposed', materials: [
      { name: '— None/direct-applied —', psf: 0, kind: 'flat' },
      { name: 'Suspended acoustical tile', psf: 3.5, kind: 'flat' },
      { name: 'Susp. metal lath + gypsum plaster', psf: 10, kind: 'flat' },
      { name: 'Wood furring suspension', psf: 2.5, kind: 'flat' },
    ] },
    { key: 'insulation', label: 'Attic Insulation', sub: 'Above ceiling', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Fiberglass batt', psf: 0.07, kind: 'perInch', defaultThick: 10 },
      { name: 'Blown cellulose', psf: 0.4, kind: 'perInch', defaultThick: 12 },
      { name: 'R-38 batt (lump)', psf: 0.7, kind: 'flat' },
    ] },
    { key: 'framing', label: 'Ceiling Framing', sub: 'If standalone', loadCategory: 'framing', materials: [
      { name: '— None/framed w/ floor —', psf: 0, kind: 'flat' },
      { name: '2x4 joists @ 16" o.c.', psf: 1, kind: 'flat' },
      { name: '2x6 joists @ 16" o.c.', psf: 1.5, kind: 'flat' },
      { name: '2x8 joists @ 16" o.c.', psf: 2, kind: 'flat' },
    ] },
  ],
  allowances: { label: 'Misc.', items: [
    { name: 'Mechanical duct allowance', psf: 4 },
    { name: 'Sprinklers', psf: 0.5 },
    { name: 'Recessed lighting', psf: 0.5 },
    { name: 'Miscellaneous', psf: 1 },
  ] },
};

const FLOOR = {
  label: 'Floor', short: 'F', defaultName: 'Floor',
  hasLiveLoad: true, defaultLL: 40,
  llPresets: [
    { label: 'Residential — general (40 psf)', psf: 40 },
    { label: 'Residential — sleeping (30 psf)', psf: 30 },
    { label: 'Residential — corridors above 1st (100 psf)', psf: 100 },
    { label: 'Garage — passenger vehicles (40 psf)', psf: 40 },
    { label: 'Light storage (125 psf)', psf: 125 },
  ],
  llRef: 'IBC/CBC Table 1607.1 · Group R residential occupancy',
  layers: [
    { key: 'finish', label: 'Floor Finish', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Hardwood, 3/4"', psf: 4, kind: 'flat' },
      { name: 'Engineered wood, 1/2"', psf: 2.5, kind: 'flat' },
      { name: 'LVT/LVP', psf: 1.5, kind: 'flat' },
      { name: 'Carpet & pad', psf: 1, kind: 'flat' },
      { name: 'Ceramic tile 3/4" + 1/2" mortar', psf: 16, kind: 'flat' },
      { name: 'Marble + mortar on slab', psf: 33, kind: 'flat' },
    ] },
    { key: 'topping', label: 'Floor Topping', sub: 'Concrete/gyp-crete', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Gypcrete (sound)', psf: 8.7, kind: 'perInch', defaultThick: 1.5 },
      { name: 'Lightweight concrete', psf: 8, kind: 'perInch', defaultThick: 1.5 },
      { name: 'Stone concrete', psf: 12, kind: 'perInch', defaultThick: 2 },
    ] },
    { key: 'subfloor', label: 'Subfloor', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Plywood 23/32" (3/4")', psf: 2.4, kind: 'flat' },
      { name: 'OSB 23/32" (3/4")', psf: 2.4, kind: 'flat' },
    ] },
    { key: 'framing', label: 'Floor Framing', sub: 'Joists only', loadCategory: 'framing', materials: [
      NONE,
      { name: '2x6 joists @ 16" o.c.', psf: 1.5, kind: 'flat' },
      { name: '2x8 joists @ 16" o.c.', psf: 2, kind: 'flat' },
      { name: '2x10 joists @ 16" o.c.', psf: 2.5, kind: 'flat' },
      { name: '2x12 joists @ 16" o.c.', psf: 3, kind: 'flat' },
      { name: 'TJI 210, 11-7/8" @ 16" o.c.', psf: 2.1, kind: 'flat' },
      { name: 'TJI 360, 11-7/8" @ 16" o.c.', psf: 2.3, kind: 'flat' },
      { name: 'Open-web wood truss', psf: 3, kind: 'flat' },
    ] },
    { key: 'cavityInsul', label: 'Insulation', sub: 'Cavity (if applicable)', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Fiberglass batt', psf: 0.07, kind: 'perInch', defaultThick: 6 },
      { name: 'R-19 batt (lump)', psf: 0.4, kind: 'flat' },
    ] },
    { key: 'ceilingBelow', label: 'Ceiling Below', loadCategory: 'superimposed', materials: [
      { name: '— None/exposed —', psf: 0, kind: 'flat' },
      { name: '1/2" gypsum board', psf: 2.2, kind: 'flat' },
      { name: '5/8" gypsum board', psf: 2.8, kind: 'flat' },
    ] },
    { key: 'partition', label: 'Partition Allow.', sub: 'Per ASCE 4.3.2', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Light residential (8 psf)', psf: 8, kind: 'flat' },
      { name: 'Standard ASCE (15 psf)', psf: 15, kind: 'flat' },
      { name: 'Heavy residential (20 psf)', psf: 20, kind: 'flat' },
    ] },
  ],
  allowances: { label: 'Misc.', items: [
    { name: 'Mechanical/plumbing', psf: 1 },
    { name: 'Sprinklers', psf: 0.5 },
    { name: 'Radiant heat (in-floor)', psf: 1 },
    { name: 'Miscellaneous', psf: 1 },
  ] },
};

const DECK = {
  label: 'Deck/Balcony', short: 'D', defaultName: 'Deck',
  hasLiveLoad: true, defaultLL: 60,
  llPresets: [
    { label: 'Balcony — general (60 psf)', psf: 60 },
    { label: 'Balcony — ≤100 sf, single dwelling (40 psf)', psf: 40 },
    { label: 'Deck — residential exterior (40 psf)', psf: 40 },
  ],
  llRef: 'IBC/CBC Table 1607.1 · 1.5× occupancy of attached, max 100 psf',
  layers: [
    { key: 'surface', label: 'Deck Surface', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Wood decking 5/4" (1" nom.)', psf: 3, kind: 'flat' },
      { name: 'Wood decking 2x (1-1/2" act.)', psf: 4, kind: 'flat' },
      { name: 'Composite decking 1"', psf: 3, kind: 'flat' },
      { name: 'Concrete pavers 2" on pedestals', psf: 25, kind: 'flat' },
    ] },
    { key: 'waterproof', label: 'Water Proofing', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Vinyl deck coating + ply mat', psf: 0.5, kind: 'flat' },
      { name: 'Single-ply sheet membrane', psf: 0.7, kind: 'flat' },
      { name: 'Hot-applied rubberized asphalt', psf: 2, kind: 'flat' },
    ] },
    { key: 'sheathing', label: 'Substrate', sub: 'Plywood', loadCategory: 'superimposed', materials: [
      NONE,
      { name: 'Plywood 1/2"', psf: 1.6, kind: 'flat' },
      { name: 'Plywood 3/4"', psf: 2.4, kind: 'flat' },
    ] },
    { key: 'framing', label: 'Deck Framing', loadCategory: 'framing', materials: [
      NONE,
      { name: '2x6 joists @ 16" o.c.', psf: 2, kind: 'flat' },
      { name: '2x8 joists @ 16" o.c.', psf: 2.5, kind: 'flat' },
      { name: '2x10 joists @ 16" o.c.', psf: 3, kind: 'flat' },
      { name: 'PT 2x10 joists @ 16" o.c.', psf: 3.2, kind: 'flat' },
    ] },
    { key: 'soffit', label: 'Soffit/Underside', loadCategory: 'superimposed', materials: [
      { name: '— None/exposed —', psf: 0, kind: 'flat' },
      { name: 'T&G cedar 3/4"', psf: 2.3, kind: 'flat' },
      { name: '5/8" exterior gypsum', psf: 2.8, kind: 'flat' },
    ] },
  ],
  allowances: { label: 'Misc.', items: [
    { name: 'Railing/guardrail', psf: 1 },
    { name: 'Planters allowance', psf: 5 },
    { name: 'Miscellaneous', psf: 1 },
  ] },
};

const EXT_WALL = {
  label: 'Exterior Wall', short: 'EW', defaultName: 'Ext. Wall',
  hasLiveLoad: false,
  note: 'Reported as psf of wall surface area. Multiply by wall height for plf at base.',
  layers: [
    { key: 'exteriorFinish', label: 'Exterior Finish', loadCategory: 'superimposed', materials: WALL_EXTERIOR_FINISH },
    { key: 'weatherBarrier', label: 'WRB/Air Barrier', loadCategory: 'superimposed', materials: WALL_WEATHER_BARRIER },
    { key: 'contInsul', label: 'Continuous Insul.', sub: 'Exterior, over sheathing', loadCategory: 'superimposed', materials: WALL_CONTINUOUS_INSULATION },
    { key: 'sheathing', label: 'Wall Sheathing', loadCategory: 'superimposed', materials: WALL_SHEATHING },
    { key: 'framing', label: 'Wall Framing', loadCategory: 'framing', materials: WALL_FRAMING_MATERIALS },
    { key: 'framingExtras', label: 'Framing Extras', sub: 'Plates/track allowance', loadCategory: 'framing', materials: WALL_FRAMING_EXTRAS },
    { key: 'cavityInsul', label: 'Cavity Insulation', loadCategory: 'superimposed', materials: WALL_CAVITY_INSULATION },
    { key: 'interiorFinish', label: 'Interior Finish', loadCategory: 'superimposed', materials: WALL_INTERIOR_FINISH },
  ],
  allowances: { label: 'MEP/Misc.', items: WALL_MEP_ALLOWANCES },
};

const INT_WALL = {
  label: 'Interior Wall', short: 'IW', defaultName: 'Int. Wall',
  hasLiveLoad: false,
  note: 'Reported as psf of wall surface. For floor design, partitions are often modeled as a floor LL allowance instead (see Floor tab).',
  layers: [
    { key: 'finishA', label: 'Finish Side A', loadCategory: 'superimposed', materials: WALL_INTERIOR_FINISH },
    { key: 'framing', label: 'Wall Framing', loadCategory: 'framing', materials: WALL_FRAMING_MATERIALS },
    { key: 'framingExtras', label: 'Framing Extras', sub: 'Plates/track allowance', loadCategory: 'framing', materials: WALL_FRAMING_EXTRAS },
    { key: 'cavityInsul', label: 'Cavity Insulation', sub: 'Sound/thermal', loadCategory: 'superimposed', materials: WALL_CAVITY_INSULATION },
    { key: 'finishB', label: 'Finish Side B', loadCategory: 'superimposed', materials: WALL_INTERIOR_FINISH },
  ],
  allowances: { label: 'MEP/Misc.', items: WALL_MEP_ALLOWANCES },
};

export const ASSEMBLY_TYPES = {
  roof: ROOF,
  ceiling: CEILING,
  floor: FLOOR,
  deck: DECK,
  extWall: EXT_WALL,
  intWall: INT_WALL,
};

export function computeMaterialPsf(material, layerState) {
  if (!material) return 0;
  const quantity = layerState && layerState.quantity != null ? layerState.quantity : 1;
  if (material.kind === 'perInch') {
    const t = layerState && layerState.thickness != null ? layerState.thickness : (material.defaultThick || 1);
    return material.psf * t * quantity;
  }
  return material.psf * quantity;
}
