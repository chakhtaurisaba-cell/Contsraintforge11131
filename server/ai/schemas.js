// zod schemas for every structured AI output. These are also used to validate the
// output of the demo engine, so both engines produce identical shapes.
import { z } from 'zod';
import { KINDS } from '../../shared/productKind.js';

const str = z.string();
const num = z.number();

export const DetectedObject = z.object({
  name: str,
  material: str,
  category: str,
  quantity: num,
  quantityCountable: z.boolean(),
  unit: str,
  condition: str,
  confidence: num.describe('0..1'),
  visibleMarkings: str,
  potentialUses: z.array(str),
  reusableComponents: z.array(str),
  isReferenceObject: z.boolean().describe('true for rulers, tape measures, credit cards, A4 sheets, coins used as scale'),
  boundingBox: z
    .object({ x: num, y: num, w: num, h: num })
    .nullable()
    .describe('normalised 0..1 box in the image it was seen in'),
  imageIndex: z.number().int(),
  seenInImages: z.array(z.number().int()).describe('every image index where this same object appears (multiple views of one object are ONE entry)'),
  shapeDescription: str.describe('approximate shape and physical form, e.g. "flat rectangular plank, planed faces"'),
  orientation: str,
  dimensions: z.object({
    length: num.nullable(),
    width: num.nullable(),
    height: num.nullable(),
    diameter: num.nullable(),
    thickness: num.nullable(),
    unit: z.enum(['mm', 'cm', 'in']),
    method: z.enum(['visible_marking', 'reference_calibrated', 'multi_view', 'ai_inferred']),
    uncertaintyPct: num,
    reasoning: str,
  }),
  requiresInspection: z.boolean().describe('true when identity, condition or a critical size cannot be trusted from the photos'),
  missingInfo: z.array(str),
});

export const ScanResult = z.object({
  objects: z.array(DetectedObject),
  referenceObjectFound: z.boolean(),
  referenceDescription: str,
  scaleStatus: z.enum(['reference_found', 'markings_only', 'none']),
  overallNotes: str,
  questionsForUser: z.array(str),
  additionalViews: z.array(z.object({ view: str, reason: str, forObject: str })).describe('ONLY views that would materially improve recognition, geometry or confidence'),
  measurementRequests: z.array(z.object({ objectName: str, dimension: z.enum(['length', 'width', 'height', 'diameter', 'thickness']), reason: str })).describe('one known measurement that would calibrate the scene'),
});

export const ParsedResources = z.object({
  recognized: z.boolean().describe('false when the text names no identifiable physical materials, objects or tools (gibberish, random characters, unrelated text)'),
  unrecognizedReason: str.describe('short, plain explanation when recognized=false, else empty'),
  materials: z.array(z.object({
    name: str,
    material: str,
    quantity: num,
    quantityStated: z.boolean().describe('false when the person did not say how many'),
    unit: str,
    size: z.object({ length: num.nullable(), width: num.nullable(), thickness: num.nullable() }).nullable().optional().describe('sizes of ONE piece in mm, only when the text states them (e.g. "1000 x 150 x 18 mm"), else null'),
  })),
  tools: z.array(str),
  skills: z.array(str),
  budget: num.nullable(),
  currency: str.nullable(),
  hoursPerWeek: num.nullable(),
});

// Compact on purpose: every field costs generation time on a local model (the old 35-field
// idea took ~800 tokens). Fit, shortages, missing tools and ranking are computed by the app.
export const VISUAL_KINDS = KINDS;

