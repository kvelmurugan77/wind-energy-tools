// ============================================================
// PCV WTG Selection & Mast Location Optimization Engine
// ============================================================

import type {
  MetMast,
  WTG,
  PCVPairing,
  PCVOptimizationResult,
  MastConfiguration,
  MastProposal,
  MeasurementSectorsResult,
  SectorAnalysis,
  AnalysisConfig,
  InputDataBundle,
} from './types';
import { performTerrainAssessment } from './terrain';
import {
  haversineDistance,
  bearing,
  destinationPoint,
  normalizeAngle,
} from './geo';

/**
 * Score a mast-WTG pairing for PCV suitability
 * Higher score = better suitability
 */
export function scorePCVPairing(
  mast: MetMast,
  wtg: WTG,
  allWtgs: WTG[],
  config: AnalysisConfig
): PCVPairing {
  const distance = haversineDistance(mast.location, wtg.location);
  const distanceInD = distance / wtg.rotorDiameter;
  const mastToWtgBearing = bearing(mast.location, wtg.location);

  // Perform terrain assessment
  const assessment = performTerrainAssessment(mast, wtg, allWtgs, undefined, undefined, config);

  const numSectors = 360 / config.sectorWidth;
  const validSectors = assessment.summary.validSectorsCount;
  const freestreamSectors = assessment.summary.freestreamSectorsCount;

  // Distance score (optimal range: 2D to 10D)
  let distanceScore = 100;
  if (distanceInD < 2) distanceScore = distanceInD / 2 * 50; // penalize too close
  else if (distanceInD > 10) distanceScore = Math.max(0, 100 - (distanceInD - 10) * 5);
  else distanceScore = 100; // sweet spot

  // Terrain quality score
  const terrainQualityScore = (assessment.summary.validSectorPercentage / 100) * 100;

  // Sector coverage score
  const sectorCoverageScore = (validSectors / numSectors) * 100;

  // Freestream quality score
  const freestreamScore = (freestreamSectors / numSectors) * 100;

  // Slope compliance score
  const avgMaxSlope = assessment.sectors
    .map((s) => s.maxSlopeDeg)
    .reduce((a, b) => a + b, 0) / assessment.sectors.length;
  const slopeComplianceScore = Math.max(0, 100 - avgMaxSlope * 5);

  // Weighted overall score
  const score =
    distanceScore * 0.2 +
    terrainQualityScore * 0.25 +
    sectorCoverageScore * 0.2 +
    freestreamScore * 0.25 +
    slopeComplianceScore * 0.1;

  const isRecommended =
    score >= 70 &&
    distanceInD >= config.minDistanceD &&
    validSectors >= numSectors * 0.3;

  return {
    mastId: mast.id,
    mastName: mast.name,
    wtgId: wtg.id,
    wtgName: wtg.name,
    distance,
    distanceInD,
    bearing: mastToWtgBearing,
    validSectors,
    totalSectors: numSectors,
    freestreamSectors,
    score: Math.round(score * 10) / 10,
    criterionScores: {
      distance: Math.round(distanceScore * 10) / 10,
      terrainQuality: Math.round(terrainQualityScore * 10) / 10,
      sectorCoverage: Math.round(sectorCoverageScore * 10) / 10,
      freestreamQuality: Math.round(freestreamScore * 10) / 10,
      slopeCompliance: Math.round(slopeComplianceScore * 10) / 10,
    },
    isRecommended,
  };
}

/**
 * Optimize PCV setup - find best mast-WTG pairings
 * Supports 1 mast testing 2 WTGs scenario
 */
