/**
 * @module aep
 * Annual Energy Production (AEP) calculation using Weibull distribution and power curves.
 *
 * Provides functions for:
 * - Gross and net AEP computation from Weibull wind statistics and turbine power curves
 * - Directional (sector-by-sector) AEP analysis
 * - Uncertainty analysis (P90, P75, P50)
 * - Monthly energy production distribution
 * - Waterfall breakdown of losses from gross to net AEP
 *
 * All functions are pure with no side effects and zero external dependencies.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hours in a standard year */
const HOURS_PER_YEAR = 8760;

/** Minimum wind speed bin (m/s) */
const MIN_WIND_SPEED = 0;

/** Maximum wind speed bin (m/s) */
const MAX_WIND_SPEED = 30;

/** Wind speed bin width (m/s) */
const BIN_WIDTH = 0.5;

/** Default monthly wind variation factors (Northern Hemisphere mid-latitude) */
const DEFAULT_MONTHLY_VARIATION: number[] = [
  8.0, 7.5, 8.5, 9.0, 10.0, 9.5,
  8.5, 8.0, 9.0,  9.5,  9.5,  8.5,
];

/** Month abbreviations */
const MONTH_LABELS: string[] = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Result of an AEP calculation containing gross/net energy, capacity metrics,
 * loss breakdown, monthly production, and frequency distribution detail.
 */
export interface AEPResult {
  /** Annual Energy Production after losses (MWh) */
  aep: number;
  /** Annual Energy Production after losses (MWh) — alias for {@link aep} */
  netAEP: number;
  /** Annual Energy Production before losses (MWh) */
  grossAEP: number;
  /** Ratio of net annual energy to rated annual energy (0–1) */
  capacityFactor: number;
  /** Equivalent hours per year at rated power */
  fullLoadHours: number;
  /** Average power output across the year (kW) */
  meanPower: number;
  /** Breakdown of energy losses expressed as fractions (0–1) */
  losses: {
    /** Wake loss fraction */
    wake: number;
    /** Electrical loss fraction */
    electrical: number;
    /** Availability (downtime) loss fraction */
    availability: number;
    /** Environmental / curtailment loss fraction */
    environmental: number;
    /** Total combined loss fraction */
    total: number;
  };
  /** Monthly energy production */
  annualProduction: { month: string; gwh: number }[];
  /** Per wind-speed-bin detail */
  frequencyDistribution: {
    bin: number;
    frequency: number;
    power: number;
    energy: number;
  }[];
}

/**
 * Result of a directional (sector-by-sector) AEP calculation.
 */
export interface DirectionalAEPResult {
  /** Summed AEP across all sectors (MWh) */
  totalAEP: number;
  /** Per-sector AEP detail */
  sectorAEP: {
    sector: number;
    angle: number;
    aep: number;
    frequency: number;
  }[];
}

/**
 * A single source of uncertainty used in uncertainty analysis.
 */
export interface UncertaintySource {
  /** Human-readable name (e.g. "Wind speed measurement") */
  name: string;
  /** Uncertainty expressed as a fraction (e.g. 0.05 = 5 %) */
  value: number;
}

/**
 * Result of a P-value uncertainty analysis.
 */
export interface UncertaintyResult {
  /** Combined (1-sigma) uncertainty as a percentage (e.g. 8.5) */
  totalUncertainty: number;
  /** P90 estimate of annual energy production (MWh) */
  p90AEP: number;
  /** P75 estimate of annual energy production (MWh) */
  p75AEP: number;
  /** P50 (expected) annual energy production (MWh) */
  p50AEP: number;
  /** Per-source breakdown with individual contribution to combined uncertainty */
  sources: {
    name: string;
    value: number;
    contribution: number;
  }[];
}

/**
 * A single step in an AEP waterfall chart — either a starting value or a loss.
 */