// Compact on purpose: every field costs generation time on a local model. Feasibility, fit,
// shortages, missing tools, ranking and prices are worked out by the app (prices on Sell).
export const ProductIdea = z.object({
  name: str.describe('short product name, at most 5 words'),
  summary: str.describe('ONE sentence: what it is and what it is for'),
  whyFeasible: str.describe('one or two sentences: why it can really be built from exactly these materials, amounts and tools'),
  category: str,
  primaryMaterial: str.describe('exact inventory name of the main material the product is made of'),
  usesExisting: z.array(z.object({ inventoryName: str.describe('exact name of an inventory item'), quantityUsed: num.describe('amount per finished unit'), unit: str, use: str.describe('the part it becomes, 2–5 words') })),
  missing: z.array(z.object({ name: str, quantity: num, unit: str, estUnitPrice: num, why: str }).describe('per-unit quantities of things the user genuinely does not own and cannot substitute')),
  toolsRequired: z.array(str).describe('only tools this design truly needs'),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
  estProductionMinutes: num,
  size: z.object({ length: num, width: num, height: num }).describe('approximate finished size in mm (length = widest side)'),
  safetyNote: str.describe('one short precaution specific to this product, or empty'),
  dependsOnMeasurements: z.array(str).describe('sizes the user must check before building'),
  steps: z.array(str).describe('3–6 short, concrete building steps using the user’s own materials and tools, with measurements where relevant (the full guide comes later)'),
  potentialUse: str.describe('who would use it and for what, in one short sentence'),
  sellable: z.object({
    realistic: z.boolean().describe('true only if a buyer would plausibly pay for it as made from these materials'),
    note: str.describe('one short selling suggestion if realistic (where/how), otherwise why not'),
  }),
  sourceRefs: z.array(num).describe('numbers of the research results that inspired or confirm this idea; [] when it is your own'),
  look: str.describe('one sentence: what the finished object really looks like — shape, which materials are visible where, visible cuts, wraps, knots or joints; must match the steps'),
  visualKind: z.enum(VISUAL_KINDS).describe('the closest picture of the finished product'),
});

// The smallest addition that unlocks good projects — used only when the inventory alone
// cannot make enough strong ones. A plain object (never null): item is "" when not needed.
export const UnlockSuggestion = z.object({
  item: str.describe('ONE material or tool to add, e.g. "a ball of twine"; empty string when the inventory already makes enough strong projects'),
  why: str.describe('why this single item unlocks useful projects with what they already have'),
  estPrice: num.describe('rough price of that one item in the requested currency, 0 if unknown'),
  ideas: z.array(z.object({ name: str, summary: str, uses: z.array(str).describe('the materials it uses: the new item plus owned ones') })).describe('2–4 useful projects that become possible with that one item plus the current inventory'),
});

export const IdeaResult = z.object({
  // Decided in the same call (no separate parsing request): gibberish gets no ideas.
  inputRecognized: z.boolean().describe('false when the user’s own text names no identifiable physical materials, objects or tools (gibberish, random characters, unrelated text); true otherwise, and true when there is no typed text'),
  unrecognizedReason: str.describe('one short plain sentence when inputRecognized=false, else empty'),
  ideas: z.array(ProductIdea),
  enoughForStrongProjects: z.boolean().describe('false when these exact materials and tools cannot make at least 3 genuinely useful, realistic products'),
  unlock: UnlockSuggestion,
  notes: str,
});

const Cuboid = z.object({ x: num, y: num, z: num, sx: num, sy: num, sz: num });

export const BuildPlan = z.object({
  summary: str,
  overall: z.object({ length: num, width: num, height: num, unit: z.literal('mm') }),
  designConstraints: z.array(str),
  tolerances: z.array(str),
  assumptions: z.array(z.object({ text: str, needsMeasurement: z.boolean() })),
  components: z.array(
    z.object({
      id: str,
      name: str,
      material: str,
      quantity: num,
      cutLength: num.nullable(),
      cutWidth: num.nullable(),
      thickness: num.nullable(),
      role: str,
      fromInventory: str.nullable().describe('exact inventory item name this is cut from, or null if bought'),
      instances: z.array(Cuboid).describe('one axis-aligned cuboid per placed piece, in mm, for the assembly view'),
    })
  ),
  bom: z.array(
    z.object({
      name: str,
      quantity: num,
      unit: str,
      material: str,
      spec: str,
      unitPrice: num,
      role: str,
      essential: z.boolean().describe('false for optional upgrades (finish, felt pads…) that are not needed to build it'),
      inventoryItem: str.nullable().describe('exact name of the inventory item this comes from, or null if the user does not own it'),
      adaptation: str.nullable().describe('how an owned item must be cut/adjusted, or null'),
      substitutes: z.array(z.object({ inventoryItem: str, note: str })).describe('owned items that can SAFELY do the same job'),
      whyNeeded: str,
    })
  ),
  tools: z.array(str),
  safety: z.array(str),
  riskFlags: z.array(z.object({ level: z.enum(['info', 'caution', 'high']), text: str })),
  steps: z.array(
    z.object({
      title: str,
      objective: str,
      components: z.array(str).describe('component ids used in this step'),
      tools: z.array(str),
      measurements: z.array(str),
      instructions: str,
      orientation: str,
      connections: str,
      alignmentCheck: str,
      commonMistakes: z.array(str),
      expectedResult: str.describe('what the work should look like when this step is done'),
      sourceRefs: z.array(z.number().int()).describe('indices of research sources this step relies on'),
    })
  ),
  toolNotes: z.array(z.object({ tool: str, usedFor: str, userHasIt: z.boolean(), alternative: str.nullable().describe('a way to do the job without this tool, or null if it is genuinely required') })),
  finalInspection: z.array(str),
  suggestedPrice: num,
  packagingPerUnit: num,
  laborMinutesPerUnit: num,
});