export function optimizePCV(
  masts: MetMast[],
  wtgs: WTG[],
  config: AnalysisConfig
): PCVOptimizationResult {
  const pairings: PCVPairing[] = [];

  for (const mast of masts) {
    for (const wtg of wtgs) {
      pairings.push(scorePCVPairing(mast, wtg, wtgs, config));
    }
  }

  // Sort by score descending
  pairings.sort((a, b) => b.score - a.score);

  // Find best individual pairings (top per mast)
  const bestPerMast = new Map<string, PCVPairing>();
  for (const pairing of pairings) {
    if (!bestPerMast.has(pairing.mastId)) {
      bestPerMast.set(pairing.mastId, pairing);
    }
  }

  // Generate mast configurations (1 mast testing N WTGs)
  const configurations: MastConfiguration[] = [];

  for (const mast of masts) {
    const mastPairings = pairings.filter((p) => p.mastId === mast.id);
    const sortedPairings = mastPairings.sort((a, b) => b.score - a.score);

    // Configuration 1: Best single WTG
    if (sortedPairings.length >= 1) {
      const top1 = sortedPairings[0];
      configurations.push({
        mastId: mast.id,
        mastName: mast.name,
        targetWtgs: [{ wtgId: top1.wtgId, wtgName: top1.wtgName, score: top1.score, validSectors: top1.validSectors }],
        combinedValidSectors: top1.validSectors,
        combinedFreestreamSectors: top1.freestreamSectors,
        overallScore: top1.score,
        isRecommended: top1.isRecommended,
        notes: ['Single WTG PCV configuration'],
      });
    }

    // Configuration 2: Top 2 WTGs (1 mast testing 2 WTGs)
    if (sortedPairings.length >= 2) {
      const top2 = [sortedPairings[0], sortedPairings[1]];
      const combinedValid = new Set<number>();
      const combinedFreestream = new Set<number>();

      // Get the valid sectors from each assessment
      for (const pairing of top2) {
        const assessment = performTerrainAssessment(mast, wtgs.find((w) => w.id === pairing.wtgId)!, wtgs, undefined, undefined, config);
        for (const sector of assessment.validSectors) {
          combinedValid.add(sector);
        }
        for (const s of assessment.sectors.filter((sec) => sec.isFreestream)) {
          combinedFreestream.add(s.direction);
        }
      }

      const combinedScore = (top2[0].score * 0.6 + top2[1].score * 0.4);
      const numSectors = 360 / config.sectorWidth;

      configurations.push({
        mastId: mast.id,
        mastName: mast.name,
        targetWtgs: top2.map((p) => ({
          wtgId: p.wtgId,
          wtgName: p.wtgName,
          score: p.score,
          validSectors: p.validSectors,
        })),
        combinedValidSectors: combinedValid.size,
        combinedFreestreamSectors: combinedFreestream.size,
        overallScore: Math.round(combinedScore * 10) / 10,
        isRecommended: combinedScore >= 65 && combinedValid.size >= numSectors * 0.25,
        notes: [
          `1 mast (${mast.name}) testing 2 WTGs: ${top2[0].wtgName} & ${top2[1].wtgName}`,
          `Combined valid sector coverage: ${((combinedValid.size / numSectors) * 100).toFixed(1)}%`,
        ],
      });
    }
  }

  // Sort configurations by overall score
  configurations.sort((a, b) => b.overallScore - a.overallScore);

  // Generate recommendations
  const recommendations: string[] = [];
  const bestConfig = configurations[0];

  if (bestConfig) {
    recommendations.push(
      `Recommended mast: ${bestConfig.mastName} with overall suitability score ${bestConfig.overallScore}/100.`
    );

    if (bestConfig.targetWtgs.length > 1) {
      recommendations.push(
        `This mast can test ${bestConfig.targetWtgs.length} WTGs simultaneously: ${bestConfig.targetWtgs.map((w) => w.wtgName).join(' and ')}.`
      );
    } else {
      recommendations.push(
        `Target WTG: ${bestConfig.targetWtgs[0]?.wtgName} (${bestConfig.targetWtgs[0]?.score}/100 score).`
      );
    }

    if (bestConfig.combinedValidSectors < (360 / config.sectorWidth) * 0.5) {
      recommendations.push(
        'Warning: Valid sector coverage is below 50%. Consider additional mast placement or sector filtering adjustments.'
      );
    }
  }

  // Check for best single-WTG pairing
  const bestSingle = pairings[0];
  if (bestSingle) {
    recommendations.push(
      `Best individual pairing: Mast "${bestSingle.mastName}" → WTG "${bestSingle.wtgName}" (${bestSingle.distanceInD.toFixed(1)}D distance, ${bestSingle.score}/100 score).`
    );
  }

  return {
    bestPairings: pairings.slice(0, Math.min(10, pairings.length)),
    totalCombinations: pairings.length,
    configurations,
    recommendations,
  };
}

