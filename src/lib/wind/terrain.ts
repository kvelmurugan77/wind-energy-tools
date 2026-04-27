// ============================================================
// IEC 61400-12-1 Terrain Assessment Engine
// ============================================================

import type {
  GeoCoordinate,
  MetMast,
  WTG,
  TerrainPoint,
  RoughnessSector,
  SectorAnalysis,
  TerrainAssessmentResult,
  TerrainProfile,
  AnalysisConfig,
  ValidationError,
} from './types';
import {
  haversineDistance,
  bearing,
  generateTerrainProfile,
  calculateSlopeDeg,
  roughnessClass,
  normalizeAngle,
  isInWakeCone,
  wakeHalfWidth,
  angularDeviation,
  syntheticElevation,
} from './geo';

/** Default IEC 61400-12-1 configuration */
export const DEFAULT_CONFIG: AnalysisConfig = {
  iecVersion: 'IEC-61400-12-1-2017',
  sectorWidth: 10,
  assessmentRadius: 5000,
  minDistanceD: 2,
  maxSlopeSimple: 10,   // degrees - for terrain class A
  maxSlopeComplex: 17,  // degrees - for terrain class S
  wakeAngularThreshold: 30,
  wakeDistanceThresholdD: 20,
  includeExternalLayouts: false,
  project: {
    name: 'Wind Farm PCV Assessment',
    location: 'Not specified',
  },
};

/**
 * Validate all input data before processing
 * Returns array of validation errors/warnings
 */
export function validateInputs(
  masts: MetMast[],
  wtgs: WTG[],
  config: AnalysisConfig
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check masts
  if (masts.length === 0) {
    errors.push({
      field: 'masts',
      message: 'At least one meteorological mast is required.',
      severity: 'error',
      suggestion: 'Add mast location data (name, coordinates, height).',
    });
  }

  for (const mast of masts) {
    if (!mast.name || mast.name.trim() === '') {
      errors.push({
        field: `mast.${mast.id}.name`,
        message: `Mast ${mast.id} has no name specified.`,
        severity: 'warning',
        suggestion: 'Assign a descriptive name for reference in the report.',
      });
    }
    if (
      mast.location.latitude < -90 ||
      mast.location.latitude > 90 ||
      mast.location.longitude < -180 ||
      mast.location.longitude > 180
    ) {
      errors.push({
        field: `mast.${mast.id}.location`,
        message: `Mast "${mast.name}" has invalid coordinates.`,
        severity: 'error',
        suggestion: 'Ensure latitude is [-90, 90] and longitude is [-180, 180].',
      });
    }
    if (mast.mastHeight <= 0) {
      errors.push({
        field: `mast.${mast.id}.mastHeight`,
        message: `Mast "${mast.name}" has invalid height: ${mast.mastHeight}m.`,
        severity: 'error',
        suggestion: 'Mast height must be a positive number.',
      });
    }
  }

  // Check WTGs
  if (wtgs.length === 0) {
    errors.push({
      field: 'wtgs',
      message: 'At least one wind turbine generator is required.',
      severity: 'error',
      suggestion: 'Add WTG location data (name, coordinates, rotor diameter, hub height).',
    });
  }

  for (const wtg of wtgs) {
    if (!wtg.name || wtg.name.trim() === '') {
      errors.push({
        field: `wtg.${wtg.id}.name`,
        message: `WTG ${wtg.id} has no name specified.`,
        severity: 'warning',
      });
    }
    if (
      wtg.location.latitude < -90 ||
      wtg.location.latitude > 90 ||
      wtg.location.longitude < -180 ||
      wtg.location.longitude > 180
    ) {
      errors.push({
        field: `wtg.${wtg.id}.location`,
        message: `WTG "${wtg.name}" has invalid coordinates.`,
        severity: 'error',
      });
    }
    if (wtg.rotorDiameter <= 0) {
      errors.push({
        field: `wtg.${wtg.id}.rotorDiameter`,
        message: `WTG "${wtg.name}" has invalid rotor diameter: ${wtg.rotorDiameter}m.`,
        severity: 'error',
        suggestion: 'Rotor diameter must be a positive number (typically 80-200m).',
      });
    }
    if (wtg.hubHeight <= 0) {
      errors.push({
        field: `wtg.${wtg.id}.hubHeight`,
        message: `WTG "${wtg.name}" has invalid hub height: ${wtg.hubHeight}m.`,
        severity: 'error',
      });
    }
  }

  // Check for duplicate IDs
  const mastIds = masts.map((m) => m.id);
  const wtgIds = wtgs.map((w) => w.id);
  const duplicateMastIds = mastIds.filter((id, i) => mastIds.indexOf(id) !== i);
  const duplicateWtgIds = wtgIds.filter((id, i) => wtgIds.indexOf(id) !== i);

  if (duplicateMastIds.length > 0) {
    errors.push({
      field: 'masts',
      message: `Duplicate mast IDs found: ${[...new Set(duplicateMastIds)].join(', ')}`,
      severity: 'error',
      suggestion: 'Ensure each mast has a unique ID.',
    });
  }

  if (duplicateWtgIds.length > 0) {
    errors.push({
      field: 'wtgs',
      message: `Duplicate WTG IDs found: ${[...new Set(duplicateWtgIds)].join(', ')}`,
      severity: 'error',
      suggestion: 'Ensure each WTG has a unique ID.',
    });
  }

  // Check mast-WTG distance criteria
  for (const mast of masts) {
    for (const wtg of wtgs) {
      const dist = haversineDistance(mast.location, wtg.location);
      const distInD = dist / wtg.rotorDiameter;

      if (distInD < config.minDistanceD) {
        errors.push({
          field: 'distance',
          message: `Mast "${mast.name}" to WTG "${wtg.name}" distance (${distInD.toFixed(1)}D) is below minimum IEC requirement (${config.minDistanceD}D).`,
          severity: 'warning',
          suggestion: `Minimum recommended distance is ${config.minDistanceD}× rotor diameter (${(config.minDistanceD * wtg.rotorDiameter).toFixed(0)}m). Current distance is ${dist.toFixed(0)}m.`,
        });
      }

      if (distInD > 40) {
        errors.push({
          field: 'distance',
          message: `Mast "${mast.name}" to WTG "${wtg.name}" distance (${distInD.toFixed(1)}D) is very large. Terrain representativeness may be reduced.`,
          severity: 'warning',
          suggestion: 'Consider whether the terrain between mast and WTG is sufficiently representative.',
        });
      }
    }
  }

  // Check config
  if (config.sectorWidth !== 10 && config.sectorWidth !== 20) {
    errors.push({
      field: 'config.sectorWidth',
      message: `Invalid sector width: ${config.sectorWidth}°. Must be 10° or 20°.`,
      severity: 'error',
      suggestion: 'IEC 61400-12-1 typically uses 10° or 20° sectors.',
    });
  }

  if (config.assessmentRadius < 1000) {
    errors.push({
      field: 'config.assessmentRadius',
      message: `Assessment radius ${config.assessmentRadius}m is too small.`,
      severity: 'warning',
      suggestion: 'Minimum recommended assessment radius is 2000m for IEC compliance.',
    });
  }

  return errors;
}

