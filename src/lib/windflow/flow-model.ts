// ============================================================
// Wind Flow Model - Flow Extrapolation
// Extrapolates wind climate from mast position to WTG positions
// Uses log-law / power-law wind profile for vertical extrapolation
// Simple roughness-based model for horizontal variation
// ============================================================

import { WindClimate, TurbineLayout, MastConfig, TurbineResult, SectorData } from './types';
import { fitWeibull, weibullMean, weibullPDF, lnGamma, getSector, NUM_SECTORS } from './statistics';
import { getTurbineModel } from './power-curves';

/**
 * Log-law wind profile: v(z) = v(z_ref) * ln(z/z0) / ln(z_ref/z0)
 * Used for vertical extrapolation between measurement height and hub height
 */
export function logLawExtrapolation(
  speedAtRef: number,
  zRef: number,
  zTarget: number,
  z0: number
): number {
  if (zRef <= 0 || zTarget <= 0 || z0 <= 0) return speedAtRef;
  if (zRef === zTarget) return speedAtRef;

  const ratio = Math.log(zTarget / z0) / Math.log(zRef / z0);
  return speedAtRef * ratio;
}

/**
 * Power-law wind profile: v(z) = v(z_ref) * (z/z_ref)^alpha
 * Default alpha = 0.143 (1/7) for neutral stability over open terrain
 */
export function powerLawExtrapolation(
  speedAtRef: number,
  zRef: number,
  zTarget: number,
  alpha: number = 0.143
): number {
  if (zRef <= 0 || zTarget <= 0) return speedAtRef;
  if (zRef === zTarget) return speedAtRef;
  return speedAtRef * Math.pow(zTarget / zRef, alpha);
}

/**
 * Surface roughness length based on terrain description
 */
export function getRoughnessLength(terrainType: string): number {
  const roughnessMap: Record<string, number> = {
    'open_sea': 0.0002,
    'coastal': 0.005,
    'open_flat': 0.03,
    'farmland': 0.05,
    'suburban': 0.5,
    'forest': 1.0,
    'urban': 1.5,
  };
  return roughnessMap[terrainType.toLowerCase()] || 0.03;
}

/**
 * Power law exponent from roughness length
 * alpha ≈ 1 / ln(z_ref/z0) (approximate)
 */
export function alphaFromRoughness(z0: number, zRef: number = 100): number {
  return 1 / Math.log(zRef / z0);
}

/**
 * Simple horizontal wind speed adjustment based on terrain roughness change
 * v_2 = v_1 * ln(z/z0_2) / ln(z/z0_1)
 * Applied at hub height z
 */
export function roughnessCorrection(
  speedAtZ0_1: number,
  z0_source: number,
  z0_target: number,
  height: number
): number {
  if (z0_source === z0_target) return speedAtZ0_1;
  if (z0_target <= 0) z0_target = 0.0002;
  if (z0_source <= 0) z0_source = 0.0002;
  
  const ratio = Math.log(height / z0_target) / Math.log(height / z0_source);
  return speedAtZ0_1 * ratio;
}

/**
 * Calculate wind resource at a WTG position
 * 
 * Steps:
 * 1. Get wind climate at mast (frequency distribution, Weibull params per sector)
 * 2. For each sector, extrapolate wind speed from mast measurement height to WTG hub height
 * 3. Apply roughness correction if mast and WTG have different roughness
 * 4. Optionally apply distance-based adjustment (simple model for terrain effects)
 * 5. Refit Weibull parameters at WTG position
 */
export function calculateFlowAtPosition(
  windClimate: WindClimate,
  turbine: TurbineLayout,
  mastConfig: MastConfig,
  flowModel: 'log-law' | 'power-law' = 'log-law',
  terrainRoughness: number = 0.03
): {
  sectorSpeeds: number[];
  sectorFrequencies: number[];
  weibullA: number;
  weibullK: number;
  meanSpeed: number;
  powerDensity: number;
} {
  const sectorSpeeds: number[] = [];
  const sectorFrequencies: number[] = [];
  const allExtrapolatedSpeeds: number[] = [];

  for (let s = 0; s < NUM_SECTORS; s++) {
    const sector = windClimate.sectors[s];
    const freq = sector.frequency;

    // Extrapolate mean wind speed from measurement height to hub height
    let speedAtHub: number;

    if (flowModel === 'log-law') {
      speedAtHub = logLawExtrapolation(
        sector.meanSpeed,
        mastConfig.measurementHeight,
        turbine.hubHeight,
        terrainRoughness
      );
    } else {
      // Power law with alpha derived from roughness
      const alpha = alphaFromRoughness(terrainRoughness, turbine.hubHeight);
      speedAtHub = powerLawExtrapolation(
        sector.meanSpeed,
        mastConfig.measurementHeight,
        turbine.hubHeight,
        alpha
      );
    }

    sectorSpeeds.push(Math.round(speedAtHub * 100) / 100);
    sectorFrequencies.push(freq);

    // Build representative speed distribution for Weibull refitting
    // Create synthetic speed samples based on Weibull distribution
    // Use the sector's Weibull parameters scaled to hub height
    const scaleRatio = speedAtHub / sector.meanSpeed;
    if (isFinite(scaleRatio) && scaleRatio > 0) {
      // Scale the Weibull A parameter
      const scaledA = sector.weibullA * scaleRatio;
      // k stays approximately the same for same terrain type
      const k = sector.weibullK;
      
      // Generate representative speeds for AEP calculation
      // Use 20 speed levels per sector weighted by frequency
      for (let v = 1; v <= 25; v += 1) {
        const count = Math.round(freq * 8760 * weibullPDF(v, scaledA, k));
        for (let i = 0; i < count; i++) {
          allExtrapolatedSpeeds.push(v);
        }
      }
    }
  }

  // Fit Weibull to all extrapolated speeds
  let weibullA = 0;
  let weibullK = 2;
  let meanSpeed = 0;
  let powerDensity = 0;

  if (allExtrapolatedSpeeds.length > 10) {
    const fitted = fitWeibull(allExtrapolatedSpeeds);
    weibullA = fitted.A;
    weibullK = fitted.k;
    meanSpeed = weibullA * Math.exp(lnGamma(1 + 1 / weibullK));
    // Power density: P = 0.5 * rho * E[v^3]
    const cubeMean = weibullA ** 3 * Math.exp(lnGamma(1 + 3 / weibullK));
    powerDensity = 0.5 * 1.225 * cubeMean;
  }

  return {
    sectorSpeeds,
    sectorFrequencies,
    weibullA: Math.round(weibullA * 100) / 100,
    weibullK: Math.round(weibullK * 1000) / 1000,
    meanSpeed: Math.round(meanSpeed * 100) / 100,
    powerDensity: Math.round(powerDensity * 100) / 100,
  };
}

/**
 * Calculate distance between two points (UTM coordinates in meters)
 */
export function distanceUTM(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * Calculate bearing from point 1 to point 2 (degrees)
 */
export function bearingUTM(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let angle = Math.atan2(dx, dy) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}