/**
 * Propose optimal mast locations for PCV
 * Evaluates candidate locations around target WTGs
 */
export function proposeMastLocations(
  wtgs: WTG[],
  allWtgs: WTG[],
  config: AnalysisConfig,
  existingMasts: MetMast[] = []
): MastProposal[] {
  const proposals: MastProposal[] = [];
  const numSectors = 360 / config.sectorWidth;

  for (const wtg of wtgs) {
    const D = wtg.rotorDiameter;

    // Candidate locations: at 2D, 4D, 6D, 8D from WTG in various directions
    const candidateDistances = [2, 4, 6, 8];
    const candidateAngles = [0, 45, 90, 135, 180, 225, 270, 315];

    for (const distD of candidateDistances) {
      for (const angle of candidateAngles) {
        const distM = distD * D;
        const candidateLocation = destinationPoint(wtg.location, angle, distM);

        // Create virtual mast
        const virtualMast = {
          id: `candidate_${wtg.id}_${distD}D_${angle}`,
          name: `Candidate @ ${distD}D bearing ${angle}° from ${wtg.name}`,
          location: candidateLocation,
          mastHeight: wtg.hubHeight,
          type: 'lattice' as const,
        };

        // Check distance from existing masts
        const tooCloseToExisting = existingMasts.some(
          (em) => haversineDistance(em.location, candidateLocation) < D * 2
        );
        if (tooCloseToExisting) continue;

        // Perform terrain assessment for this virtual mast location
        const assessment = performTerrainAssessment(
          virtualMast,
          wtg,
          allWtgs,
          undefined,
          undefined,
          config
        );

        const validSectors = assessment.summary.validSectorsCount;
        const freestreamSectors = assessment.summary.freestreamSectorsCount;
        const qualityScore = Math.round(
          (assessment.summary.validSectorPercentage * 0.5 +
            (freestreamSectors / numSectors) * 100 * 0.3 +
            (assessment.summary.maxValidSlopeDeg < config.maxSlopeSimple ? 20 : 0))
        );

        // Only include proposals with reasonable quality
        if (qualityScore >= 40) {
          const justification: string[] = [];
          const potentialIssues: string[] = [];

          justification.push(
            `Located ${distD}D (${distM.toFixed(0)}m) from WTG "${wtg.name}" at bearing ${angle}°`
          );
          justification.push(
            `${validSectors} valid sectors (${((validSectors / numSectors) * 100).toFixed(1)}% coverage)`
          );
          if (freestreamSectors > 0) {
            justification.push(
              `${freestreamSectors} freestream sectors (${((freestreamSectors / numSectors) * 100).toFixed(1)}% of total)`
            );
          }

          if (assessment.summary.terrainClass !== 'A') {
            justification.push(
              `Terrain classified as ${assessment.summary.terrainClass} - ensure flow model verification is planned`
            );
          }

          if (assessment.summary.complianceNotes.length > 0) {
            potentialIssues.push(...assessment.summary.complianceNotes);
          }

          if (validSectors < numSectors * 0.3) {
            potentialIssues.push(
              'Below minimum sector coverage (30%) for IEC-compliant assessment'
            );
          }

          proposals.push({
            id: virtualMast.id,
            proposedLocation: candidateLocation,
            targetWtgs: [wtg.id],
            expectedValidSectors: validSectors,
            expectedFreestreamSectors: freestreamSectors,
            qualityScore,
            justification,
            potentialIssues,
          });
        }
      }
    }
  }

  // Sort by quality score
  proposals.sort((a, b) => b.qualityScore - a.qualityScore);

  return proposals.slice(0, 20); // Return top 20 proposals
}

/**
 * Calculate final measurement sectors combining terrain assessment and freestream analysis
 */