/**
 * Perform full IEC 61400-12-1 terrain assessment for a mast-WTG pair
 */
export function performTerrainAssessment(
  mast: MetMast,
  targetWtg: WTG,
  allWtgs: WTG[],
  terrainPoints: TerrainPoint[] | undefined,
  roughnessSectors: RoughnessSector[] | undefined,
  config: AnalysisConfig
): TerrainAssessmentResult {
  const distance = haversineDistance(mast.location, targetWtg.location);
  const distanceInD = distance / targetWtg.rotorDiameter;
  const mastToWtgBearing = bearing(mast.location, targetWtg.location);
  const numSectors = 360 / config.sectorWidth;
  const sectors: SectorAnalysis[] = [];

  // Generate terrain profiles for each sector
  const terrainProfiles: TerrainProfile[] = [];

  for (let i = 0; i < numSectors; i++) {
    const direction = i * config.sectorWidth;
    const directionFrom = direction - config.sectorWidth / 2;
    const directionTo = direction + config.sectorWidth / 2;

    // Generate terrain profile along this direction
    const profile = generateTerrainProfile(
      mast.location,
      direction,
      config.assessmentRadius,
      50,
      terrainPoints
    );

    terrainProfiles.push({
      direction,
      distance: profile.map((p) => p.distance),
      elevation: profile.map((p) => p.elevation),
      slope: profile.map((p) => p.slope),
      roughness: profile.map(() => 0.03), // default roughness
    });

    // Calculate terrain slopes
    const slopes = profile.map((p) => p.slope);
    const absoluteSlopes = slopes.map((s) => Math.abs(s));
    const maxSlope = Math.max(...absoluteSlopes);
    const maxSlopeDeg = calculateSlopeDeg(maxSlope);
    const avgSlope = absoluteSlopes.reduce((a, b) => a + b, 0) / absoluteSlopes.length;

    // Elevation change
    const maxElevation = Math.max(...profile.map((p) => p.elevation));
    const minElevation = Math.min(...profile.map((p) => p.elevation));
    const maxElevationChange = maxElevation - minElevation;

    // Roughness assessment
    const roughness = roughnessSectors
      ? getSectorRoughness(direction, config.sectorWidth, roughnessSectors)
      : { z0: 0.03, roughnessClass: 1, hasSignificantChange: false, description: 'Default: Open agricultural land (z0=0.03m)' };

    // Wake analysis: check for upstream turbines in this sector
    const wakeAffectedTurbines: string[] = [];
    for (const wtg of allWtgs) {
      if (wtg.id === targetWtg.id) continue;
      const wtgBearing = bearing(mast.location, wtg.location);
      const angDev = angularDeviation(direction, wtgBearing);
      const dist = haversineDistance(mast.location, wtg.location);
      const distInDWtg = dist / wtg.rotorDiameter;

      if (angDev <= config.wakeAngularThreshold && distInDWtg <= config.wakeDistanceThresholdD) {
        wakeAffectedTurbines.push(wtg.name);
      }
    }

    const isFreestream = wakeAffectedTurbines.length === 0;

    // Slope criteria check
    const simpleTerrainPass = maxSlopeDeg <= config.maxSlopeSimple;
    const complexTerrainPass = maxSlopeDeg <= config.maxSlopeComplex;

    // Collect failure reasons
    const failureReasons: string[] = [];

    if (!simpleTerrainPass && !complexTerrainPass) {
      failureReasons.push(
        `Maximum slope ${maxSlopeDeg.toFixed(1)}° exceeds both Class A (${config.maxSlopeSimple}°) and Class S (${config.maxSlopeComplex}°) thresholds.`
      );
    } else if (!simpleTerrainPass) {
      failureReasons.push(
        `Maximum slope ${maxSlopeDeg.toFixed(1)}° exceeds Class A threshold (${config.maxSlopeSimple}°). May qualify for Class S.`
      );
    }

    if (roughness.hasSignificantChange) {
      failureReasons.push(
        'Significant roughness change detected within sector assessment area.'
      );
    }

    if (!isFreestream) {
      failureReasons.push(
        `Upstream turbines detected in sector: ${wakeAffectedTurbines.join(', ')}.`
      );
    }

    // Terrain classification per IEC
    let terrainClass: 'A' | 'B' | 'S' = 'A';
    if (maxSlopeDeg > config.maxSlopeSimple && maxSlopeDeg <= config.maxSlopeComplex) {
      terrainClass = 'B';
    } else if (maxSlopeDeg > config.maxSlopeComplex) {
      terrainClass = 'S';
    }

    // Determine validity - sector is valid if it meets at least Class S criteria
    // AND is freestream (or freestream is handled separately)
    const isValid = complexTerrainPass && !roughness.hasSignificantChange;

    sectors.push({
      direction,
      directionFrom,
      directionTo,
      maxSlope,
      maxSlopeDeg,
      avgSlope,
      maxElevationChange,
      roughness,
      isValid,
      failureReasons,
      isFreestream,
      wakeAffectedTurbines,
      terrainClass,
      slopeCriteria: {
        simpleTerrainPass,
        complexTerrainPass,
      },
    });
  }

  // Generate summary
  const validSectors = sectors.filter((s) => s.isValid).map((s) => s.direction);
  const freestreamSectors = sectors.filter((s) => s.isFreestream).map((s) => s.direction);
  const validAndFreestream = sectors.filter((s) => s.isValid && s.isFreestream).map((s) => s.direction);

  const validSlopes = sectors.filter((s) => s.isValid).map((s) => s.maxSlope);
  const maxValidSlope = validSlopes.length > 0 ? Math.max(...validSlopes) : 0;
  const maxValidSlopeDeg = calculateSlopeDeg(maxValidSlope);

  const hasInvalidSectors = sectors.some((s) => !s.isValid);
  const complianceNotes: string[] = [];

  let terrainClassOverall: 'A' | 'B' | 'S' = 'A';
  const hasClassB = sectors.some((s) => s.terrainClass === 'B');
  const hasClassS = sectors.some((s) => s.terrainClass === 'S');

  if (hasClassS) {
    terrainClassOverall = 'S';
    complianceNotes.push('Complex terrain detected (Class S per IEC 61400-12-1). Additional flow model verification may be required.');
  } else if (hasClassB) {
    terrainClassOverall = 'B';
    complianceNotes.push('Moderate terrain complexity (Class B). Standard IEC methodology applies with some cautions.');
  }

  if (distanceInD < config.minDistanceD) {
    complianceNotes.push(`Mast-to-WTG distance (${distanceInD.toFixed(1)}D) is below IEC recommended minimum (${config.minDistanceD}D).`);
  }

  if (freestreamSectors.length < validSectors.length * 0.5) {
    complianceNotes.push('More than half of valid sectors are affected by upstream turbine wakes. Consider relocating mast or adjusting sector selection.');
  }

  const isIECCompliant = !hasInvalidSectors && validAndFreestream.length >= numSectors * 0.25;

  if (!isIECCompliant) {
    if (validSectors.length < numSectors * 0.25) {
      complianceNotes.push('Insufficient valid sectors for IEC-compliant PCV assessment.');
    }
  }

  return {
    metadata: {
      mastId: mast.id,
      mastName: mast.name,
      targetWtgId: targetWtg.id,
      targetWtgName: targetWtg.name,
      assessmentDate: new Date().toISOString().split('T')[0],
      iecVersion: config.iecVersion,
      sectorWidth: config.sectorWidth,
      assessmentRadius: config.assessmentRadius,
      numSectors,
    },
    distance: {
      meters: distance,
      rotorDiameters: distanceInD,
      bearing: mastToWtgBearing,
    },
    sectors,
    validSectors: validAndFreestream,
    summary: {
      terrainClassification: terrainClassOverall === 'A' ? 'simple' : 'complex',
      terrainClass: terrainClassOverall,
      totalSectors: numSectors,
      validSectorsCount: validAndFreestream.length,
      invalidSectorsCount: numSectors - validAndFreestream.length,
      freestreamSectorsCount: freestreamSectors.length,
      validSectorPercentage: (validAndFreestream.length / numSectors) * 100,
      maxValidSlope,
      maxValidSlopeDeg,
      minDistance: distance,
      minDistanceInD: distanceInD,
      isIECCompliant,
      complianceNotes,
    },
    terrainProfiles,
  };
}

