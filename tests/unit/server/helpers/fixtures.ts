import type { PlausibilityConfig } from '@/server/plausibility';

// Made up for tests and deliberately not the production values, which never enter the repository.
export const PLAUSIBILITY_FIXTURE: PlausibilityConfig = {
  gateWpmCx: 12500,
  minKeys: 180,
  ikiCvMin: 0.21,
  logIkiKurtosisMin: -0.8,
  holdCvMin: 0.12,
  meanHoldMinMs: 33,
  shortHoldMaxShare: 0.25,
  missingKeyupMaxShare: 0.12,
  shortIkiMaxShare: 0.18,
  ikiEntropyMinBits: 2.4,
  peakRatioMax: 2,
  ceilingCx: { long: 31000, short: 36000 },
  holdAboveCx: 22000,
  paceMultiple: 1.3,
  todayPaceMultiple: 1.12,
  paceMinRuns: 8,
  bestMultiple: 1.4,
  bestMinRuns: 15,
  boardTop: 50,
  stampEarlyMs: 2500,
  stampLateMs: 4000,
};

export const PLAUSIBILITY_FIXTURE_JSON = JSON.stringify(PLAUSIBILITY_FIXTURE);