export interface AEPWaterfallStep {
  /** Label for the step (e.g. "Gross", "Wake losses") */
  name: string;
  /** Energy value for this step (MWh) */
  value: number;
  /** `true` when this step represents a deduction from gross AEP */
  loss: boolean;
  /** Cumulative AEP after this step is applied (MWh) */
  cumulative: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Evaluate the Weibull probability density function.
 *
 * f(u) = (k / A) · (u / A)^(k-1) · exp(-(u / A)^k)
 *
 * @param u - Wind speed (m/s)
 * @param k - Weibull shape parameter (dimensionless)
 * @param A - Weibull scale parameter (m/s)
 * @returns Probability density at wind speed *u*
 */
function weibullPDF(u: number, k: number, A: number): number {
  if (u <= 0 || A <= 0 || k <= 0) return 0;
  const ratio = u / A;
  return (k / A) * Math.pow(ratio, k - 1) * Math.exp(-Math.pow(ratio, k));
}

/**
 * Linearly interpolate power from a discrete power curve.
 *
 * @param windSpeed - Wind speed to look up (m/s)
 * @param powerCurve - Array of `{ windSpeed, power }` pairs sorted by wind speed
 * @returns Interpolated power output (kW)
 */
function interpolatePower(
  windSpeed: number,
  powerCurve: { windSpeed: number; power: number }[],
): number {
  if (powerCurve.length === 0) return 0;

  // Below cut-in
  if (windSpeed <= powerCurve[0].windSpeed) return 0;

  // Above cut-out
  if (windSpeed >= powerCurve[powerCurve.length - 1].windSpeed) return 0;

  // Find surrounding data points
  let lowerIdx = 0;
  for (let i = 0; i < powerCurve.length - 1; i++) {
    if (
      windSpeed >= powerCurve[i].windSpeed &&
      windSpeed <= powerCurve[i + 1].windSpeed
    ) {
      lowerIdx = i;
      break;
    }
  }

  const lower = powerCurve[lowerIdx];
  const upper = powerCurve[lowerIdx + 1];

  // Avoid division by zero
  const dSpeed = upper.windSpeed - lower.windSpeed;
  if (dSpeed === 0) return lower.power;

  const fraction = (windSpeed - lower.windSpeed) / dSpeed;
  return lower.power + fraction * (upper.power - lower.power);
}

/**
 * Build default loss object with zeros.
 */
function defaultLosses(
  losses?: {
    wake?: number;
    electrical?: number;
    availability?: number;
    environmental?: number;
  },
): Required<{ wake: number; electrical: number; availability: number; environmental: number }> {
  return {
    wake: losses?.wake ?? 0,
    electrical: losses?.electrical ?? 0,
    availability: losses?.availability ?? 0,
    environmental: losses?.environmental ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate Annual Energy Production from Weibull wind distribution parameters
 * and a turbine power curve.
 *
 * The function iterates over 0.5 m/s wind-speed bins from 0 to 30 m/s. For each
 * bin the Weibull PDF is evaluated at the bin-centre wind speed, the
 * corresponding power is interpolated from the power curve, and the bin energy
 * is computed as `frequency × power`. Gross AEP is the sum of all bin energies.
 * Losses (wake, electrical, availability, environmental) are then applied to
 * derive net AEP and associated metrics.
 *
 * @param weibullA - Weibull scale parameter (m/s)
 * @param weibullK - Weibull shape parameter (dimensionless)
 * @param powerCurve - Discrete power curve: array of `{ windSpeed, power }` (kW)
 * @param ratedPower - Turbine rated power (kW)
 * @param losses - Optional loss fractions (0–1) for each category
 * @returns Comprehensive AEP result object
 *
 * @example
 * ```ts
 * const result = calculateAEP(8.5, 2.1, powerCurve, 3000, {
 *   wake: 0.08,
 *   electrical: 0.02,
 *   availability: 0.03,
 *   environmental: 0.01,
 * });
 * console.log(result.aep);        // net AEP in MWh
 * console.log(result.capacityFactor); // e.g. 0.35
 * ```
 */
export function calculateAEP(
  weibullA: number,
  weibullK: number,
  powerCurve: { windSpeed: number; power: number }[],
  ratedPower: number,
  losses?: {
    wake?: number;
    electrical?: number;
    availability?: number;
    environmental?: number;
  },
): AEPResult {
  const lossDefaults = defaultLosses(losses);
  const totalLossFraction =
    1 -
    (1 - lossDefaults.wake) *
      (1 - lossDefaults.electrical) *
      (1 - lossDefaults.availability) *
      (1 - lossDefaults.environmental);

  const bins: AEPResult['frequencyDistribution'] = [];
  let grossEnergyKWh = 0;

  const numBins = Math.round((MAX_WIND_SPEED - MIN_WIND_SPEED) / BIN_WIDTH);

  for (let i = 0; i <= numBins; i++) {
    const binCentre = MIN_WIND_SPEED + i * BIN_WIDTH;
    const pdf = weibullPDF(binCentre, weibullK, weibullA);
    const frequency = pdf * BIN_WIDTH * HOURS_PER_YEAR; // hours in this bin
    const power = interpolatePower(binCentre, powerCurve); // kW
    const energy = frequency * power; // kWh

    grossEnergyKWh += energy;

    bins.push({
      bin: Math.round(binCentre * 10) / 10,
      frequency: Math.round(frequency * 100) / 100,
      power: Math.round(power * 100) / 100,
      energy: Math.round(energy * 100) / 100,
    });
  }

  const grossAEP_MWh = grossEnergyKWh / 1000;
  const netAEP_MWh = grossAEP_MWh * (1 - totalLossFraction);

  const capacityFactor = ratedPower > 0
    ? netAEP_MWh / (ratedPower * HOURS_PER_YEAR / 1000)
    : 0;

  const fullLoadHours = ratedPower > 0
    ? (netAEP_MWh * 1000) / ratedPower
    : 0;

  const meanPower = netAEP_MWh * 1000 / HOURS_PER_YEAR; // kW

  // Monthly distribution
  const monthlyDist = monthlyEnergyDistribution(netAEP_MWh);
  const annualProduction: AEPResult['annualProduction'] = monthlyDist.map(
    (m) => ({ month: m.month, gwh: m.gwh }),
  );

  return {
    aep: Math.round(netAEP_MWh * 100) / 100,
    netAEP: Math.round(netAEP_MWh * 100) / 100,
    grossAEP: Math.round(grossAEP_MWh * 100) / 100,
    capacityFactor: Math.round(capacityFactor * 10000) / 10000,
    fullLoadHours: Math.round(fullLoadHours * 100) / 100,
    meanPower: Math.round(meanPower * 100) / 100,
    losses: {
      wake: lossDefaults.wake,
      electrical: lossDefaults.electrical,
      availability: lossDefaults.availability,
      environmental: lossDefaults.environmental,
      total: Math.round(totalLossFraction * 10000) / 10000,
    },
    annualProduction,
    frequencyDistribution: bins,
  };
}

/**
 * Calculate directional (sector-based) Annual Energy Production.
 *
 * Each wind-direction sector carries its own Weibull parameters and directional
 * frequency. The function computes the AEP for each sector using those
 * parameters, weights the result by sector frequency, and sums to produce a
 * total directional AEP.
 *
 * @param sectorData - Array of sector definitions with Weibull *A*, *k*, and frequency
 * @param powerCurve - Turbine power curve: `{ windSpeed, power }` (kW)
 * @param ratedPower - Turbine rated power (kW)
 * @param losses - Optional loss fractions (applied uniformly to all sectors)
 * @returns Total and per-sector AEP results
 */
export function calculateDirectionalAEP(
  sectorData: { A: number; k: number; frequency: number }[],
  powerCurve: { windSpeed: number; power: number }[],
  ratedPower: number,
  losses?: AEPResult['losses'],
): DirectionalAEPResult {
  let totalAEP = 0;

  const sectorWidth = 360 / sectorData.length;

  const sectorAEP = sectorData.map((sector, idx) => {
    // Calculate AEP for this sector's Weibull distribution
    const result = calculateAEP(sector.A, sector.k, powerCurve, ratedPower, {
      wake: losses?.wake,
      electrical: losses?.electrical,
      availability: losses?.availability,
      environmental: losses?.environmental,
    });

    // Weight by sector directional frequency
    const sectorAEP_MWh = result.netAEP * sector.frequency;

    totalAEP += sectorAEP_MWh;

    return {
      sector: idx + 1,
      angle: Math.round((idx * sectorWidth + sectorWidth / 2) * 10) / 10,
      aep: Math.round(sectorAEP_MWh * 100) / 100,
      frequency: sector.frequency,
    };
  });

  return {
    totalAEP: Math.round(totalAEP * 100) / 100,
    sectorAEP,
  };
}

/**
 * Perform an uncertainty analysis on a P50 AEP estimate.
 *
 * Individual uncertainty sources are combined in quadrature (root-sum-square)
 * to yield a total 1-sigma uncertainty, which is then used with the standard
 * normal cumulative distribution to derive P90 and P75 estimates.
 *
 * - P90 = P50 × (1 − 1.282 × σ)
 * - P75 = P50 × (1 − 0.674 × σ)
 *
 * @param p50AEP - P50 (expected) AEP value (MWh)
 * @param sources - Array of individual uncertainty sources
 * @returns Uncertainty analysis result with P-values and source contributions
 *
 * @example
 * ```ts
 * const uncertainty = calculateUncertainty(12_500, [
 *   { name: 'Wind speed',       value: 0.05 },
 *   { name: 'Wind direction',   value: 0.03 },
 *   { name: 'Power curve',      value: 0.02 },
 *   { name: 'Wake model',       value: 0.03 },
 *   { name: 'Losses',           value: 0.02 },
 * ]);
 * console.log(uncertainty.p90AEP); // MWh
 * ```
 */
export function calculateUncertainty(
  p50AEP: number,
  sources: UncertaintySource[],
): UncertaintyResult {
  // Sum of squares
  const sumSquares = sources.reduce((acc, s) => acc + s.value * s.value, 0);
  const totalSigma = Math.sqrt(sumSquares); // combined 1-sigma uncertainty

  // Percentages
  const totalUncertaintyPct = totalSigma * 100;

  // P-value multipliers from standard normal distribution
  const P90_MULTIPLIER = 1.282; // Φ⁻¹(0.90) ≈ 1.282
  const P75_MULTIPLIER = 0.674; // Φ⁻¹(0.75) ≈ 0.674

  const p90AEP = p50AEP * (1 - P90_MULTIPLIER * totalSigma);
  const p75AEP = p50AEP * (1 - P75_MULTIPLIER * totalSigma);

  // Per-source contribution (fraction of total variance)
  const sourceBreakdown = sources.map((s) => ({
    name: s.name,
    value: s.value,
    contribution: totalSigma > 0 ? Math.round(((s.value * s.value) / sumSquares) * 10000) / 10000 : 0,
  }));

  return {
    totalUncertainty: Math.round(totalUncertaintyPct * 100) / 100,
    p90AEP: Math.round(Math.max(0, p90AEP) * 100) / 100,
    p75AEP: Math.round(Math.max(0, p75AEP) * 100) / 100,
    p50AEP: Math.round(p50AEP * 100) / 100,
    sources: sourceBreakdown,
  };
}

/**
 * Distribute annual energy production across 12 months.
 *
 * A set of monthly variation factors controls the relative share of each month.
 * The default factors follow a typical Northern Hemisphere mid-latitude wind
 * pattern (stronger winds in winter / spring).
 *
 * @param annualAEP - Total annual energy production (MWh)
 * @param monthlyVariation - Optional 12-element array of relative monthly weights.
 *   Defaults to `[8.0, 7.5, 8.5, 9.0, 10.0, 9.5, 8.5, 8.0, 9.0, 9.5, 9.5, 8.5]`
 * @returns Array of monthly energy values with month label, GWh, MWh, and percentage
 */
export function monthlyEnergyDistribution(
  annualAEP: number,
  monthlyVariation: number[] = DEFAULT_MONTHLY_VARIATION,
): { month: string; gwh: number; mwh: number; percentage: number }[] {
  if (monthlyVariation.length !== 12) {
    throw new Error('monthlyVariation must contain exactly 12 elements');
  }

  const totalWeight = monthlyVariation.reduce((a, b) => a + b, 0);

  return monthlyVariation.map((weight, idx) => {
    const fraction = weight / totalWeight;
    const mwh = annualAEP * fraction;
    return {
      month: MONTH_LABELS[idx],
      gwh: Math.round(mwh / 1000 * 10000) / 10000,
      mwh: Math.round(mwh * 100) / 100,
      percentage: Math.round(fraction * 10000) / 10000,
    };
  });
}

/**
 * Generate a waterfall breakdown of AEP losses.
 *
 * Produces an ordered list of steps starting from gross AEP, applying each
 * loss category in sequence, and ending with net AEP. Suitable for rendering
 * as a waterfall chart.
 *
 * @param grossAEP - Gross annual energy production before losses (MWh)
 * @param losses - Loss fractions (0–1) for each category
 * @returns Ordered array of waterfall steps
 *
 * @example
 * ```ts
 * const steps = aepWaterfall(15_000, {
 *   wake: 0.08,
 *   electrical: 0.02,
 *   availability: 0.03,
 *   environmental: 0.01,
 * });
 * // steps[0] = { name: 'Gross AEP', value: 15000, loss: false, cumulative: 15000 }
 * // steps[1] = { name: 'Wake losses', value: 1200, loss: true, cumulative: 13800 }
 * // ...
 * // steps[5] = { name: 'Net AEP', value: 13260, loss: false, cumulative: 13260 }
 * ```
 */
export function aepWaterfall(
  grossAEP: number,
  losses: {
    wake?: number;
    electrical?: number;
    availability?: number;
    environmental?: number;
  },
): AEPWaterfallStep[] {
  const lossDefaults = defaultLosses(losses);

  const steps: AEPWaterfallStep[] = [];

  // Step 0: Gross AEP
  steps.push({
    name: 'Gross AEP',
    value: Math.round(grossAEP * 100) / 100,
    loss: false,
    cumulative: Math.round(grossAEP * 100) / 100,
  });

  let running = grossAEP;

  // Ordered loss steps
  const lossSteps: { key: string; label: string; fraction: number }[] = [
    { key: 'wake', label: 'Wake losses', fraction: lossDefaults.wake },
    { key: 'electrical', label: 'Electrical losses', fraction: lossDefaults.electrical },
    { key: 'availability', label: 'Availability losses', fraction: lossDefaults.availability },
    { key: 'environmental', label: 'Other losses', fraction: lossDefaults.environmental },
  ];

  for (const step of lossSteps) {
    if (step.fraction > 0) {
      const lossMWh = running * step.fraction;
      running -= lossMWh;

      steps.push({
        name: step.label,
        value: Math.round(lossMWh * 100) / 100,
        loss: true,
        cumulative: Math.round(running * 100) / 100,
      });
    }
  }

  // Final step: Net AEP
  steps.push({
    name: 'Net AEP',
    value: Math.round(running * 100) / 100,
    loss: false,
    cumulative: Math.round(running * 100) / 100,
  });

  return steps;
}