/**
 * Get roughness information for a specific sector
 */
function getSectorRoughness(
  direction: number,
  sectorWidth: number,
  roughnessSectors: RoughnessSector[]
): {
  z0: number;
  roughnessClass: number;
  hasSignificantChange: boolean;
  description: string;
} {
  const halfWidth = sectorWidth / 2;
  const matching = roughnessSectors.filter(
    (rs) => direction >= rs.directionFrom - halfWidth && direction <= rs.directionTo + halfWidth
  );

  if (matching.length === 0) {
    return { z0: 0.03, roughnessClass: 1, hasSignificantChange: false, description: 'Default: Open agricultural land (z0=0.03m)' };
  }

  // Check for significant roughness changes
  const z0Values = matching.map((m) => m.roughnessZ0);
  const maxZ0 = Math.max(...z0Values);
  const minZ0 = Math.min(...z0Values);
  const hasSignificantChange = maxZ0 / minZ0 > 3;

  const avgZ0 = z0Values.reduce((a, b) => a + b, 0) / z0Values.length;
  const rc = roughnessClass(avgZ0);

  return {
    z0: avgZ0,
    roughnessClass: rc.class,
    hasSignificantChange,
    description: `Avg z0 = ${avgZ0.toFixed(4)}m (${rc.description})`,
  };
}

/**
 * Perform complete terrain assessment for all mast-WTG pairs
 */
export function performAllAssessments(
  masts: MetMast[],
  wtgs: WTG[],
  terrainPoints: TerrainPoint[] | undefined,
  roughnessSectors: RoughnessSector[] | undefined,
  config: AnalysisConfig
): TerrainAssessmentResult[] {
  const results: TerrainAssessmentResult[] = [];

  for (const mast of masts) {
    for (const wtg of wtgs.filter((w) => w.isTarget !== false)) {
      results.push(
        performTerrainAssessment(mast, wtg, wtgs, terrainPoints, roughnessSectors, config)
      );
    }
  }

  return results;
}
