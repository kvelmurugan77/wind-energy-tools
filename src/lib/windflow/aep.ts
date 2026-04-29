// ============================================================
// Wind Flow Model - AEP Calculator
// Calculates Annual Energy Production using Weibull × Power Curve
// ============================================================

import { TurbineModel, PowerCurvePoint, SectorData } from './types';
import { weibullPDF, lnGamma, NUM_SECTORS, AIR_DENSITY } from './statistics';
import { getPowerAtSpeed } from './power-curves';
import { calculateFarmWakeLosses } from './wake-model';

/**
 * Calculate AEP for a single sector
 * AEP_sector = f_sector × 8760 × integral(P(v) × f_Weibull(v) dv, 0, inf)
 * 
 * Numerical integration using trapezoidal rule from 0 to 30 m/s
 */
export function calculateSectorAEP(
  turbine: TurbineModel,
  weibullA: number,
  weibullK: number,
  sectorFrequency: number
): number {
  if (weibullA <= 0 || sectorFrequency <= 0) return 0;

  // Numerical integration from 0 to 30 m/s in 0.5 m/s steps
  let energySum = 0;
  const dv = 0.5;
  const steps = 60; // 0 to 30 m/s

  for (let i = 0; i <= steps; i++) {
    const v = i * dv;
    const pdf = weibullPDF(v, weibullA, weibullK);
    const power = getPowerAtSpeed(turbine.powerCurve, v); // kW
    energySum += power * pdf * dv; // kW (energy density per hour)
  }

  // AEP in MWh for this sector
  const sectorAEP = sectorFrequency * 8760 * energySum / 1000; // MWh
  return sectorAEP;
}

/**
 * Calculate gross AEP for a turbine given wind climate parameters
 * Returns per-sector AEP values and total
 */
export function calculateGrossAEP(
  turbine: TurbineModel,
  sectorA: number[],
  sectorK: number[],
  sectorFreq: number[]
): {
  totalAEP: number;      // MWh/yr
  sectorAEP: number[];   // MWh/yr per sector
  capacityFactor: number;
} {
  let totalAEP = 0;
  const sectorAEP: number[] = [];

  for (let s = 0; s < NUM_SECTORS; s++) {
    const aep = calculateSectorAEP(turbine, sectorA[s], sectorK[s], sectorFreq[s]);
    sectorAEP.push(aep);
    totalAEP += aep;
  }

  // Capacity factor = AEP / (rated_power × 8760)
  const capacityFactor = (totalAEP * 1000) / (turbine.ratedPower * 8760) * 100;

  return {
    totalAEP: Math.round(totalAEP * 100) / 100,
    sectorAEP: sectorAEP.map(v => Math.round(v * 100) / 100),
    capacityFactor: Math.round(capacityFactor * 100) / 100,
  };
}

/**
 * Calculate net AEP including wake losses
 * Uses wake-affected wind speeds to recalculate power output
 */
export function calculateNetAEP(
  turbine: TurbineModel,
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

  for (let s = 0; s < NUM_SECTORS; s++) {
    if (wakeSpeeds[s] <= 0 || wakeFrequencies[s] <= 0) {
      sectorNetAEP.push(0);
      continue;
    }

    // For each sector, use the wake-affected wind speed
    // Reconstruct Weibull parameters for wake-affected conditions
    // The wake primarily reduces the mean speed; k stays similar
    const wakeA = wakeSpeeds[s]; // Approximate A as wake-affected mean for this sector
    const wK = wakeK[s];

    const aep = calculateSectorAEP(turbine, wakeA, wK, wakeFrequencies[s]);
    sectorNetAEP.push(aep);
    totalNetAEP += aep;
  }

  const netCapacityFactor = (totalNetAEP * 1000) / (turbine.ratedPower * 8760) * 100;

  return {
    totalNetAEP: Math.round(totalNetAEP * 100) / 100,
    sectorNetAEP: sectorNetAEP.map(v => Math.round(v * 100) / 100),
    netCapacityFactor: Math.round(netCapacityFactor * 100) / 100,
  };
}

/**
 * Calculate uncertainty in AEP estimate
 * Based on IEC 61400-12-1 / IEC 61400-15 methodology
 */
export function calculateAEPUncertainty(
  grossAEP: number,
  uncertainties: {
    windMeasurement: number;    // e.g., 2-5%
    windVariability: number;    // e.g., 5-10% (inter-annual)
    flowModel: number;          // e.g., 3-10%
    wakeModel: number;          // e.g., 2-5%
    powerCurve: number;         // e.g., 2-3%
    losses: number;             // e.g., 1-2%
  }
): number {
  // Combined uncertainty (RSS)
  const combined = Math.sqrt(
    uncertainties.windMeasurement ** 2 +
    uncertainties.windVariability ** 2 +
    uncertainties.flowModel ** 2 +
    uncertainties.wakeModel ** 2 +
    uncertainties.powerCurve ** 2 +
    uncertainties.losses ** 2
  );

  return Math.round(combined * 100) / 100; // percent
}
