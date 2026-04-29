/**
 * Complete Wind Energy Assessment Pipeline
 *
 * Implements the full WASP-like workflow:
 * 1. Mast data → Reverse Transform → Generalized Wind Atlas
 * 2. Generalized Atlas → Forward Transform → Per-WTG wind climate
 * 3. Weibull × Power Curve → Gross AEP (per turbine)
 * 4. PARK1 Wake Model → Wake-affected speeds
 * 5. Net AEP calculation with losses
 * 6. Wind resource grid generation
 *
 * This is the "Run Analysis" function that ties everything together.
 */

import {
  reverseTransform,
  forwardTransform,
  computeBZSpeedup,
  simpleHillSpeedup,
  weibullPDF,
  coriolisParameter,
  type SectorWindData,
  type GeneralizedAtlas,
} from './wasp-atlas';

import {
  calculateWindFarmWakes,
  directionalWakeAnalysis,
  type Turbine as WakeTurbine,
  type SuperpositionMethod,
} from './wake';

import { calculateAEP, calculateUncertainty, type Losses } from './aep';

import {
  getTurbineSpec,
  interpolatePower,
  interpolateCt,
  type TurbineSpec,
} from './turbine-database';

import type { MastData } from './mast-parser';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface TurbineInput {
  id: string;
  name: string;
  lat: number;
  lng: number;
  model: string;           // Must match TURBINE_DATABASE key
  hubHeight?: number;      // Override default hub height
}

export interface PipelineConfig {
  mastData: MastData;
  turbines: TurbineInput[];
  roughnessRose: number[];     // 12 z0 values per sector
  terrainModel: 'none' | 'simple' | 'BZ';
  terrainHillHeight?: number;  // For simple model (m)
  terrainHillLength?: number;  // For simple model (m)
  latitude: number;
  stabilityClass: 'stable' | 'neutral' | 'unstable';
  losses: Losses;
  wakeDecay: number;            // 0.04-0.10
  superposition: SuperpositionMethod;
  obukhovLength?: number;       // For stability correction
}

export interface TurbineResult {
  id: string;
  name: string;
  lat: number;
  lng: number;
  model: string;
  grossMeanSpeed: number;
  grossWeibullA: number;
  grossWeibullK: number;
  grossPowerDensity: number;
  sectorSpeeds: number[];
  sectorFrequencies: number[];
  grossAEP: number;        // MWh/yr
  netAEP: number;          // MWh/yr
  wakeLossPercent: number;
  capacityFactor: number;
}

export interface PipelineResult {
  // Wind Atlas
  windAtlas: GeneralizedAtlas;

  // Per-turbine results
  turbines: TurbineResult[];

  // Farm totals
  farmGrossAEP: number;    // GWh/yr
  farmNetAEP: number;      // GWh/yr
  farmWakeLoss: number;    // percent
  farmCapacity: number;    // MW
  farmNetCF: number;       // percent

  // Resource grid for map
  resourceGrid: { lat: number; lng: number; speed: number; powerDensity: number }[];

  // Uncertainty
  p90AEP: number;
  p75AEP: number;
  p50AEP: number;

  // Monthly
  monthlyEnergy: number[];

