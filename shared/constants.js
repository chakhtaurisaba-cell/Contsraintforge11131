export const PROJECT_STATUSES = [
  { id: 'idea', label: 'Idea' },
  { id: 'feasibility', label: 'Planning' },
  { id: 'design', label: 'Design' },
  { id: 'materials_needed', label: 'Materials needed' },
  { id: 'ready_to_build', label: 'Ready to build' },
  { id: 'in_production', label: 'In production' },
  { id: 'ready_to_sell', label: 'Ready to sell' },
  { id: 'listed', label: 'Listed for sale' },
  { id: 'selling', label: 'Selling' },
  { id: 'needs_improvement', label: 'Needs improvement' },
  { id: 'archived', label: 'Completed / archived' },
];

export const statusLabel = (id) => PROJECT_STATUSES.find((s) => s.id === id)?.label || id;

// How a dimension value was obtained — shown everywhere a measurement appears.
export const DIMENSION_STATUS = {
  ai_inferred: { label: 'AI estimate', tone: 'warn', note: 'Inferred from the photo without a scale reference. Treat as rough.' },
  from_marking: { label: 'From marking', tone: 'info', note: 'Read from a size printed or stamped on the item or its packaging. Check it matches the actual item.' },
  reference_calibrated: { label: 'Calibrated', tone: 'info', note: 'Computed from a known reference in the same image plane.' },
  user_confirmed: { label: 'User confirmed', tone: 'ok', note: 'Entered or confirmed by you.' },
  verified: { label: 'Verified', tone: 'ok', note: 'Physically measured and marked verified.' },
};

export const CURRENCIES = ['GEL', 'USD', 'EUR', 'GBP', 'TRY', 'UAH', 'PLN', 'CAD', 'AUD'];

export const REGIONS = [
  { id: 'GE', label: 'Georgia', currency: 'GEL' },
  { id: 'US', label: 'United States', currency: 'USD' },
  { id: 'GB', label: 'United Kingdom', currency: 'GBP' },
  { id: 'DE', label: 'Germany', currency: 'EUR' },
  { id: 'TR', label: 'Türkiye', currency: 'TRY' },
  { id: 'PL', label: 'Poland', currency: 'PLN' },
  { id: 'UA', label: 'Ukraine', currency: 'UAH' },
  { id: 'CA', label: 'Canada', currency: 'CAD' },
  { id: 'AU', label: 'Australia', currency: 'AUD' },
  { id: 'OTHER', label: 'Other', currency: 'USD' },
];
