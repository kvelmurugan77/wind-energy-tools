// ============================================================
// Wind Flow Model - AEP Calculator
// Self-contained module: Annual Energy Production using Weibull × Power Curve
// No imports from other local windflow modules
// ============================================================

/**
 * Weibull probability density function
 */
function weibullPDF(u: number, A: number, k: number): number {
  if (u <= 0 || A <= 0 || k <= 0) return 0;
  const ratio = u / A;
  return (k / A) * Math.pow(ratio, k - 1) * Math.exp(-Math.pow(ratio, k));
}

/**
 * Linear interpolation of power curve
 */
function interpolatePower(
  windSpeed: number,
  powerCurve: { windSpeed: number; power: number }[]
): number {
  if (powerCurve.length === 0) return 0;
  if (windSpeed <= powerCurve[0].windSpeed) return 0;
  if (windSpeed >= powerCurve[powerCurve.length - 1].windSpeed) return 0;
  for (let i = 0; i < powerCurve.length - 1; i++) {
    if (
      windSpeed >= powerCurve[i].windSpeed &&
      windSpeed <= powerCurve[i + 1].windSpeed
    ) {
      const span = powerCurve[i + 1].windSpeed - powerCurve[i].windSpeed;
      if (span === 0) return powerCurve[i].power;
      const fraction = (windSpeed - powerCurve[i].windSpeed) / span;
      return (
        powerCurve[i].power +
        fraction * (powerCurve[i + 1].power - powerCurve[i].power)
      );
    }
  }
  return 0;
}

// ---- Exported types ----

export interface Losses {
  wake: number;
  electrical: number;
  availability: number;
  environmental: number;
}

export interface AEPUncertaintySource {
  name: string;
  value: number;
}

export interface AEPResult {
  grossAEP: number;
  netAEP: number;
  capacityFactor: number;
  fullLoadHours: number;
  meanPower: number;
  losses: Losses;
}

export interface UncertaintyResult {
  p90AEP: number;
  p75AEP: number;
  p50AEP: number;
  totalUncertainty: number;
}

export interface WaterfallStep {
  label: string;
  value: number;
  type: 'start' | 'loss' | 'result';
}

/**
 * Calculate Annual Energy Production
 *
 * Numerically integrates P(v) × weibullPDF(v, A, K) dv from 0 to 30 m/s
 * in 0.5 m/s steps. Applies cascading losses to derive net AEP.
 */
export function calculateAEP(
  weibullA: number,
  weibullK: number,
  powerCurve: { windSpeed: number; power: number }[],
  totalRatedPower: number,
  losses: Losses
): AEPResult {
  // Numerical integration from 0 to 30 m/s in 0.5 m/s steps
  const dv = 0.5;
  const steps = 60;
  let integral = 0;

  for (let i = 0; i <= steps; i++) {
    const v = i * dv;
    const pdf = weibullPDF(v, weibullA, weibullK);
    const power = interpolatePower(v, powerCurve);
    integral += power * pdf * dv; // kW (mean power contribution)
  }

  const grossAEP = integral * 8760; // kWh

  // Cascading losses
  const netAEP =
    grossAEP *
    (1 - losses.wake) *
    (1 - losses.electrical) *
    (1 - losses.availability) *
    (1 - losses.environmental);

  const capacityFactor = netAEP / (totalRatedPower * 8760);
  const fullLoadHours = capacityFactor * 8760;
  const meanPower = netAEP / 8760;

  return {
    grossAEP,
    netAEP,
    capacityFactor,
    fullLoadHours,
    meanPower,
    losses,
  };
}

/**
 * Calculate P90 / P75 / P50 uncertainty bands
 *
 * Combined uncertainty = sqrt(sum of value²) via root-sum-square.
 */
export function calculateUncertainty(
  netAEP: number,
  uncertaintySources: AEPUncertaintySource[]
): UncertaintyResult {
  let sumSquares = 0;
  for (const src of uncertaintySources) {
    sumSquares += src.value * src.value;
  }
  const totalUncertainty = Math.sqrt(sumSquares);

  const p90AEP = netAEP * (1 - 1.28 * totalUncertainty);
  const p75AEP = netAEP * (1 - 0.674 * totalUncertainty);
  const p50AEP = netAEP;

  return {
    p90AEP,
    p75AEP,
    p50AEP,
    totalUncertainty,
  };
}

/**
 * Monthly energy distribution with sinusoidal seasonal pattern
 *
 * month factor = 1 + 0.15 × sin(2π × (month - 1) / 12)
 * Normalized so the 12 months sum to netAEP.
 */
