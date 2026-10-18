// Parametric product templates for the rule-based demo engine. Each template's plan()
// derives dimensions, cut lists, quantities and step-specific measurements from the
// user's actual inventory (and marks every assumption it has to make).
import { packCuts, KERF_MM } from './cutlist.js';
import { roundTo } from './units.js';

const step = (s) => ({
  components: [],
  tools: [],
  measurements: [],
  orientation: '',
  connections: '',
  alignmentCheck: '',
  commonMistakes: [],
  ...s,
});

const cuboid = (x, y, z, sx, sy, sz) => ({ x, y, z, sx, sy, sz });

/** Sanding/finishing steps shared by the wood products. */
const sandStep = (ids, grit = '120 then 180') =>
  step({
    title: 'Sand all faces and break the edges',
    objective: 'Remove saw marks and splinters so the product is safe to handle and takes finish evenly.',
    components: ids,
    tools: ['Sandpaper or sander', 'Dust mask'],
    measurements: [`Grit sequence: ${grit}`, 'Edge round-over: ~1 mm'],
    instructions: `Sand every face with the grain, starting at ${grit.split(' ')[0]} grit and finishing at ${grit.split(' ').pop()} grit. Lightly round every sharp edge with a folded sheet of the finer grit. Wipe off dust with a dry cloth before moving on.`,
    orientation: 'Work on a flat bench, show face up, then flip.',
    connections: 'None — preparation only.',
    alignmentCheck: 'Run your palm across every edge: no splinters or sharp arrises.',
    commonMistakes: ['Sanding across the grain (leaves scratches visible under finish)', 'Rounding the faces that will be glued — keep joint faces flat'],
  });