export const ChannelResult = z.object({
  channels: z.array(
    z.object({
      name: str,
      type: str,
      fitScore: num,
      whyItFits: str,
      likelyCustomers: str,
      costs: str,
      feePctAssumption: num,
      fixedFeeAssumption: num,
      setup: str,
      difficulty: z.enum(['easy', 'moderate', 'hard']),
      listingFormat: str,
      marketingTest: str,
      risks: str,
      firstStep: str,
      regionalNote: str,
      sourceUrls: z.array(str).describe('URLs from the live research that support this channel’s availability or fees'),
    })
  ),
  launchPlan: z.object({
    title: str,
    description: str,
    keywords: z.array(str),
    photos: z.array(str),
    listingStructure: z.array(str),
    pricingStrategy: str,
    experiments: z.array(str),
    audience: str,
    checklist: z.array(str),
    kpis: z.array(str),
  }),
  caveats: str,
});

export const SourcingResult = z.object({
  options: z.array(
    z.object({
      title: str,
      supplier: str,
      url: str,
      price: num.nullable(),
      currency: str.nullable(),
      packQuantity: num.nullable(),
      shipping: str,
      delivery: str,
      specs: str,
      compatibility: str,
    })
  ),
  alternatives: z.array(str),
  notes: str,
});

export const AdvisorNarrative = z.object({
  items: z.array(z.object({ id: str, explanation: str, extraIdeas: z.array(str) })),
  overall: str,
});

// Web research results (parsed from the research model's JSON reply, then validated).
const Source = z.object({
  title: str,
  url: str,
  publisher: str,
  type: z.enum(['build_guide', 'video', 'specification', 'product_listing', 'inspiration', 'forum', 'other']),
  findings: z.array(str),
});
export const CandidateResearch = z.object({
  candidates: z.array(z.object({ index: z.number().int(), sources: z.array(Source.extend({ relevance: str })), note: str })),
});
export const ProductResearch = z.object({
  summary: str,
  sources: z.array(Source.extend({ methods: z.array(str), materials: z.array(str), differencesFromUser: str })),
  typicalDimensions: z.array(str),
  limited: z.boolean(),
  limitationNote: str,
});

// Compact selling guide for ONE product (the Sell step). Margins are computed by the app.
export const SellGuide = z.object({
  channels: z.array(z.object({
    name: str.describe('a concrete place to sell, e.g. "Etsy", "Facebook Marketplace", "local craft market"'),
    kind: z.enum(['online_marketplace', 'local_marketplace', 'social_media', 'in_person', 'own_shop', 'wholesale']),
    why: str.describe('1–2 short sentences: why this place suits THIS product'),
  })).min(1).max(3),
  listingTitle: str.describe('a clear listing title, at most 70 characters'),
  listingDescription: str.describe('3–5 short sentences for a listing: what it is, size and material, use, care'),
  priceLow: num.describe('a cautious low price per unit in the requested currency'),
  priceHigh: num.describe('a cautious high price per unit in the requested currency'),
  priceReason: str.describe('one sentence: what the price range is based on'),
  nextAction: str.describe('one concrete first step to make the first sale'),
});