export function monthlyEnergyDistribution(netAEP: number): number[] {
  const factors: number[] = [];
  let factorSum = 0;

  for (let month = 0; month < 12; month++) {
    const factor = 1 + 0.15 * Math.sin((2 * Math.PI * month) / 12);
    factors.push(factor);
    factorSum += factor;
  }

  return factors.map((f) => (netAEP * f) / factorSum);
}

/**
 * Generate waterfall chart data for loss breakdown
 *
 * Returns ordered steps: Gross AEP → each loss → Net AEP
 */
export function aepWaterfall(
  grossAEP: number,
  losses: Losses
): WaterfallStep[] {
  const steps: WaterfallStep[] = [
    { label: 'Gross AEP', value: grossAEP, type: 'start' },
  ];

  const lossItems: { label: string; value: number }[] = [
    { label: 'Wake Losses', value: losses.wake },
    { label: 'Electrical Losses', value: losses.electrical },
    { label: 'Availability Losses', value: losses.availability },
    { label: 'Environmental Losses', value: losses.environmental },
  ];

  let running = grossAEP;

  for (const item of lossItems) {
    const lossAmount = running * item.value;
    running -= lossAmount;
    steps.push({ label: item.label, value: -lossAmount, type: 'loss' });
  }

  steps.push({ label: 'Net AEP', value: running, type: 'result' });

  return steps;
}

// ---- Backward-compatible exports for API route ----

const NUM_SECTORS_COMPAT = 12;

interface TurbineModelCompat {
  powerCurve: { windSpeed: number; power: number }[];
  ratedPower: number;
}

/**
 * Sector-based gross AEP (used by API route)
 */
export function calculateGrossAEP(
  turbine: TurbineModelCompat,
  sectorA: number[],
  sectorK: number[],
  sectorFreq: number[]
): {
  totalAEP: number;
  sectorAEP: number[];
  capacityFactor: number;
} {
  let totalAEP = 0;
  const sectorAEP: number[] = [];

  for (let s = 0; s < NUM_SECTORS_COMPAT; s++) {
    if (sectorA[s] <= 0 || sectorFreq[s] <= 0) {
      sectorAEP.push(0);
      continue;
    }

    const dv = 0.5;
    const steps = 60;
    let energySum = 0;

    for (let i = 0; i <= steps; i++) {
      const v = i * dv;
      const pdf = weibullPDF(v, sectorA[s], sectorK[s]);
      const power = interpolatePower(v, turbine.powerCurve);
      energySum += power * pdf * dv;
    }

    const aep = sectorFreq[s] * 8760 * energySum / 1000; // MWh
    sectorAEP.push(aep);
    totalAEP += aep;
  }

  const capacityFactor =
    turbine.ratedPower > 0
      ? (totalAEP * 1000) / (turbine.ratedPower * 8760) * 100
      : 0;

  return {
    totalAEP: Math.round(totalAEP * 100) / 100,
    sectorAEP: sectorAEP.map((v) => Math.round(v * 100) / 100),
    capacityFactor: Math.round(capacityFactor * 100) / 100,
  };
}

/**
 * Sector-based net AEP with wake-affected speeds (used by API route)
 */
export function calculateNetAEP(
  turbine: TurbineModelCompat,
  wakeSpeeds: number[],
  wakeFrequencies: number[],
  wakeK: number[]
): {
  totalNetAEP: number;
  sectorNetAEP: number[];
  netCapacityFactor: number;
} {
  let totalNetAEP = 0;
  const sectorNetAEP: number[] = [];

  for (let s = 0; s < NUM_SECTORS_COMPAT; s++) {
    if (wakeSpeeds[s] <= 0 || wakeFrequencies[s] <= 0) {
      sectorNetAEP.push(0);
      continue;
    }

    const dv = 0.5;
    const steps = 60;
    let energySum = 0;

    for (let i = 0; i <= steps; i++) {
      const v = i * dv;
      const pdf = weibullPDF(v, wakeSpeeds[s], wakeK[s]);
      const power = interpolatePower(v, turbine.powerCurve);
      energySum += power * pdf * dv;
    }

    const aep = wakeFrequencies[s] * 8760 * energySum / 1000; // MWh
    sectorNetAEP.push(aep);
    totalNetAEP += aep;
  }

  const netCapacityFactor =
    turbine.ratedPower > 0
      ? (totalNetAEP * 1000) / (turbine.ratedPower * 8760) * 100
      : 0;

  return {
    totalNetAEP: Math.round(totalNetAEP * 100) / 100,
    sectorNetAEP: sectorNetAEP.map((v) => Math.round(v * 100) / 100),
    netCapacityFactor: Math.round(netCapacityFactor * 100) / 100,
  };
}