export function calculateFinalSectors(
  mast: MetMast,
  targetWtgs: WTG[],
  allWtgs: WTG[],
  config: AnalysisConfig
): MeasurementSectorsResult {
  const numSectors = 360 / config.sectorWidth;
  const allValidSectors: SectorAnalysis[] = [];
  const validSectorDirections = new Set<number>();
  const freestreamSectorDirections = new Set<number>();

  // Combine sector analysis from all target WTG assessments
  for (const wtg of targetWtgs) {
    const assessment = performTerrainAssessment(mast, wtg, allWtgs, undefined, undefined, config);

    for (const sector of assessment.sectors) {
      if (sector.isValid) {
        if (!allValidSectors.find((s) => s.direction === sector.direction)) {
          allValidSectors.push(sector);
        }
        validSectorDirections.add(sector.direction);
      }
      if (sector.isFreestream && sector.isValid) {
        freestreamSectorDirections.add(sector.direction);
      }
    }
  }

  // Final sectors = valid AND freestream
  const finalSectors = allValidSectors
    .filter((s) => s.isFreestream)
    .map((s) => s.direction)
    .sort((a, b) => a - b);

  const totalCoverage = (finalSectors.length / numSectors) * 100;

  // Determine terrain class
  let terrainClass: 'A' | 'B' | 'S' = 'A';
  if (allValidSectors.some((s) => s.terrainClass === 'S')) {
    terrainClass = 'S';
  } else if (allValidSectors.some((s) => s.terrainClass === 'B')) {
    terrainClass = 'B';
  }

  const complianceNotes: string[] = [];
  const allCriteriaMet = finalSectors.length >= numSectors * 0.25;

  if (!allCriteriaMet) {
    complianceNotes.push(
      `Only ${finalSectors.length} sectors meet all criteria (minimum ${Math.ceil(numSectors * 0.25)} required).`
    );
  }

  if (terrainClass === 'S') {
    complianceNotes.push(
      'Complex terrain (Class S): Additional CFD or similar flow model verification required per IEC 61400-12-1.'
    );
  }

  if (totalCoverage < 50) {
    complianceNotes.push(
      `Sector coverage is ${totalCoverage.toFixed(1)}%. Consider extending measurement period or adding data sources.`
    );
  }

  return {
    mastId: mast.id,
    mastName: mast.name,
    targetWtgs: targetWtgs.map((w) => ({ id: w.id, name: w.name })),
    validSectors: allValidSectors,
    freestreamSectors: Array.from(freestreamSectorDirections).sort((a, b) => a - b),
    finalSectors,
    sectorWidth: config.sectorWidth,
    totalCoverage,
    complianceSummary: {
      terrainClass,
      allCriteriaMet,
      notes: complianceNotes,
    },
  };
}

/**
 * Run complete PCV analysis from input data bundle
 */
export function runFullAnalysis(data: InputDataBundle): {
  terrainResults: ReturnType<typeof performTerrainAssessment>[];
  pcvResults: PCVOptimizationResult;
  mastProposals: MastProposal[];
  finalSectors: MeasurementSectorsResult[];
} {
  const { masts, wtgs, config } = data;

  // Run PCV optimization
  const pcvResults = optimizePCV(masts, wtgs, config);

  // Run terrain assessments for all valid pairings
  const terrainResults = pcvResults.bestPairings.map((pairing) => {
    const mast = masts.find((m) => m.id === pairing.mastId)!;
    const wtg = wtgs.find((w) => w.id === pairing.wtgId)!;
    return performTerrainAssessment(mast, wtg, wtgs, data.terrainPoints, data.roughnessSectors, config);
  });

  // Propose mast locations if no optimal mast exists
  const mastProposals = proposeMastLocations(wtgs, wtgs, config, masts);

  // Calculate final sectors for best configuration
  const bestConfig = pcvResults.configurations[0];
  const finalSectors: MeasurementSectorsResult[] = [];

  if (bestConfig) {
    const mast = masts.find((m) => m.id === bestConfig.mastId);
    if (mast) {
      const targetWtgs = bestConfig.targetWtgs
        .map((tw) => wtgs.find((w) => w.id === tw.wtgId))
        .filter((w): w is WTG => w !== undefined);

      if (targetWtgs.length > 0) {
        finalSectors.push(calculateFinalSectors(mast, targetWtgs, wtgs, config));
      }
    }
  }

  return { terrainResults, pcvResults, mastProposals, finalSectors };
}