/* ------------------------------------------------------------------ */
/* 1b. Bracket-free shelf: timber back rail + two gussets, all cut     */
/*     from the user's own boards (adaptation when brackets are absent) */
/* ------------------------------------------------------------------ */
function gussetShelfPlan(ctx) {
  const board = ctx.stock('wood_board', { length: 1200, width: 150, thickness: 18 });
  const T = board.dims.thickness;
  const D = board.dims.width;
  const L = Math.min(board.dims.length - 20, 800);
  const shelfLen = roundTo(Math.max(300, L >= 600 ? 600 : L), 5);
  const railH = Math.min(90, D);
  const gW = Math.max(60, D - 20); // gusset leg along the shelf depth
  const inset = roundTo(shelfLen * 0.15, 5);
  const cuts = packCuts(
    [
      { id: 'shelf', name: 'Shelf board', length: shelfLen, width: D, qty: 1 },
      { id: 'rail', name: 'Back rail', length: shelfLen, width: railH, qty: 1 },
      { id: 'gusset', name: 'Gusset blank (cut diagonally)', length: gW, width: railH, qty: 1 },
    ],
    board.dims
  );
  const minScrew = T + 25;
  const req = (key) => wallShelf.requires.find((r) => r.key === key);
  const requirements = [
    req('wood_board'),
    { ...req('screws'), perUnit: 12, why: 'Join the shelf, rail and gussets', adaptation: `Use screws at least ${minScrew} mm long for the shelf-to-rail joint (through ${T} mm + 25 mm bite).` },
    { ...req('wall_plugs'), perUnit: 3 },
    req('finish'),
  ];
  return {
    requirements,
    adaptedFrom: 'Bracket-mounted shelf',
    adaptationNote: 'You have no brackets in your inventory, so this design uses a timber back rail and two gussets cut from your own boards instead of buying brackets.',
    summary: `A ${shelfLen} × ${D} × ${T} mm shelf on a ${railH} mm back rail with two triangular gussets — everything cut from your boards (${cuts.boardsNeeded} board(s) per unit). Rated for light loads (≈5 kg).`,
    overall: { length: shelfLen, width: D, height: railH + T, unit: 'mm' },
    designConstraints: [
      'Gussets carry the load in compression — keep their grain running diagonally from rail to shelf front.',
      `Shelf-to-rail screws must be ≥ ${minScrew} mm long; pilot-drill to avoid splitting the rail edge.`,
      'Lighter-duty than steel brackets: label it for decorative / light items (≈5 kg).',
    ],
    tolerances: ['Shelf level within 1 mm', 'Gussets square to the rail ±1°'],
    assumptions: board.assumptions,
    components: [
      { id: 'rail', name: 'Back rail', material: board.item?.name || 'Board', quantity: 1, cutLength: shelfLen, cutWidth: railH, thickness: T, role: 'Fixed to the wall; carries the shelf', fromInventory: board.item?.name || null, instances: [cuboid(0, 0, 0, shelfLen, T, railH)] },
      { id: 'shelf', name: 'Shelf board', material: board.item?.name || 'Board', quantity: 1, cutLength: shelfLen, cutWidth: D, thickness: T, role: 'Load surface', fromInventory: board.item?.name || null, instances: [cuboid(0, 0, railH, shelfLen, D, T)] },
      { id: 'gusset', name: 'Gusset', material: board.item?.name || 'Board', quantity: 2, cutLength: gW, cutWidth: railH, thickness: T, role: 'Triangular brace under the shelf (drawn as its bounding block)', fromInventory: board.item?.name || null, instances: [cuboid(inset, T, railH - Math.round(railH * 0.8), T, gW - T, Math.round(railH * 0.8)), cuboid(shelfLen - inset - T, T, railH - Math.round(railH * 0.8), T, gW - T, Math.round(railH * 0.8))] },
    ],
    cutList: cuts,
    tools: ['Saw', 'Drill/driver', 'Ø 3 mm pilot bit', 'Square', 'Spirit level', 'Tape measure', 'Sandpaper'],
    safety: wallShelf.safety,
    riskFlags: [{ level: 'caution', text: 'Light-duty design (≈5 kg). Load-test at 1.5× before selling and state the limit on the listing.' }, ...cuts.warnings.map((w) => ({ level: 'caution', text: w }))],
    steps: [
      step({ title: 'Cut the shelf, rail and gusset blank', objective: 'All parts from your boards.', components: ['shelf', 'rail', 'gusset'], tools: ['Saw', 'Square', 'Tape measure'], measurements: [`Shelf: ${shelfLen} × ${D} mm`, `Back rail: ${shelfLen} × ${railH} mm${railH < D ? ' (rip to width)' : ''}`, `Gusset blank: ${gW} × ${railH} mm`, `${KERF_MM} mm kerf on the waste side`], instructions: 'Square one end, then cut each part, measuring every piece from a freshly squared end. Follow the cut list so all parts come from as few boards as possible.', orientation: 'Best face up.', connections: 'None.', alignmentCheck: 'Shelf and rail exactly the same length (±1 mm).', commonMistakes: ['Measuring from the factory end without squaring it'] }),
      step({ title: 'Cut the blank into two gussets', objective: 'Two identical right-angled triangles.', components: ['gusset'], tools: ['Saw', 'Clamps'], measurements: [`Diagonal from corner to corner of the ${gW} × ${railH} mm blank`], instructions: 'Draw the diagonal, clamp the blank and saw along it. Each triangle has one leg against the rail and one under the shelf.', orientation: 'Blank flat on the bench, clamped.', connections: 'None.', alignmentCheck: 'Both triangles match when stacked.', commonMistakes: ['Holding small pieces by hand while sawing'] }),
      sandStep(['shelf', 'rail', 'gusset']),
      step({ title: 'Screw the shelf onto the rail', objective: 'Shelf back edge flush with the rail’s back face.', components: ['shelf', 'rail'], tools: ['Drill/driver', 'Ø 3 mm pilot bit'], measurements: [`4 screws, first and last ${Math.round(shelfLen * 0.08)} mm from the ends`, `Screw centreline ${Math.round(T / 2)} mm from the shelf back edge`, `Screw length ≥ ${minScrew} mm`], instructions: 'Stand the rail on edge, set the shelf on top with the back edges flush, pilot-drill down through the shelf into the centre of the rail’s edge and drive the screws.', orientation: 'Rail on edge on the bench, shelf on top.', connections: 'Shelf underside → rail top edge.', alignmentCheck: 'Shelf at 90° to the rail (check with a square).', commonMistakes: ['Pilot hole off-centre — the screw splits out of the rail face'] }),
      step({ title: 'Fit the gussets', objective: 'Brace the shelf against the rail.', components: ['gusset', 'shelf', 'rail'], tools: ['Drill/driver', 'Ø 3 mm pilot bit'], measurements: [`Gussets ${inset} mm in from each end`, '2 screws through the rail into each gusset, 2 down through the shelf into each gusset'], instructions: 'Hold each gusset tight into the corner under the shelf, pilot-drill and screw through the rail and through the shelf into it.', orientation: 'Assembly upside down on the bench.', connections: 'Gusset legs → rail face and shelf underside.', alignmentCheck: 'Both gussets the same distance from their ends (±2 mm).', commonMistakes: ['Gap in the corner — the gusset must touch both rail and shelf'] }),
      step({ title: 'Mount and check', objective: 'Fix the rail to the wall, level.', components: ['rail'], tools: ['Drill', 'Spirit level', 'Cable detector'], measurements: ['3 wall fixings through the rail, below the shelf: centre and 50 mm from each end'], instructions: 'Scan for cables and pipes, hold level, mark through the rail, drill for fixings suited to your wall, and screw the rail on.', orientation: 'Final position on the wall.', connections: 'Rail → wall fixings.', alignmentCheck: 'Level within 1 mm; no movement under a firm hand press.', commonMistakes: ['Wall fixings not suited to the wall type'] }),
    ],
    finalInspection: ['Shelf level within 1 mm', 'Both gussets tight in their corners', 'No screw tips through any face', 'Load-tested at 1.5× the stated limit'],
    suggestedPrice: ctx.price(22),
    packagingPerUnit: ctx.price(1.2),
    laborMinutesPerUnit: 70,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Floating wall shelf                                              */
/* ------------------------------------------------------------------ */
const wallShelf = {
  id: 'wall_shelf',
  name: 'Bracket-mounted wall shelf',
  tagline: 'A clean single-board shelf on two steel brackets',
  description: 'A minimalist wall shelf made from one board and two L-brackets. Ideal for plants, books and kitchen jars; easy to batch and photograph.',
  category: 'Home & storage',
  visualShape: 'shelf',
  difficulty: 'beginner',
  minutes: 75,
  skills: ['basic woodworking'],
  requires: [
    { key: 'wood_board', essential: true, perUnit: 1, unit: 'board', buy: { name: 'Pine board', spec: '18 mm planed pine, ≥ 600 × 150 mm', usd: 4.5 } },
    { key: 'brackets', essential: false, perUnit: 2, unit: 'pcs', why: 'Carry the shelf load into the wall (without brackets the plan switches to a timber-gusset design)', buy: { name: 'Steel L-bracket', spec: '≥ 100 mm arms, with screw holes', usd: 1.6 } },
    { key: 'screws', essential: false, perUnit: 8, unit: 'pcs', why: 'Fix the brackets to the shelf', buy: { name: 'Wood screws', spec: '4 × 16 mm countersunk', usd: 0.04 } },
    { key: 'wall_plugs', essential: false, perUnit: 4, unit: 'sets', why: 'Wall fixings must be rated for your wall type — not something to improvise for a loaded shelf', buy: { name: 'Wall plugs + screws', spec: 'Rated for your wall type (e.g. 6 mm plugs + 4.5 × 40 mm screws)', usd: 0.25 } },
    { key: 'finish', optional: true, perUnit: 0.05, unit: 'bottle', why: 'Protects and colours the wood; the shelf works without it', buy: { name: 'Wood oil or varnish', spec: 'Interior finish', usd: 6 } },
  ],
  extraBuy: [],
  tools: [{ key: 'drill', essential: true }, { key: 'saw', essential: false }, { key: 'sander', essential: false }, { key: 'level', essential: false }, { key: 'tape', essential: false }],
  priceUSD: [18, 35],
  customers: ['Renters and first-home buyers', 'Plant owners', 'Small cafés and shops'],
  channels: ['Local classifieds', 'Social media marketplace', 'Handmade marketplace', 'Local décor shops'],
  risks: ['Load capacity depends entirely on the wall fixing — you cannot guarantee it for the buyer', 'Bulky to ship relative to price'],
  safety: ['Locate cables and pipes with a detector before drilling walls', 'Wear eye protection when drilling', 'State the tested maximum load on the listing'],
  scores: { demand: 70, economics: 68, easeOfTesting: 80, safety: 72 },
  dependsOn: ['Board length, width and thickness', 'Bracket arm length', 'Wall type (masonry, drywall, timber)'],
  plan(ctx) {
    // Reuse first: no brackets in stock but boards available → build timber gussets instead of buying brackets.
    if (!ctx.item('brackets') && ctx.item('wood_board')) return gussetShelfPlan(ctx);
    const board = ctx.stock('wood_board', { length: 1200, width: 150, thickness: 18 });
    const T = board.dims.thickness;
    const D = board.dims.width;
    const L = Math.min(board.dims.length - 20, 800);
    const shelfLen = roundTo(Math.max(300, L >= 600 ? 600 : L), 5);
    const inset = roundTo(shelfLen * 0.15, 5);
    const arm = roundTo(Math.max(100, D * 0.75), 5);
    const maxScrew = Math.max(10, T - 3);
    const cuts = packCuts([{ id: 'shelf', name: 'Shelf board', length: shelfLen, width: D, qty: 1 }], board.dims);
    const bracketW = 20;
    return {
      summary: `A ${shelfLen} × ${D} × ${T} mm shelf board supported by two L-brackets set ${inset} mm in from each end.`,
      overall: { length: shelfLen, width: D, height: T + arm, unit: 'mm' },
      designConstraints: [
        `Bracket arm should cover at least two-thirds of the ${D} mm depth (≥ ${roundTo((D * 2) / 3, 5)} mm).`,
        `Screws into the shelf must be shorter than ${T} mm − 3 mm = ${maxScrew} mm so they cannot break through the top.`,
        'Wall fixings must suit the wall type; drywall anchors alone are not suitable for heavy loads.',
      ],
      tolerances: ['Shelf must be level within 1 mm over its length', 'Bracket positions mirrored within ±2 mm'],
      assumptions: board.assumptions,
      components: [
        { id: 'shelf', name: 'Shelf board', material: board.item?.name || 'Pine board', quantity: 1, cutLength: shelfLen, cutWidth: D, thickness: T, role: 'Load-carrying surface', fromInventory: board.item?.name || null, instances: [cuboid(0, 0, arm, shelfLen, D, T)] },
        {
          id: 'bracket',
          name: 'L-bracket',
          material: 'Steel',
          quantity: 2,
          cutLength: null,
          cutWidth: null,
          thickness: 3,
          role: 'Transfers shelf load into the wall',
          fromInventory: ctx.item('brackets')?.name || null,
          instances: [
            cuboid(inset, 0, 0, bracketW, 3, arm),
            cuboid(inset, 0, arm - 3, bracketW, arm, 3),
            cuboid(shelfLen - inset - bracketW, 0, 0, bracketW, 3, arm),
            cuboid(shelfLen - inset - bracketW, 0, arm - 3, bracketW, arm, 3),
          ],
        },
      ],
      cutList: cuts,
      tools: ['Drill/driver', 'Ø 2.5 mm pilot bit', 'Masonry or wood bit to suit wall plugs', 'Tape measure', 'Pencil', 'Spirit level', 'Saw (if the board needs shortening)', 'Sandpaper'],
      safety: wallShelf.safety,
      riskFlags: [{ level: 'caution', text: 'Load-bearing wall fixture: test with at least 1.5× the advertised load before selling, and state that installation must suit the wall type.' }],
      steps: [
        step({
          title: 'Measure and cut the shelf board',
          objective: `Produce one shelf blank exactly ${shelfLen} mm long.`,
          components: ['shelf'],
          tools: ['Tape measure', 'Square', 'Saw'],
          measurements: [`Cut length: ${shelfLen} mm`, `Width stays at ${D} mm`, `Kerf allowance: ${KERF_MM} mm on the waste side`],
          instructions: `Square one end of the board first (trim ~10 mm). From that squared end measure ${shelfLen} mm, mark across the face with a square and cut on the waste side of the line.`,
          orientation: 'Best face up while marking; cut with the board fully supported on both sides.',
          connections: 'None.',
          alignmentCheck: 'Measure both long edges — they must be within 1 mm of each other; check the ends with a square.',
          commonMistakes: ['Cutting on the line instead of beside it (board ends up ~3 mm short)', 'Not squaring the factory end first'],
        }),
        sandStep(['shelf']),
        step({
          title: 'Mark bracket positions on the underside',
          objective: 'Place both brackets symmetrically and flush with the back edge.',
          components: ['shelf', 'bracket'],
          tools: ['Tape measure', 'Square', 'Pencil'],
          measurements: [`Bracket inset from each end: ${inset} mm (to the outer edge of the bracket)`, `Centre-to-centre spacing: ${shelfLen - 2 * inset - bracketW} mm`, 'Bracket back face flush with the shelf back edge'],
          instructions: `Lay the shelf upside down. Measure ${inset} mm in from each end along the back edge and square a line across. Place each bracket's horizontal arm on the outside of its line with its vertical leg flush with the back edge. Mark the screw holes with a pencil.`,
          orientation: 'Shelf upside down (underside up), back edge towards you.',
          connections: 'Bracket horizontal arms → underside of shelf.',
          alignmentCheck: 'Measure from each bracket to its end: both must read the same within 2 mm.',
          commonMistakes: ['Brackets set back from the edge — the shelf then cannot sit tight to the wall', 'Mirroring error: one bracket inside its line, one outside'],
        }),
        step({
          title: 'Pre-drill and screw the brackets to the shelf',
          objective: 'Attach both brackets without splitting the board or breaking through the top.',
          components: ['shelf', 'bracket'],
          tools: ['Drill/driver', 'Ø 2.5 mm pilot bit', 'Depth stop or tape flag'],
          measurements: [`Pilot hole depth: ${maxScrew - 2} mm (tape flag on the bit)`, `Maximum screw length: ${maxScrew} mm`, '4 screws per bracket'],
          instructions: `Wrap tape around the 2.5 mm bit ${maxScrew - 2} mm from its tip. Drill a pilot hole at each marked point, keeping the bit vertical. Drive the screws until snug — stop as soon as the head seats to avoid stripping.`,
          orientation: 'Shelf still upside down on the bench.',
          connections: 'Each bracket arm fixed with 4 screws into the shelf underside.',
          alignmentCheck: 'Stand the shelf on its brackets on a flat surface: it must not rock; check both brackets are at 90° to the board with a square.',
          commonMistakes: ['Screws longer than the board thickness minus 3 mm (they pop through the top)', 'Over-tightening into softwood'],
        }),
        step({
          title: 'Mark the wall and drill fixing holes',
          objective: 'Transfer the bracket hole positions to the wall on a level line.',
          components: ['bracket'],
          tools: ['Spirit level', 'Pencil', 'Cable/pipe detector', 'Drill with bit for your wall plugs'],
          measurements: ['Draw a level line at the chosen shelf height', `Bracket hole spacing on the wall: ${shelfLen - 2 * inset - bracketW} mm centres`],
          instructions: 'Scan the area for cables and pipes. Hold the shelf against the wall at height, check it is level, and mark through the bracket wall holes. Drill holes to the depth and diameter specified by your wall plug, then insert plugs flush with the wall surface. Prefer fixing into studs or masonry for heavier loads.',
          orientation: 'Shelf held in final position against the wall.',
          connections: 'Bracket vertical legs → wall plugs.',
          alignmentCheck: 'Level bubble centred on the line before marking.',
          commonMistakes: ['Drilling without checking for cables', 'Using plugs not rated for the wall type'],
        }),
        step({
          title: 'Mount and check',
          objective: 'Fix the shelf and verify level and stability.',
          components: ['shelf', 'bracket'],
          tools: ['Drill/driver', 'Spirit level'],
          measurements: ['Level within 1 mm over the length'],
          instructions: 'Screw the brackets to the wall through the plugs, top screws first. Re-check level, then tighten all screws. Load gradually to your intended test load and inspect for movement.',
          orientation: 'Final installed position.',
          connections: 'Wall screws through bracket legs into plugs.',
          alignmentCheck: 'Level on the top surface; no movement when pressed firmly downwards at the front edge.',
          commonMistakes: ['Fully tightening one bracket before starting the other (pulls the shelf out of level)'],
        }),
      ],
      finalInspection: ['No splinters on any edge', 'Shelf level within 1 mm', 'No screw tips visible on the top surface', 'Shelf does not move under a firm hand press', 'Test-load result recorded for the listing'],
      suggestedPrice: ctx.price(24),
      packagingPerUnit: ctx.price(1.2),
      laborMinutesPerUnit: 60,
      extraBom: [],
    };
  },
};

/* ------------------------------------------------------------------ */
/* Box builder shared by organiser and planter                         */
/* ------------------------------------------------------------------ */
function boxPieces(L, W, H, T, { divider = false } = {}) {
  const wallH = H - T;
  const sideLen = W - 2 * T;
  const pieces = [
    { id: 'base', name: 'Base', length: L, width: W, qty: 1 },
    { id: 'long_wall', name: 'Front / back wall', length: L, width: wallH, qty: 2 },
    { id: 'end_wall', name: 'End wall', length: sideLen, width: wallH, qty: 2 },
  ];
  if (divider) pieces.push({ id: 'divider', name: 'Divider', length: sideLen, width: roundTo(wallH * 0.7, 5), qty: 1 });
  return pieces;
}

function boxComponents(pieces, L, W, H, T, stockName) {
  const wallH = H - T;
  const sideLen = W - 2 * T;
  const comps = [
    { id: 'base', name: 'Base', material: stockName, quantity: 1, cutLength: L, cutWidth: W, thickness: T, role: 'Bottom panel; walls sit on top of it', fromInventory: stockName, instances: [cuboid(0, 0, 0, L, W, T)] },
    { id: 'long_wall', name: 'Front / back wall', material: stockName, quantity: 2, cutLength: L, cutWidth: wallH, thickness: T, role: 'Full-length walls that overlap the end walls', fromInventory: stockName, instances: [cuboid(0, 0, T, L, T, wallH), cuboid(0, W - T, T, L, T, wallH)] },
    { id: 'end_wall', name: 'End wall', material: stockName, quantity: 2, cutLength: sideLen, cutWidth: wallH, thickness: T, role: 'Fit between the front and back walls', fromInventory: stockName, instances: [cuboid(0, T, T, T, sideLen, wallH), cuboid(L - T, T, T, T, sideLen, wallH)] },
  ];
  const div = pieces.find((p) => p.id === 'divider');
  if (div) {
    comps.push({ id: 'divider', name: 'Divider', material: stockName, quantity: 1, cutLength: sideLen, cutWidth: div.width, thickness: T, role: 'Splits the box into two compartments', fromInventory: stockName, instances: [cuboid(roundTo(L * 0.4, 1), T, T, T, sideLen, div.width)] });
  }
  return comps;
}

function boxAssemblySteps({ L, W, H, T, pieces, fastener, pilot, divider }) {
  const wallH = H - T;
  const sideLen = W - 2 * T;
  const cutLines = pieces.map((p) => `${p.name}: ${p.qty} × ${p.length} × ${p.width} mm`);
  const steps = [
    step({
      title: 'Cut all panels',
      objective: 'Produce every panel to the cut list before any assembly.',
      components: pieces.map((p) => p.id),
      tools: ['Tape measure', 'Square', 'Saw', 'Clamps'],
      measurements: cutLines,
      instructions: `Rip boards to width first if they are wider than needed, then cross-cut to length. Cut identical parts together or with a stop block so pairs match exactly. Label each panel in pencil (B, F, K, E1, E2${divider ? ', D' : ''}).`,
      orientation: 'Best face up; mark on the face that will be visible.',
      connections: 'None.',
      alignmentCheck: 'Matching pairs must be identical within 0.5 mm — stack them and feel the ends.',
      commonMistakes: ['Measuring each piece from the previous cut (errors accumulate)', `Forgetting the ${KERF_MM} mm saw kerf between pieces`],
    }),
    sandStep(pieces.map((p) => p.id)),
    step({
      title: 'Attach the end walls to the base',
      objective: 'Fix both end walls upright on the base at its short ends.',
      components: ['base', 'end_wall'],
      tools: ['Wood glue', 'Drill/driver', `Ø ${pilot} mm pilot bit`, 'Square', 'Clamps'],
      measurements: [`End walls sit ${T} mm in from the front and back edges of the base (where the long walls will go)`, `End wall length ${sideLen} mm spans exactly between those lines`, `Fasteners: 2 per joint, ${fastener}`],
      instructions: `On the base, draw lines ${T} mm in from the front and back edges. Spread a thin bead of glue on the bottom edge of an end wall, stand it flush with the end of the base between the lines, and clamp. Drill pilot holes up through the base into the wall, 25 mm from each end, and drive the fasteners. Repeat at the other end.`,
      orientation: 'Base flat on the bench, show face down; walls standing vertically.',
      connections: 'End wall bottom edge → base top face, at each short end.',
      alignmentCheck: 'Check 90° between each end wall and the base with a square.',
      commonMistakes: ['Wall flush with the base edge instead of inset — the long walls will then not fit', 'Too much glue (squeeze-out stains the finish)'],
    }),
    step({
      title: 'Attach the front and back walls',
      objective: 'Close the box with the full-length walls overlapping the end walls.',
      components: ['long_wall', 'end_wall', 'base'],
      tools: ['Wood glue', 'Drill/driver', `Ø ${pilot} mm pilot bit`, 'Clamps'],
      measurements: [`Long wall: ${L} × ${wallH} mm, flush with the base ends`, `Fastener positions: ${roundTo(T / 2, 1)} mm in from each end (centred on the end-wall thickness), 2 per end + 2 into the base`],
      instructions: `Glue the edges of the end walls and the base's long edge. Place a long wall so its ends are flush with the outside faces of the end walls and its bottom edge rests on the base. Clamp, pilot-drill ${roundTo(T / 2, 1)} mm in from each end into the end walls, and fasten. Repeat on the other side.`,
      orientation: 'Box upright; work on one long side at a time.',
      connections: 'Long wall ends → end-wall edges; long wall bottom → base edge.',
      alignmentCheck: `Measure both diagonals across the top opening: they must match within 1 mm (box is square). Outside length must read ${L} mm.`,
      commonMistakes: ['Pilot hole not centred on the end-wall thickness (screw breaks out the side)', 'Skipping the diagonal check before the glue sets'],
    }),
  ];
  if (divider) {
    steps.push(
      step({
        title: 'Fit the divider',
        objective: 'Create two compartments.',
        components: ['divider', 'long_wall', 'base'],
        tools: ['Wood glue', 'Square'],
        measurements: [`Divider position: ${roundTo(L * 0.4, 1)} mm from the left inside face`, `Divider length ${sideLen} mm should press-fit between the long walls`],
        instructions: 'Dry-fit the divider first; trim if tight. Glue its bottom and side edges and press it into place, keeping it square to the base.',
        orientation: 'Box upright.',
        connections: 'Divider → base and both long walls (glued).',
        alignmentCheck: 'Divider vertical (square against the base) and parallel to the end walls.',
        commonMistakes: ['Forcing a tight divider (bows the long walls outward)'],
      })
    );
  }
  steps.push(
    step({
      title: 'Fill, final-sand and finish',
      objective: 'Make the outside presentable and protect the wood.',
      components: pieces.map((p) => p.id),
      tools: ['Wood filler (optional)', '180-grit sandpaper', 'Finish and cloth'],
      measurements: ['Allow the glue to cure for the time stated on the bottle before sanding joints', 'Finish: 2 thin coats; follow the product drying time'],
      instructions: 'Fill any screw holes on visible faces, sand flush, and apply finish in thin coats with the grain. Let each coat dry fully.',
      orientation: 'Upside down on blocks for the base; upright for walls.',
      connections: 'None.',
      alignmentCheck: 'Even sheen, no drips at the corners.',
      commonMistakes: ['Applying a thick coat (runs and sticky finish)'],
    })
  );
  return steps;
}

/* ------------------------------------------------------------------ */
/* 2. Desk organiser                                                   */
/* ------------------------------------------------------------------ */
const deskOrganizer = {
  id: 'desk_organizer',
  name: 'Two-compartment desk organiser',
  tagline: 'A compact box for pens, phones and stationery',
  description: 'A small wooden box with one divider. Uses short offcuts efficiently, ships easily and suits gift buyers and home offices.',
  category: 'Office & gifts',
  visualShape: 'organizer',
  difficulty: 'beginner',
  minutes: 90,
  skills: ['basic woodworking'],
  requires: [
    { key: 'wood_board', essential: true, perUnit: 1, unit: 'board', buy: { name: 'Pine board', spec: '12–18 mm planed, ≥ 120 mm wide', usd: 4 } },
    { key: 'screws', essential: false, perUnit: 10, unit: 'pcs', why: 'Hold the butt joints together', substitutes: [{ key: 'nails', note: '30 mm brads or nails hold these light butt joints — pre-drill near the ends' }, { key: 'glue', note: 'glue-only joints work if you clamp each joint for the glue’s full clamp time', ratio: 0.005 }], buy: { name: 'Wood screws', spec: '3 × 30 mm', usd: 0.03 } },
    { key: 'glue', optional: true, perUnit: 0.05, unit: 'bottle', why: 'Stronger joints with fewer visible fasteners; screws alone hold this light box', buy: { name: 'PVA wood glue', spec: 'D2/D3 interior wood glue', usd: 5 } },
    { key: 'felt', optional: true, perUnit: 4, unit: 'pcs', why: 'Protects desks from scratches', buy: { name: 'Felt pads', spec: '10 mm self-adhesive', usd: 0.05 } },
  ],
  extraBuy: [],
  tools: [{ key: 'saw', essential: true }, { key: 'drill', essential: false }, { key: 'clamp', essential: false }, { key: 'sander', essential: false }, { key: 'tape', essential: false }],
  priceUSD: [14, 28],
  customers: ['Home-office workers', 'Gift buyers', 'Students'],
  channels: ['Handmade marketplace', 'Instagram', 'Local gift shops', 'Corporate gifting (B2B)'],
  risks: ['Many cheap mass-produced alternatives — differentiate with wood species, engraving or personalisation'],
  safety: ['Keep hands clear of the blade when cutting small pieces — use a clamp or push stick', 'Wear a dust mask when sanding'],
  scores: { demand: 62, economics: 70, easeOfTesting: 85, safety: 88 },
  dependsOn: ['Board thickness and width'],
  plan(ctx) {
    const board = ctx.stock('wood_board', { length: 1000, width: 120, thickness: 15 });
    const T = Math.min(board.dims.thickness, 20);
    const W = Math.min(roundTo(board.dims.width, 1), 120);
    const L = 240;
    const H = 100;
    const pieces = boxPieces(L, W, H, T, { divider: true });
    const cuts = packCuts(pieces, board.dims);
    return {
      summary: `An open box ${L} × ${W} × ${H} mm from ${T} mm stock, with one divider. Needs ${cuts.boardsNeeded} board(s) of your stock per unit (${cuts.utilisationPct}% utilisation).`,
      overall: { length: L, width: W, height: H, unit: 'mm' },
      designConstraints: [`Base width is limited by board width (${board.dims.width} mm)`, 'Butt joints rely on glue + fasteners; keep walls ≥ 9 mm thick'],
      tolerances: ['Diagonals equal within 1 mm', 'Matching pairs within 0.5 mm'],
      assumptions: board.assumptions,
      components: boxComponents(pieces, L, W, H, T, board.item?.name || 'Pine board'),
      cutList: cuts,
      tools: ['Saw', 'Square', 'Tape measure', 'Clamps', 'Drill/driver + Ø 2 mm pilot bit', 'Sandpaper 120/180'],
      safety: deskOrganizer.safety,
      riskFlags: cuts.warnings.map((w) => ({ level: 'caution', text: w })),
      steps: boxAssemblySteps({ L, W, H, T, pieces, fastener: '3 × 30 mm screws or 30 mm brads', pilot: 2, divider: true }),
      finalInspection: ['Box sits flat without rocking', 'Diagonals equal within 1 mm', 'No glue squeeze-out visible', 'Felt pads on the base'],
      suggestedPrice: ctx.price(19),
      packagingPerUnit: ctx.price(0.9),
      laborMinutesPerUnit: 75,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 3. Planter box                                                      */
/* ------------------------------------------------------------------ */
const planterBox = {
  id: 'planter_box',
  name: 'Indoor/balcony planter box',
  tagline: 'A slim rectangular planter with drainage',
  description: 'A wooden planter sized for windowsills and balconies, with drainage holes and a replaceable liner.',
  category: 'Garden',
  visualShape: 'planter',
  difficulty: 'beginner',
  minutes: 100,
  skills: ['basic woodworking'],
  requires: [
    { key: 'wood_board', essential: true, perUnit: 1, unit: 'board', buy: { name: 'Exterior-grade board', spec: '18 mm, untreated or rated for planters', usd: 6 } },
    { key: 'screws', essential: false, perUnit: 16, unit: 'pcs', why: 'Hold the walls together outdoors', substitutes: [{ key: 'nails', note: 'galvanised or ring-shank nails; plain steel nails will rust' }], buy: { name: 'Exterior screws', spec: '4 × 40 mm stainless or coated', usd: 0.06 } },
    { key: 'plastic_sheet', essential: false, perUnit: 1, unit: 'pcs', why: 'Keeps wet soil off the wood so it does not rot', buy: { name: 'Planter liner', spec: 'Heavy-duty plastic or landscape fabric', usd: 1.2 } },
  ],
  extraBuy: [],
  tools: [{ key: 'saw', essential: true }, { key: 'drill', essential: true }, { key: 'tape', essential: false }, { key: 'sander', essential: false }],
  priceUSD: [22, 45],
  customers: ['Apartment gardeners', 'Herb growers', 'Cafés with terraces'],
  channels: ['Local classifieds', 'Garden centres', 'Social media marketplace', 'Seasonal markets'],
  risks: ['Strongly seasonal demand', 'Wood rot if the liner and drainage are neglected'],
  safety: ['Do not use pressure-treated wood for edible plants unless it is rated safe for that use', 'Wear a dust mask when cutting treated or exterior timber'],
  scores: { demand: 64, economics: 62, easeOfTesting: 70, safety: 78 },
  dependsOn: ['Board width (sets wall height)', 'Board thickness'],
  plan(ctx) {
    const board = ctx.stock('wood_board', { length: 1800, width: 140, thickness: 18 });
    const T = board.dims.thickness;
    const H = Math.min(roundTo(board.dims.width + T, 1), 180);
    const W = Math.min(board.dims.width, 180);
    const L = 450;
    const pieces = boxPieces(L, W, H, T);
    const cuts = packCuts(pieces, board.dims);
    const holeSpacing = roundTo((L - 100) / 3, 5);
    const steps = boxAssemblySteps({ L, W, H, T, pieces, fastener: '4 × 40 mm exterior screws', pilot: 2.5, divider: false });
    steps.splice(
      steps.length - 1,
      0,
      step({
        title: 'Drill drainage holes and fit the liner',
        objective: 'Let excess water escape so the wood and roots do not sit wet.',
        components: ['base'],
        tools: ['Drill', 'Ø 10 mm bit', 'Staple gun or tacks'],
        measurements: [`4 holes Ø 10 mm along the base centreline, first hole 50 mm from each end, ${holeSpacing} mm apart`],
        instructions: 'Mark the centreline of the base inside the box. Drill the holes through the base with scrap wood clamped underneath to prevent tear-out. Lay the liner in, cut slits over the holes, and staple it 10 mm below the top edge.',
        orientation: 'Box upright, drilling downwards.',
        connections: 'Liner → inside walls (stapled).',
        alignmentCheck: 'Pour a cup of water in: it should drain through all holes.',
        commonMistakes: ['Lining over the holes without slitting the liner'],
      })
    );
    return {
      summary: `A ${L} × ${W} × ${H} mm planter from ${T} mm boards, with 4 drainage holes and a liner. Needs ${cuts.boardsNeeded} board(s) per unit.`,
      overall: { length: L, width: W, height: H, unit: 'mm' },
      designConstraints: ['Wall height follows board width so each wall is one solid strip', 'Exterior-rated fasteners required'],
      tolerances: ['Diagonals equal within 2 mm'],
      assumptions: board.assumptions,
      components: boxComponents(pieces, L, W, H, T, board.item?.name || 'Exterior board'),
      cutList: cuts,
      tools: ['Saw', 'Drill/driver', 'Ø 2.5 mm and Ø 10 mm bits', 'Tape measure', 'Square', 'Staple gun'],
      safety: planterBox.safety,
      riskFlags: [{ level: 'info', text: 'Food-contact: if marketed for herbs or vegetables, use untreated or certified-safe timber and a food-safe liner.' }, ...cuts.warnings.map((w) => ({ level: 'caution', text: w }))],
      steps,
      finalInspection: ['Water drains through every hole', 'Liner secured below the rim', 'All screws countersunk; no sharp points inside'],
      suggestedPrice: ctx.price(30),
      packagingPerUnit: ctx.price(1.5),
      laborMinutesPerUnit: 90,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 4. Phone / tablet stand                                             */
/* ------------------------------------------------------------------ */
const phoneStand = {
  id: 'phone_stand',
  name: 'Angled phone / tablet stand',
  tagline: 'Two-piece slot stand from small offcuts',
  description: 'A stand made from a base and an angled back rest. Small offcuts are enough, which makes it an efficient use of scraps.',
  category: 'Office & gifts',
  visualShape: 'stand',
  difficulty: 'beginner',
  minutes: 45,
  skills: ['basic woodworking'],
  requires: [
    { key: 'wood_board', essential: true, perUnit: 0.3, unit: 'board', buy: { name: 'Hardwood offcut', spec: '18 mm, ≥ 80 mm wide', usd: 2 } },
    { key: 'glue', essential: false, perUnit: 0.02, unit: 'bottle', why: 'Joins the back rest and lip to the base', substitutes: [{ key: 'screws', note: 'two 3 × 30 mm screws driven up through the base into each part', ratio: 200 }], buy: { name: 'PVA wood glue', spec: 'Interior', usd: 5 } },
    { key: 'rubber_feet', optional: true, perUnit: 4, unit: 'pcs', why: 'Extra grip on smooth desks', buy: { name: 'Rubber feet', spec: '8 mm self-adhesive', usd: 0.05 } },
  ],
  extraBuy: [],
  tools: [{ key: 'saw', essential: true }, { key: 'sander', essential: false }, { key: 'clamp', essential: false }, { key: 'tape', essential: false }],
  priceUSD: [10, 20],
  customers: ['Remote workers', 'Gift buyers', 'Small businesses (counter displays)'],
  channels: ['Handmade marketplace', 'Instagram / TikTok', 'Corporate gifting (B2B)'],
  risks: ['Low price point; profitable only with efficient batch cutting'],
  safety: ['Never hand-hold tiny pieces at a power saw — cut the angle on a longer blank, then cross-cut'],
  scores: { demand: 58, economics: 66, easeOfTesting: 90, safety: 86 },
  dependsOn: ['Board thickness'],
  plan(ctx) {
    const board = ctx.stock('wood_board', { length: 600, width: 80, thickness: 18 });
    const T = board.dims.thickness;
    const W = Math.min(board.dims.width, 90);
    const baseL = 110;
    const backL = 120;
    const lipH = 12;
    const pieces = [
      { id: 'base', name: 'Base', length: baseL, width: W, qty: 1 },
      { id: 'back', name: 'Back rest', length: backL, width: W, qty: 1 },
      { id: 'lip', name: 'Front lip', length: W, width: lipH + T, qty: 1 },
    ];
    const cuts = packCuts(pieces, board.dims);
    const backZ = T;
    return {
      summary: `Base ${baseL} × ${W} mm, back rest ${backL} mm set at ~70° and a ${lipH} mm lip to hold the device. Uses ${cuts.boardsNeeded} board(s) of your stock per unit.`,
      overall: { length: baseL, width: W, height: roundTo(backL * 0.94 + T, 1), unit: 'mm' },
      designConstraints: ['Back rest angle ~70° from horizontal keeps the centre of gravity over the base', `Lip height ${lipH} mm clears charging cables only if a 15 mm notch is cut in its centre`],
      tolerances: ['Angle cut ±2°'],
      assumptions: board.assumptions,
      components: [
        { id: 'base', name: 'Base', material: board.item?.name || 'Hardwood', quantity: 1, cutLength: baseL, cutWidth: W, thickness: T, role: 'Footprint and ballast', fromInventory: board.item?.name || null, instances: [cuboid(0, 0, 0, baseL, W, T)] },
        { id: 'back', name: 'Back rest (approximated as vertical block)', material: board.item?.name || 'Hardwood', quantity: 1, cutLength: backL, cutWidth: W, thickness: T, role: 'Supports the device', fromInventory: board.item?.name || null, instances: [cuboid(baseL - T - 25, 0, backZ, T, W, roundTo(backL * 0.94, 1))] },
        { id: 'lip', name: 'Front lip', material: board.item?.name || 'Hardwood', quantity: 1, cutLength: W, cutWidth: lipH + T, thickness: T, role: 'Stops the device sliding', fromInventory: board.item?.name || null, instances: [cuboid(10, 0, T, T, W, lipH)] },
      ],
      cutList: cuts,
      tools: ['Saw (mitre box or mitre saw for the 20° cut)', 'Sandpaper', 'Clamps', 'Wood glue', 'Protractor or bevel gauge'],
      safety: phoneStand.safety,
      riskFlags: cuts.warnings.map((w) => ({ level: 'caution', text: w })),
      steps: [
        step({
          title: 'Cut the base, back rest and lip',
          objective: 'Produce the three parts, with a 20° bevel at the bottom of the back rest.',
          components: ['base', 'back', 'lip'],
          tools: ['Saw', 'Bevel gauge', 'Square'],
          measurements: [`Base: ${baseL} × ${W} mm`, `Back rest: ${backL} × ${W} mm, bottom end bevelled at 20° (gives ~70° lean)`, `Lip: ${W} × ${lipH + T} mm`],
          instructions: 'Cut the back rest bevel on the end of a longer blank first, then cross-cut it to length — this keeps your fingers away from the blade.',
          orientation: 'Face side up; bevel slopes towards the back of the stand.',
          connections: 'None.',
          alignmentCheck: 'Stand the back rest on its bevel on a flat surface: it should lean back at about 70°.',
          commonMistakes: ['Bevel cut the wrong way (back rest leans forward)'],
        }),
        sandStep(['base', 'back', 'lip']),
        step({
          title: 'Glue the back rest and lip',
          objective: 'Join the parts in the right positions.',
          components: ['base', 'back', 'lip'],
          tools: ['Wood glue', 'Clamps'],
          measurements: ['Back rest bevel 25 mm in from the rear edge of the base', 'Lip 10 mm in from the front edge', 'Optional 15 mm cable notch centred in the lip'],
          instructions: 'Glue the bevelled end of the back rest to the base, clamp it gently with a scrap block behind it, then glue the lip. Leave it clamped for the glue manufacturer’s clamp time.',
          orientation: 'Base flat on the bench.',
          connections: 'Back rest bevel → base top; lip bottom → base top.',
          alignmentCheck: 'Place a phone on the stand: it must not tip backwards or slide off.',
          commonMistakes: ['Clamping too hard on the angled joint (it slides)'],
        }),
      ],
      finalInspection: ['Stable with a phone and with a 10" tablet', 'Rubber feet attached', 'No glue on visible faces'],
      suggestedPrice: ctx.price(14),
      packagingPerUnit: ctx.price(0.6),
      laborMinutesPerUnit: 35,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 5. Key holder                                                       */
/* ------------------------------------------------------------------ */
const keyHolder = {
  id: 'key_holder',
  name: 'Wall-mounted key holder',
  tagline: 'A board with evenly spaced hooks for the entryway',
  description: 'A narrow board with brass or black hooks, finished and ready to hang. Quick to make and personalisable.',
  category: 'Home & storage',
  visualShape: 'panel',
  difficulty: 'beginner',
  minutes: 40,
  skills: ['basic woodworking'],
  requires: [
    { key: 'wood_board', essential: true, perUnit: 0.3, unit: 'board', buy: { name: 'Board offcut', spec: '15–20 mm, ≥ 80 mm wide', usd: 2 } },
    { key: 'hooks', essential: false, perUnit: 5, unit: 'pcs', why: 'Hold the keys', substitutes: [{ key: 'screws', note: 'round- or pan-head screws left ~15 mm proud make sturdy key pegs' }], buy: { name: 'Screw-in or plate hooks', spec: 'Metal, ~30 mm', usd: 0.4 } },
    { key: 'wall_plugs', essential: false, perUnit: 2, unit: 'sets', why: 'Mounts the board to your wall type', substitutes: [{ key: 'screws', note: 'only when screwing straight into a timber stud or existing plugged holes — use plugs for masonry or drywall' }], buy: { name: 'Wall plugs + screws', spec: 'Suits wall type', usd: 0.3 } },
  ],
  extraBuy: [],
  tools: [{ key: 'saw', essential: false }, { key: 'drill', essential: true }, { key: 'tape', essential: false }, { key: 'sander', essential: false }],
  priceUSD: [12, 24],
  customers: ['New homeowners', 'Gift buyers', 'Holiday-rental hosts'],
  channels: ['Handmade marketplace', 'Social media marketplace', 'Local gift shops'],
  risks: ['Commodity product — personalisation (names, engraving) is the main differentiator'],
  safety: ['Check for cables before drilling the wall'],
  scores: { demand: 60, economics: 72, easeOfTesting: 90, safety: 90 },
  dependsOn: ['Board width and thickness'],
  plan(ctx) {
    const board = ctx.stock('wood_board', { length: 600, width: 90, thickness: 18 });
    const T = board.dims.thickness;
    const W = Math.min(board.dims.width, 120);
    const L = 300;
    const n = 5;
    const margin = 30;
    const pitch = roundTo((L - 2 * margin) / (n - 1), 0.5);
    const cuts = packCuts([{ id: 'board', name: 'Back board', length: L, width: W, qty: 1 }], board.dims);
    const hookZ = roundTo(W * 0.35, 1);
    return {
      summary: `A ${L} × ${W} × ${T} mm board with ${n} hooks at ${pitch} mm centres.`,
      overall: { length: L, width: T + 30, height: W, unit: 'mm' },
      designConstraints: ['Hook screws must be shorter than the board thickness', 'Hooks placed in the lower third so keys hang clear of the wall'],
      tolerances: ['Hook spacing ±1 mm', 'Hooks on a straight line ±1 mm'],
      assumptions: board.assumptions,
      components: [
        { id: 'board', name: 'Back board', material: board.item?.name || 'Board', quantity: 1, cutLength: L, cutWidth: W, thickness: T, role: 'Mounting plate', fromInventory: board.item?.name || null, instances: [cuboid(0, 0, 0, L, T, W)] },
        { id: 'hook', name: 'Hook', material: 'Metal', quantity: n, cutLength: null, cutWidth: null, thickness: null, role: 'Hold keys', fromInventory: ctx.item('hooks')?.name || null, instances: Array.from({ length: n }, (_, i) => cuboid(margin + i * pitch - 3, T, hookZ, 6, 25, 6)) },
      ],
      cutList: cuts,
      tools: ['Drill/driver', 'Pilot bit to suit hook screws', 'Tape measure', 'Square', 'Sandpaper'],
      safety: keyHolder.safety,
      riskFlags: cuts.warnings.map((w) => ({ level: 'caution', text: w })),
      steps: [
        step({
          title: 'Cut and sand the board',
          objective: `One board ${L} × ${W} mm with softened edges.`,
          components: ['board'],
          tools: ['Saw', 'Square', 'Sandpaper'],
          measurements: [`Length ${L} mm`, `Width ${W} mm`],
          instructions: 'Square one end, measure, cut, then sand all faces and round the front edges.',
          orientation: 'Show face up.',
          connections: 'None.',
          alignmentCheck: 'Ends square to the long edges.',
          commonMistakes: ['Leaving the factory end unsquared'],
        }),
        step({
          title: 'Lay out the hook positions',
          objective: 'Evenly spaced hooks on a straight line.',
          components: ['board', 'hook'],
          tools: ['Tape measure', 'Pencil', 'Square'],
          measurements: [`First and last hook ${margin} mm from the ends`, `Pitch: ${pitch} mm`, `Line ${hookZ} mm up from the bottom edge`],
          instructions: `Draw a light line ${hookZ} mm above the bottom edge. Mark ${n} points along it, starting ${margin} mm from the left end, every ${pitch} mm.`,
          orientation: 'Show face up, bottom edge towards you.',
          connections: 'None.',
          alignmentCheck: `Last mark should land exactly ${margin} mm from the right end.`,
          commonMistakes: ['Cumulative error from measuring each gap separately — measure all marks from the left end'],
        }),
        step({
          title: 'Fit hooks and hangers',
          objective: 'Attach hooks and wall hangers.',
          components: ['hook', 'board'],
          tools: ['Drill/driver', 'Pilot bit'],
          measurements: [`Pilot depth less than ${T - 3} mm`, 'Keyhole hangers on the back, 40 mm from each end, at the same height'],
          instructions: 'Pilot-drill each mark and screw in the hooks so they all face the same way. Fix the keyhole hangers to the back.',
          orientation: 'Front for hooks, then flip for hangers.',
          connections: 'Hooks → front face; hangers → back face.',
          alignmentCheck: 'Sight along the hooks: all on one line and parallel.',
          commonMistakes: ['Hanger screws breaking through the front'],
        }),
      ],
      finalInspection: ['Hooks firm and aligned', 'Hangers at equal height', 'Finish dry and even'],
      suggestedPrice: ctx.price(16),
      packagingPerUnit: ctx.price(0.6),
      laborMinutesPerUnit: 30,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 6. Container candles                                                */
/* ------------------------------------------------------------------ */
const jarCandles = {
  id: 'jar_candles',
  name: 'Upcycled container candles',
  tagline: 'Soy-wax candles poured into your glass jars',
  description: 'Candles poured into reused glass jars. Wax quantity is calculated from the jar volume.',
  category: 'Home fragrance & gifts',
  visualShape: 'jar',
  difficulty: 'intermediate',
  minutes: 30,
  skills: ['candle making'],
  requires: [
    { key: 'glass_jar', essential: true, perUnit: 1, unit: 'jar', buy: { name: 'Candle jar', spec: 'Heat-resistant glass, ~200 ml', usd: 1.2 } },
    { key: 'wax', essential: false, perUnit: 0.17, unit: 'kg', why: 'The fuel — container wax is formulated to burn safely in glass', buy: { name: 'Soy container wax', spec: 'Container blend', usd: 9 } },
    { key: 'wick', essential: false, perUnit: 1, unit: 'pcs', why: 'Must be sized to the jar diameter to burn safely', buy: { name: 'Pre-tabbed cotton wick', spec: 'Sized to the jar diameter (see supplier chart)', usd: 0.15 } },
    { key: 'labels', essential: false, perUnit: 1, unit: 'pcs', why: 'Fire-safety warnings are required on candles in many markets (printable labels you own are fine)', buy: { name: 'Safety warning labels', spec: 'Fire-safety pictograms and text as required in your market', usd: 0.08 } },
  ],
  extraBuy: [],
  tools: [{ key: 'pot', essential: true }, { key: 'thermometer', essential: true }],
  priceUSD: [9, 22],
  customers: ['Gift buyers', 'Eco-conscious shoppers', 'Event and wedding planners'],
  channels: ['Handmade marketplace', 'Instagram / TikTok', 'Local markets', 'Gift shops'],
  risks: ['Regulated product in many markets (labelling, fragrance allergen rules)', 'Reused jars must be heat-resistant and free of cracks', 'Burn testing needed before selling'],
  safety: ['Never leave melting wax unattended; use a double boiler, never direct heat', 'Use only heat-resistant, undamaged glass', 'Burn-test each jar/wick combination for at least 4 hours before sale', 'Check local candle labelling and fire-safety requirements'],
  scores: { demand: 72, economics: 74, easeOfTesting: 80, safety: 55 },
  dependsOn: ['Jar inner diameter and height', 'Jar heat-resistance'],
  plan(ctx) {
    const jar = ctx.stock('glass_jar', { diameter: 70, height: 85 });
    const d = jar.dims.diameter || jar.dims.width || 70;
    const h = jar.dims.height || jar.dims.length || 85;
    const fillH = roundTo(h - 12, 1);
    const volMl = Math.round((Math.PI * (d / 2) ** 2 * fillH) / 1000);
    const waxG = Math.round(volMl * 0.86);
    const fragranceG = Math.round(waxG * 0.07);
    return {
      summary: `Fill each ${d} mm × ${h} mm jar to ${fillH} mm: about ${volMl} ml, which needs about ${waxG} g of wax and ${fragranceG} g of fragrance (7%).`,
      overall: { length: d, width: d, height: h, unit: 'mm' },
      designConstraints: ['Wick size must match the jar diameter (use the wick supplier’s chart)', 'Leave 12 mm headspace'],
      tolerances: ['Pour temperature per wax data sheet ±3 °C'],
      assumptions: [...jar.assumptions, { text: 'Soy wax density ≈ 0.86 g/ml (check your wax data sheet).', needsMeasurement: false }],
      components: [
        { id: 'jar', name: 'Glass jar', material: 'Glass', quantity: 1, cutLength: null, cutWidth: null, thickness: null, role: 'Container', fromInventory: jar.item?.name || null, instances: [] },
        { id: 'wax', name: `Wax (${waxG} g)`, material: 'Soy wax', quantity: 1, cutLength: null, cutWidth: null, thickness: null, role: 'Fuel', fromInventory: ctx.item('wax')?.name || null, instances: [] },
        { id: 'wick', name: 'Wick', material: 'Cotton', quantity: 1, cutLength: h + 20, cutWidth: null, thickness: null, role: 'Burns the wax', fromInventory: ctx.item('wick')?.name || null, instances: [] },
      ],
      cutList: null,
      tools: ['Double boiler', 'Thermometer', 'Kitchen scale', 'Pouring jug', 'Wick centring bar or clothes peg', 'Heat gun or hair dryer (optional)'],
      safety: jarCandles.safety,
      riskFlags: [{ level: 'high', text: 'Fire risk product: burn-test every jar/wick combination and include the warning labels your market requires before selling.' }],
      steps: [
        step({ title: 'Inspect and clean the jars', objective: 'Use only safe containers.', components: ['jar'], tools: ['Hot soapy water'], measurements: [`Inner diameter ≈ ${d} mm, height ≈ ${h} mm (measure to confirm)`], instructions: 'Wash and fully dry the jars. Discard any with chips, cracks or thin walls. Warm the jars slightly before pouring to improve adhesion.', alignmentCheck: 'Hold up to light: no cracks.', commonMistakes: ['Using thin decorative glass not rated for heat'] }),
        step({ title: 'Fix the wick', objective: 'Centre the wick so the candle burns evenly.', components: ['wick', 'jar'], tools: ['Wick sticker or glue dot', 'Centring bar'], measurements: [`Wick length: ${h + 20} mm before trimming`], instructions: 'Stick the wick tab to the exact centre of the jar bottom and hold the top straight with a centring bar.', alignmentCheck: 'Look from above: wick exactly centred.', commonMistakes: ['Off-centre wick (tunnelling and hot glass on one side)'] }),
        step({ title: 'Weigh and melt the wax', objective: 'Melt the right amount safely.', components: ['wax'], tools: ['Scale', 'Double boiler', 'Thermometer'], measurements: [`Wax per jar: ${waxG} g`, 'Melt and add fragrance at the temperature on your wax data sheet', `Fragrance per jar: ${fragranceG} g (7%)`], instructions: 'Weigh the wax for the whole batch (+5% for losses). Melt it in a double boiler while monitoring the temperature. Remove it from the heat, add fragrance at the specified temperature and stir gently for 2 minutes.', alignmentCheck: 'Thermometer reading matches the data sheet.', commonMistakes: ['Overheating wax (discolouration, fire risk)', 'Exceeding the fragrance load recommended for the wax'] }),
        step({ title: 'Pour and cure', objective: 'Fill to the line and cure.', components: ['jar', 'wax', 'wick'], tools: ['Pouring jug'], measurements: [`Fill height: ${fillH} mm (12 mm headspace)`, 'Cure time per wax data sheet (often 1–2 weeks for soy)'], instructions: 'Pour slowly at the recommended pour temperature. Let the candles cool undisturbed away from drafts, then trim the wick to ~6 mm and cure before burn testing.', alignmentCheck: 'Even, flat top surface.', commonMistakes: ['Moving jars while cooling (sinkholes)'] }),
        step({ title: 'Burn test', objective: 'Verify the safety and performance of the wick/jar combination.', components: ['jar', 'wick'], tools: ['Timer', 'Ruler'], measurements: ['Burn 4 hours', 'Full melt pool should reach the edge in ~3–4 h', 'Flame height ≤ 25 mm'], instructions: 'Burn one candle from each batch on a heat-proof surface and record the flame height, melt pool and glass temperature. Change the wick size if needed.', alignmentCheck: 'No soot, no tunnelling, glass not too hot to touch briefly.', commonMistakes: ['Skipping burn tests'] }),
      ],
      finalInspection: ['Burn test recorded', 'Warning label applied', 'Wick trimmed to 6 mm', 'Lid or dust cover fitted'],
      suggestedPrice: ctx.price(14),
      packagingPerUnit: ctx.price(0.8),
      laborMinutesPerUnit: 20,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 7. Rope coasters                                                    */
/* ------------------------------------------------------------------ */
const ropeCoasters = {
  id: 'rope_coasters',
  name: 'Coiled rope coaster set',
  tagline: 'A set of 4 coasters coiled from cotton or jute rope',
  description: 'Spiral-coiled rope coasters glued flat. Rope length is calculated from the coaster diameter and rope thickness.',
  category: 'Home & kitchen',
  visualShape: 'coaster',
  difficulty: 'beginner',
  minutes: 60,
  skills: ['crafts'],
  requires: [
    { key: 'rope', essential: true, perUnit: 6, unit: 'm', buy: { name: 'Cotton or jute rope', spec: '6 mm', usd: 0.4 } },
    { key: 'glue_sticks', essential: false, perUnit: 8, unit: 'sticks', why: 'Bonds each ring of the coil', substitutes: [{ key: 'glue', note: 'fabric or PVA glue works but each coaster must be pressed flat and dry for about an hour', ratio: 0.01 }], buy: { name: 'Hot-glue sticks', spec: '7 mm', usd: 0.08 } },
  ],
  extraBuy: [],
  tools: [{ key: 'glue_gun', essential: true }, { key: 'scissors', essential: true }],
  priceUSD: [10, 20],
  customers: ['Gift buyers', 'Cafés', 'Boho-décor fans'],
  channels: ['Handmade marketplace', 'Instagram', 'Local markets'],
  risks: ['Hot-glue joints can soften under very hot mugs', 'Low barrier to entry — compete on design and colour'],
  safety: ['Hot-glue burns: keep a bowl of cold water nearby'],
  scores: { demand: 55, economics: 70, easeOfTesting: 92, safety: 88 },
  dependsOn: ['Rope diameter'],
  plan(ctx) {
    const rope = ctx.stock('rope', { diameter: 6 });
    const dRope = rope.dims.diameter || rope.dims.thickness || 6;
    const D = 100;
    const perCoaster = Math.round(((Math.PI * (D / 2) ** 2) / dRope) * 1.1);
    const set = 4;
    return {
      summary: `A set of ${set} coasters ${D} mm in diameter from ${dRope} mm rope: about ${(perCoaster / 1000).toFixed(2)} m per coaster (+10% allowance) and ${((perCoaster * set) / 1000).toFixed(1)} m per set.`,
      overall: { length: D, width: D, height: dRope, unit: 'mm' },
      designConstraints: ['Spiral must stay flat — glue in short sections on a flat surface'],
      tolerances: ['Diameter ±3 mm across the set'],
      assumptions: [...rope.assumptions, { text: 'Rope length ≈ π·r² / rope diameter + 10% (spiral approximation).', needsMeasurement: false }],
      components: [{ id: 'rope', name: 'Rope coil', material: 'Cotton/jute', quantity: set, cutLength: perCoaster, cutWidth: null, thickness: dRope, role: 'Coaster body', fromInventory: rope.item?.name || null, instances: [] }],
      cutList: null,
      tools: ['Hot-glue gun', 'Scissors', 'Ruler', 'Baking paper'],
      safety: ropeCoasters.safety,
      riskFlags: [],
      steps: [
        step({ title: 'Cut the rope lengths', objective: `${set} equal lengths.`, components: ['rope'], tools: ['Scissors', 'Tape measure'], measurements: [`${perCoaster} mm per coaster`], instructions: 'Wrap tape around each cut point before cutting to stop fraying.', alignmentCheck: 'All lengths equal.', commonMistakes: ['Cutting without taping (frays)'] }),
        step({ title: 'Start the centre coil', objective: 'Tight, flat centre.', components: ['rope'], tools: ['Hot-glue gun', 'Baking paper'], measurements: ['First turn ≈ 10 mm diameter'], instructions: 'On baking paper, curl the taped end tightly and glue it. Continue coiling, adding a 20–30 mm bead of glue along the side of the previous ring each time.', alignmentCheck: 'Press flat with a book every few turns.', commonMistakes: ['Too much glue (oozes onto the top face)'] }),
        step({ title: 'Finish the edge', objective: 'Neat taper at the end.', components: ['rope'], tools: ['Scissors', 'Hot-glue gun'], measurements: [`Stop at ${D} mm diameter`], instructions: 'Trim the rope end on a long diagonal and glue it flat so the edge looks continuous.', alignmentCheck: `Diameter ${D} ± 3 mm.`, commonMistakes: ['Blunt end that sticks out'] }),
      ],
      finalInspection: ['All 4 lie flat', 'No visible glue strings', 'Sizes within ±3 mm'],
      suggestedPrice: ctx.price(14),
      packagingPerUnit: ctx.price(0.7),
      laborMinutesPerUnit: 50,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 8. Canvas tote bag                                                  */
/* ------------------------------------------------------------------ */
const toteBag = {
  id: 'tote_bag',
  name: 'Lined canvas tote bag',
  tagline: 'A sturdy everyday tote with boxed corners',
  description: 'A canvas tote with reinforced straps and boxed corners. Fabric use is calculated per bag.',
  category: 'Fashion & accessories',
  visualShape: 'bag',
  difficulty: 'intermediate',
  minutes: 90,
  skills: ['sewing'],
  requires: [
    { key: 'fabric', essential: true, perUnit: 0.6, unit: 'm', buy: { name: 'Cotton canvas', spec: '10–12 oz, 1500 mm wide', usd: 6 } },
    { key: 'thread', essential: false, perUnit: 0.1, unit: 'spool', why: 'Every seam', buy: { name: 'Polyester thread', spec: 'Heavy-duty', usd: 3 } },
    { key: 'webbing', essential: false, perUnit: 1.3, unit: 'm', why: 'Handles (without webbing the plan cuts straps from your fabric)', buy: { name: 'Cotton webbing', spec: '30 mm', usd: 0.8 } },
  ],
  extraBuy: [],
  tools: [{ key: 'sewing_machine', essential: true }, { key: 'scissors', essential: true }, { key: 'iron', essential: false }],
  priceUSD: [15, 35],
  customers: ['Shoppers avoiding plastic bags', 'Brands and events (custom print)', 'Students'],
  channels: ['Handmade marketplace', 'Instagram', 'B2B for events / branded merchandise', 'Local markets'],
  risks: ['Price competition with mass-produced totes — design, print or local brand collaborations are key'],
  safety: ['Keep fingers clear of the needle; use a heavy-duty needle (100/16) for canvas'],
  scores: { demand: 66, economics: 64, easeOfTesting: 82, safety: 92 },
  dependsOn: ['Fabric width'],
  plan(ctx) {
    const fabric = ctx.stock('fabric', { width: 1500 });
    const fw = fabric.dims.width || 1500;
    const sa = 10;
    const panelW = 380 + 2 * sa;
    const panelH = 420 + sa + 40;
    const perRow = Math.max(1, Math.floor(fw / panelW));
    const fabricPerBag = Math.round((Math.ceil(2 / perRow) * panelH * 1.05) / 10) * 10;
    const strapL = 650;
    // Adapt to what you own: no webbing → cut the straps from your fabric. Two 650 × 100 mm strips fit in the
    // offcut beside the panels when the fabric is wide enough, otherwise they need ~200 mm more fabric length.
    const fabricStraps = !ctx.item('webbing');
    const besidePanels = perRow >= 2 && fw - perRow * panelW >= strapL;
    const strapExtra = fabricStraps && !besidePanels ? 200 : 0;
    const fabricMm = fabricPerBag + strapExtra;
    const requirements = [
      { ...toteBag.requires[0], perUnit: Math.round(fabricMm / 10) / 100 },
      toteBag.requires[1],
      ...(fabricStraps ? [] : [toteBag.requires[2]]),
    ];
    return {
      requirements,
      summary: `Two panels of ${panelW} × ${panelH} mm (including ${sa} mm seams and a 40 mm hem), with two ${strapL} mm straps${fabricStraps ? ' cut from your own fabric' : ''} and 80 mm boxed corners. About ${fabricMm} mm of ${fw} mm-wide fabric per bag.`,
      overall: { length: 380, width: 80, height: 420, unit: 'mm' },
      designConstraints: ['Straps reinforced with a box-X stitch', 'Use a heavy-duty needle'],
      tolerances: ['Seam allowance ±2 mm'],
      assumptions: fabric.assumptions,
      components: [
        { id: 'panel', name: 'Body panel', material: 'Canvas', quantity: 2, cutLength: panelH, cutWidth: panelW, thickness: null, role: 'Front and back', fromInventory: fabric.item?.name || null, instances: [] },
        fabricStraps
          ? { id: 'strap', name: 'Strap (folded fabric)', material: 'Canvas', quantity: 2, cutLength: strapL, cutWidth: 100, thickness: null, role: 'Handles — folded in four to 25 mm', fromInventory: fabric.item?.name || null, instances: [] }
          : { id: 'strap', name: 'Strap', material: 'Webbing', quantity: 2, cutLength: strapL, cutWidth: 30, thickness: null, role: 'Handles', fromInventory: ctx.item('webbing')?.name || null, instances: [] },
      ],
      cutList: null,
      tools: ['Sewing machine', 'Fabric scissors', 'Pins/clips', 'Iron', 'Ruler', 'Chalk'],
      safety: toteBag.safety,
      riskFlags: [],
      steps: [
        step({ title: 'Cut the panels and straps', objective: 'Two body panels and two straps.', components: ['panel', 'strap'], tools: ['Scissors', 'Ruler', 'Chalk'], measurements: [`Panel: ${panelW} × ${panelH} mm (×2)`, fabricStraps ? `Strap strip: ${strapL} × 100 mm (×2)${besidePanels ? ' — from the offcut beside the panels' : ''}` : `Strap: ${strapL} mm (×2)`, `Panels per fabric width: ${perRow}`], instructions: fabricStraps ? 'Pre-wash the canvas if you will sell it as washable. Cut on grain. For each strap strip, press both long edges to the centre, fold in half again (25 mm wide) and edge-stitch both sides.' : 'Pre-wash the canvas if you will sell it as washable. Cut on grain.', alignmentCheck: 'Panels identical when stacked.', commonMistakes: ['Cutting off-grain (bag twists)'] }),
        step({ title: 'Sew the sides and bottom', objective: 'Make the bag body.', components: ['panel'], tools: ['Sewing machine', 'Clips'], measurements: [`${sa} mm seam allowance`], instructions: 'Right sides together, sew both sides and the bottom. Finish the edges with zigzag stitch.', alignmentCheck: 'Corners square.', commonMistakes: ['Wrong sides together'] }),
        step({ title: 'Box the corners', objective: 'Give the bag an 80 mm base.', components: ['panel'], tools: ['Sewing machine', 'Ruler'], measurements: ['Stitch across each corner where the triangle is 80 mm wide'], instructions: 'Flatten each corner into a triangle with the side seam centred over the bottom seam. Mark an 80 mm line across it, stitch twice, and trim to 10 mm.', alignmentCheck: 'Both corners equal width.', commonMistakes: ['Seams not aligned in the triangle'] }),
        step({ title: 'Hem the top and attach the straps', objective: 'Strong handles.', components: ['panel', 'strap'], tools: ['Iron', 'Sewing machine'], measurements: ['Hem: fold 10 mm then 30 mm', 'Straps 80 mm in from each side seam', 'Box-X stitch 30 × 30 mm'], instructions: 'Press the double-fold hem, tuck the strap ends 30 mm under the hem, and topstitch the hem. Reinforce each strap end with a box-X stitch.', alignmentCheck: 'Hold the bag up by the straps: it hangs level.', commonMistakes: ['Straps twisted before stitching'] }),
      ],
      finalInspection: ['Load test with 8 kg', 'No loose threads', 'Straps symmetrical'],
      suggestedPrice: ctx.price(22),
      packagingPerUnit: ctx.price(0.5),
      laborMinutesPerUnit: 80,
    };
  },
};

export const TEMPLATES = [wallShelf, deskOrganizer, planterBox, phoneStand, keyHolder, jarCandles, ropeCoasters, toteBag];
export const templateById = (id) => TEMPLATES.find((t) => t.id === id);
