// ============================================================
// Freestream Sector Calculation Engine
// Handles external wind farm layouts
// ============================================================

import type {
  MetMast,
  WTG,
  WindFarmLayout,
  FreestreamResult,
  SectorWakeAnalysis,
  AnalysisConfig,
} from './types';
import {
  haversineDistance,
  bearing,
  angularDeviation,
  normalizeAngle,
} from './geo';

/**
 * Perform freestream sector analysis for a mast
 * Considers all WTGs (target and external) as potential wake sources
 */
export function analyzeFreestream(
  mast: MetMast,
  allWtgs: WTG[],
  externalWindFarms: WindFarmLayout[],
  config: AnalysisConfig
): FreestreamResult {
  const numSectors = 360 / config.sectorWidth;
  const externalWtgs = externalWindFarms.flatMap((wf) => wf.turbines);
  const allPotentialWakeSources = [...allWtgs, ...externalWtgs];

  const sectorWakeAnalysis: SectorWakeAnalysis[] = [];
  const freestreamSectors: number[] = [];
  const wakeAffectedSectors: number[] = [];
  const externalWtgAnalysis: FreestreamResult['externalWtgs'] = [];

  for (let i = 0; i < numSectors; i++) {
    const direction = i * config.sectorWidth;
    const wakeSources: SectorWakeAnalysis['wakeSourceTurbines'] = [];

    for (const wtg of allPotentialWakeSources) {
      const dist = haversineDistance(mast.location, wtg.location);
      const wtgBearing = bearing(mast.location, wtg.location);
      const angDev = angularDeviation(direction, wtgBearing);
      const distInD = dist / wtg.rotorDiameter;

      // Check if this WTG could create wake at mast in this sector
      if (angDev <= config.wakeAngularThreshold && distInD <= config.wakeDistanceThresholdD) {
        const isExternal = externalWtgs.some((ew) => ew.id === wtg.id);

        // Wake width at mast location (simplified Jensen model)
        const wakeExpansionAngleDeg = 7.5;
        const wakeHalfWidthM =
          (wtg.rotorDiameter / 2) + dist * Math.tan((wakeExpansionAngleDeg * Math.PI) / 180);

        wakeSources.push({
          wtgId: wtg.id,
          wtgName: wtg.name,
          distance: dist,
          distanceInD: distInD,
          angularDeviation: angDev,
          wakeWidthAtMast: wakeHalfWidthM * 2,
          isExternal,
        });

        // Track external WTG affecting sectors
        if (isExternal) {
          const existingEntry = externalWtgAnalysis.find((e) => e.id === wtg.id);
          if (existingEntry) {
            existingEntry.affectingSectors.push(direction);
          } else {
            externalWtgAnalysis.push({
              id: wtg.id,
              name: wtg.name,
              direction: wtgBearing,
              distance: dist,
              distanceInD: distInD,
              affectingSectors: [direction],
            });
          }
        }
      }
    }

    // Determine combined wake impact
    let combinedImpact: SectorWakeAnalysis['combinedWakeImpact'] = 'none';
    const closestDistD = wakeSources.length > 0
      ? Math.min(...wakeSources.map((s) => s.distanceInD))
      : Infinity;

    if (wakeSources.length === 0) {
      combinedImpact = 'none';
    } else if (closestDistD < 5 || wakeSources.length >= 3) {
      combinedImpact = 'high';
    } else if (closestDistD < 10 || wakeSources.length >= 2) {
      combinedImpact = 'medium';
    } else {
      combinedImpact = 'low';
    }

    const isFreestream = wakeSources.length === 0;

    if (isFreestream) {
      freestreamSectors.push(direction);
    } else {
      wakeAffectedSectors.push(direction);
    }

    sectorWakeAnalysis.push({
      direction,
      isFreestream,
      wakeSourceTurbines: wakeSources,
      combinedWakeImpact: combinedImpact,
    });
  }

  return {
    mastId: mast.id,
    mastName: mast.name,
    freestreamSectors,
    wakeAffectedSectors,
    sectorWakeAnalysis,
    externalWtgs: externalWtgAnalysis,
    freestreamPercentage: (freestreamSectors.length / numSectors) * 100,
  };
}

/**
 * Analyze freestream for all masts
 */
export function analyzeFreestreamAllMasts(
  masts: MetMast[],
  allWtgs: WTG[],
  externalWindFarms: WindFarmLayout[],
  config: AnalysisConfig
): FreestreamResult[] {
  return masts.map((mast) =>
    analyzeFreestream(mast, allWtgs, externalWindFarms, config)
  );
}

/**
 * Generate wake impact visualization data
 * Returns data for plotting a wake rose diagram
 */
export function generateWakeRoseData(
  freestreamResult: FreestreamResult,
  sectorWidth: number
): {
  direction: number;
  wakeImpact: number; // 0 = freestream, 1 = low, 2 = medium, 3 = high
  sourceCount: number;
  closestDistD: number;
}[] {
  return freestreamResult.sectorWakeAnalysis.map((swa) => ({
    direction: swa.direction,
    wakeImpact: swa.combinedWakeImpact === 'none' ? 0 :
      swa.combinedWakeImpact === 'low' ? 1 :
      swa.combinedWakeImpact === 'medium' ? 2 : 3,
    sourceCount: swa.wakeSourceTurbines.length,
    closestDistD: swa.wakeSourceTurbines.length > 0
      ? Math.min(...swa.wakeSourceTurbines.map((s) => s.distanceInD))
      : 0,
  }));
}