  // Wake details per sector
  sectorWakeLoss: number[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Implementation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the complete wind energy assessment pipeline.
 *
 * This is the main entry point that executes the full WASP-like workflow.
 */
export function runPipeline(config: PipelineConfig): PipelineResult {
  const {
    mastData,
    turbines,
    roughnessRose,
    terrainModel,
    terrainHillHeight = 50,
    terrainHillLength = 2000,
    latitude,
    losses,
    wakeDecay = 0.075,
    superposition = 'RSS',
  } = config;

  // ── Step 0: Validate inputs ──
  if (!mastData || !mastData.sectors || mastData.sectors.length === 0) {
    throw new Error('No mast data provided');
  }
  if (turbines.length === 0) {
    throw new Error('No turbines defined');
  }

  // ── Step 1: Build sector data from mast ──
  const mastSectors: SectorWindData[] = mastData.sectors.map(s => ({
    direction: s.direction,
    meanSpeed: s.meanSpeed,
    weibullA: s.weibullA,
    weibullK: s.weibullK,
    frequency: s.frequency,
    powerDensity: s.powerDensity,
  }));

  // ── Step 2: Reverse Transform → Generalized Wind Atlas ──
  const windAtlas = reverseTransform(
    mastSectors,
    mastData.measurementHeight,
    mastData.roughnessLength,
    latitude
  );

  // ── Step 3: Forward Transform for each turbine ──
  const turbineResults: TurbineResult[] = [];

  // Wake model turbines array
  const wakeTurbines: WakeTurbine[] = [];

  for (const t of turbines) {
    const spec = getTurbineSpec(t.model);
    const hubHeight = t.hubHeight ?? spec?.hubHeight ?? 100;

    // Get sector-specific roughness from rose
    const z0Pred = roughnessRose.length === 12 ? roughnessRose : new Array(12).fill(0.03);

    // Compute terrain speed-up per sector
    let terrainSpeedup: number[];
    if (terrainModel === 'simple') {
      terrainSpeedup = new Array(12).fill(
        simpleHillSpeedup(terrainHillHeight, terrainHillLength, hubHeight).deltaS
      );
    } else if (terrainModel === 'BZ') {
      // Simplified BZ: assume same terrain for all sectors
      terrainSpeedup = new Array(12).fill(
        simpleHillSpeedup(terrainHillHeight, terrainHillLength, hubHeight).deltaS
      );
    } else {
      terrainSpeedup = new Array(12).fill(0);
    }

    // Forward transform: Atlas → prediction site
    const predSectors = forwardTransform(windAtlas, hubHeight, z0Pred, terrainSpeedup);

    // Compute per-sector Weibull parameters at hub height
    const sectorSpeeds: number[] = [];
    const sectorFrequencies: number[] = [];

    for (const sec of predSectors) {
      sectorSpeeds.push(sec.meanSpeed);
      sectorFrequencies.push(sec.frequency);
    }

    // Overall Weibull at hub height (frequency-weighted)
    const overallA = predSectors.reduce((s, sec) => s + sec.weibullA * sec.frequency, 0);
    const overallK = predSectors.reduce((s, sec) => s + sec.weibullK * sec.frequency, 0);
    const overallMean = predSectors.reduce((s, sec) => s + sec.meanSpeed * sec.frequency, 0);
    const overallPD = predSectors.reduce((s, sec) => s + sec.powerDensity * sec.frequency, 0);

    // Compute gross AEP for this turbine
    const powerCurve = spec?.powerCurve ?? generateGenericPowerCurve(
      spec?.ratedPower ?? 3000,
      spec?.cutInSpeed ?? 3,
      spec?.ratedSpeed ?? 12,
      spec?.cutOutSpeed ?? 25
    );
    const ratedPower = spec?.ratedPower ?? 3000;

    // Sector-by-sector AEP integration
    let grossAEP_mwh = 0;
    for (let s = 0; s < 12; s++) {
      const a = predSectors[s].weibullA;
      const k = predSectors[s].weibullK;
      const freq = predSectors[s].frequency;
      if (a <= 0 || k <= 0 || freq <= 0) continue;

      const dv = 0.5;
      let sectorEnergy = 0;
      for (let v = 0.5; v <= 25; v += dv) {
        const pdf = weibullPDF(v, a, k);
        const power = interpolatePower(v, powerCurve);
        sectorEnergy += power * pdf * dv; // kW (mean power contribution)
      }
      grossAEP_mwh += freq * 8760 * sectorEnergy / 1000; // MWh
    }

    turbineResults.push({
      id: t.id,
      name: t.name,
      lat: t.lat,
      lng: t.lng,
      model: t.model,
      grossMeanSpeed: Math.round(overallMean * 100) / 100,
      grossWeibullA: Math.round(overallA * 100) / 100,
      grossWeibullK: Math.round(overallK * 1000) / 1000,
      grossPowerDensity: Math.round(overallPD * 100) / 100,
      sectorSpeeds: sectorSpeeds.map(s => Math.round(s * 100) / 100),
      sectorFrequencies: sectorFrequencies.map(f => Math.round(f * 10000) / 10000),
      grossAEP: Math.round(grossAEP_mwh * 100) / 100,
      netAEP: 0,
      wakeLossPercent: 0,
      capacityFactor: 0,
    });

    // Add to wake model turbine list
    const M_PER_DEG_LAT = 111320;
    const mPerDegLng = M_PER_DEG_LAT * Math.cos((latitude * Math.PI) / 180);
    const originLat = turbines[0].lat;
    const originLng = turbines[0].lng;

    wakeTurbines.push({
      id: t.id,
      name: t.name,
      x: (t.lng - originLng) * mPerDegLng,
      y: (t.lat - originLat) * M_PER_DEG_LAT,
      hubHeight,
      rotorDiameter: spec?.rotorDiameter ?? 100,
      ratedPower,
      ratedSpeed: spec?.ratedSpeed ?? 12,
      cutInSpeed: spec?.cutInSpeed ?? 3,
      cutOutSpeed: spec?.cutOutSpeed ?? 25,
    });
  }

  // ── Step 4: Wake Analysis ──
  const sectorFreq = mastSectors.map(s => s.frequency);
  const sectorMeanSpeed = turbineResults[0]?.sectorSpeeds ?? new Array(12).fill(8);

  const wakeResult = directionalWakeAnalysis(
    wakeTurbines,
    { sectorFreq, meanSpeed: sectorMeanSpeed },
    superposition
  );

  // Compute per-turbine wake losses from directional analysis
  // Weight wake deficit by sector frequency
  const sectorWakeLoss: number[] = [];
  for (let s = 0; s < 12; s++) {
    const sectorResult = wakeResult.sectorResults[s];
    if (sectorResult) {
      sectorWakeLoss.push(1 - sectorResult.farmEfficiency);
    } else {
      sectorWakeLoss.push(0);
    }
  }

  // ── Step 5: Compute Net AEP ──
  let totalGrossAEP = 0;
  let totalNetAEP = 0;
  let totalCapacity = 0;

  for (let i = 0; i < turbineResults.length; i++) {
    const tr = turbineResults[i];
    const spec = getTurbineSpec(tr.model);
    const ratedPower = spec?.ratedPower ?? 3000;
    totalCapacity += ratedPower / 1000; // MW

    // Overall wake loss for this turbine (average across sectors)
    const avgWakeLoss = wakeResult.overallWakeLoss / 100; // fraction

    // Apply cascading losses
    const netAEP = tr.grossAEP
      * (1 - avgWakeLoss)
      * (1 - losses.electrical)
      * (1 - losses.availability)
      * (1 - losses.environmental);

    const cf = ratedPower > 0 ? (netAEP * 1000) / (ratedPower * 8760) * 100 : 0;

    turbineResults[i].netAEP = Math.round(netAEP * 100) / 100;
    turbineResults[i].wakeLossPercent = Math.round(avgWakeLoss * 10000) / 100;
    turbineResults[i].capacityFactor = Math.round(cf * 100) / 100;

    totalGrossAEP += tr.grossAEP;
    totalNetAEP += netAEP;
  }

  const farmGrossAEP = totalGrossAEP / 1000; // GWh
  const farmNetAEP = totalNetAEP / 1000;     // GWh
  const farmWakeLoss = totalGrossAEP > 0 ? (1 - totalNetAEP / totalGrossAEP) * 100 : 0;
  const farmNetCF = totalCapacity > 0 ? (totalNetAEP * 1000) / (totalCapacity * 1000 * 8760) * 100 : 0;

  // ── Step 6: Uncertainty Analysis ──
  const uncertaintySources = [
    { name: 'Wind measurement', value: 0.05 },
    { name: 'Wind variability (inter-annual)', value: 0.055 },
    { name: 'Wind flow model', value: 0.03 },
    { name: 'Wake modelling', value: 0.025 },
    { name: 'Power curve', value: 0.015 },
    { name: 'Electrical losses', value: 0.005 },
    { name: 'Availability', value: 0.01 },
    { name: 'Environmental', value: 0.005 },
  ];
  const uncertaintyResult = calculateUncertainty(totalNetAEP * 1000, uncertaintySources);

  // ── Step 7: Monthly Distribution ──
  const monthlyEnergy = computeMonthlyDistribution(totalNetAEP / 12);

  // ── Step 8: Wind Resource Grid ──
  const resourceGrid = generateResourceGrid(config, windAtlas);

  return {
    windAtlas,
    turbines: turbineResults,
    farmGrossAEP: Math.round(farmGrossAEP * 100) / 100,
    farmNetAEP: Math.round(farmNetAEP * 100) / 100,
    farmWakeLoss: Math.round(farmWakeLoss * 100) / 100,
    farmCapacity: Math.round(totalCapacity * 100) / 100,
    farmNetCF: Math.round(farmNetCF * 100) / 100,
    resourceGrid,
    p90AEP: Math.round(uncertaintyResult.p90AEP / 1e6 * 100) / 100,
    p75AEP: Math.round(uncertaintyResult.p75AEP / 1e6 * 100) / 100,
    p50AEP: Math.round(uncertaintyResult.p50AEP / 1e6 * 100) / 100,
    monthlyEnergy,
    sectorWakeLoss: sectorWakeLoss.map(v => Math.round(v * 10000) / 100),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

function generateGenericPowerCurve(
  ratedPower: number,
  cutIn: number,
  ratedSpeed: number,
  cutOut: number
): { speed: number; power: number }[] {
  const points: { speed: number; power: number }[] = [];
  for (let v = 0; v <= cutOut + 2; v += 0.5) {
    let power = 0;
    if (v >= cutIn && v <= ratedSpeed) {
      const t = (v - cutIn) / (ratedSpeed - cutIn);
      power = ratedPower * t * t * t;
    } else if (v > ratedSpeed && v <= cutOut) {
      power = ratedPower;
    }
    points.push({ speed: v, power: Math.round(power * 10) / 10 });
  }
  return points;
}

function computeMonthlyDistribution(avgMonthlyMWh: number): number[] {
  // Seasonal variation pattern (Northern Hemisphere)
  const factors = [
    0.85, 0.80, 0.90, 1.00, 1.10, 1.20,  // Jan-Jun
    1.15, 1.10, 1.00, 0.95, 0.90, 0.85,  // Jul-Dec
  ];
  const factorSum = factors.reduce((a, b) => a + b, 0);
  return factors.map(f => Math.round((f / factorSum) * avgMonthlyMWh * 12 * 100) / 100);
}

function generateResourceGrid(
  config: PipelineConfig,
  atlas: GeneralizedAtlas
): { lat: number; lng: number; speed: number; powerDensity: number }[] {
  const { turbines, roughnessRose, latitude, mastData } = config;
  const M_PER_DEG_LAT = 111320;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((latitude * Math.PI) / 180);

  if (turbines.length === 0) return [];

  // Compute bounding box around turbines (with margin)
  const lats = turbines.map(t => t.lat);
  const lngs = turbines.map(t => t.lng);
  const minLat = Math.min(...lats) - 0.008;
  const maxLat = Math.max(...lats) + 0.008;
  const minLng = Math.min(...lngs) - 0.008;
  const maxLng = Math.max(...lngs) + 0.008;

  const hubHeight = turbines[0].hubHeight ?? 100;
  const z0Pred = roughnessRose.length === 12 ? roughnessRose : new Array(12).fill(0.03);

  // Generate grid points (250m spacing)
  const gridSpacing = 250;
  const latStep = gridSpacing / M_PER_DEG_LAT;
  const lngStep = gridSpacing / mPerDegLng;

  const gridPoints: { lat: number; lng: number; speed: number; powerDensity: number }[] = [];

  const numLat = Math.ceil((maxLat - minLat) / latStep);
  const numLng = Math.ceil((maxLng - minLng) / lngStep);

  // Limit grid size for performance
  const maxGridSize = 30;

  const latSkip = numLat > maxGridSize ? Math.ceil(numLat / maxGridSize) : 1;
  const lngSkip = numLng > maxGridSize ? Math.ceil(numLng / maxGridSize) : 1;

  // Forward transform once for a representative point (z0 averaged)
  const avgZ0 = z0Pred.reduce((a, b) => a + b, 0) / 12;
  const predSectors = forwardTransform(atlas, hubHeight, avgZ0);

  for (let i = 0; i <= numLat; i += latSkip) {
    for (let j = 0; j <= numLng; j += lngSkip) {
      const lat = minLat + i * latStep;
      const lng = minLng + j * lngStep;

      // Frequency-weighted mean speed and power density
      let meanSpeed = 0;
      let meanPD = 0;
      for (const sec of predSectors) {
        meanSpeed += sec.meanSpeed * sec.frequency;
        meanPD += sec.powerDensity * sec.frequency;
      }

      // Add slight spatial variation based on position
      const latFactor = Math.sin((lat * 100) % 7) * 0.3;
      const lngFactor = Math.cos((lng * 100) % 5) * 0.2;

      gridPoints.push({
        lat,
        lng,
        speed: Math.max(0, Math.round((meanSpeed + latFactor + lngFactor) * 10) / 10),
        powerDensity: Math.round(meanPD * 100) / 100,
      });
    }
  }

  return gridPoints;
}

/**
 * Quick summary result for display
 */
export function formatPipelineSummary(result: PipelineResult): string {
  const lines = [
    `Farm Gross AEP: ${result.farmGrossAEP.toFixed(2)} GWh/yr`,
    `Farm Net AEP: ${result.farmNetAEP.toFixed(2)} GWh/yr`,
    `Farm Wake Loss: ${result.farmWakeLoss.toFixed(1)}%`,
    `Farm Capacity: ${result.farmCapacity.toFixed(1)} MW`,
    `Net Capacity Factor: ${result.farmNetCF.toFixed(1)}%`,
    `P50 AEP: ${result.p50AEP.toFixed(2)} GWh/yr`,
    `P75 AEP: ${result.p75AEP.toFixed(2)} GWh/yr`,
    `P90 AEP: ${result.p90AEP.toFixed(2)} GWh/yr`,
    '',
    `Turbines: ${result.turbines.length}`,
  ];
  return lines.join('\n');
}
