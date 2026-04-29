// ============================================================
// Wind Flow Model - PARK1 Wake Model
// Classic wind turbine wake model (Katic et al., 1986)
// With RSS (Root Sum Square) superposition
// ============================================================

import { TurbineLayout } from './types';
import { distanceUTM, bearingUTM } from './flow-model';
import { NUM_SECTORS } from './statistics';

/**
 * Wake expansion coefficient
 * For onshore: k_wake = 0.075 (offshore: 0.04)
 */
const WAKE_DECAY_CONSTANT = 0.075;

/**
 * Thrust coefficient as a function of wind speed
 * Simplified CT curve - realistic for modern turbines
 */
function thrustCoefficient(windSpeed: number): number {
  if (windSpeed <= 0) return 0;
  if (windSpeed < 3) return 0;       // Below cut-in
  if (windSpeed < 5) return 0.82;     // Region 2 - max thrust
  if (windSpeed < 8) return 0.80;
  if (windSpeed < 10) return 0.78;
  if (windSpeed < 12) return 0.75;
  if (windSpeed < 13) return 0.55;    // Approaching rated
  if (windSpeed < 14) return 0.20;    // Blade pitch regulating
  if (windSpeed < 25) return 0.05;    // Above rated - minimal thrust
  return 0;                            // Above cut-out
}

/**
 * Calculate wake deficit at a downstream point
 * Using PARK1 model: DeltaV / V0 = (1 - sqrt(1 - CT)) / (1 + k*x/r)^2
 * 
 * @param upstreamTurbine - The turbine creating the wake
 * @param downstreamX - X coordinate of downstream point
 * @param downstreamY - Y coordinate of downstream point
 * @param windSpeed - Free-stream wind speed (m/s)
 * @param windDir - Wind direction in degrees (meteorological convention)
 * @returns Velocity deficit (0 to 1)
 */
export function wakeDeficit(
  upstreamTurbine: TurbineLayout,
  downstreamX: number,
  downstreamY: number,
  windSpeed: number,
  windDir: number
): number {
  const CT = thrustCoefficient(windSpeed);
  if (CT <= 0) return 0;

  const rotorRadius = upstreamTurbine.rotorDiameter / 2;

  // Distance from upstream turbine to downstream point
  const dist = distanceUTM(upstreamTurbine.x, upstreamTurbine.y, downstreamX, downstreamY);

  if (dist < rotorRadius * 0.1) return 0; // Too close, ignore

  // Calculate lateral offset (perpendicular to wind direction)
  // Wind direction in meteorological convention: 0 = from N, 90 = from E
  // Convert to math convention for vector math
  const windRad = (windDir * Math.PI) / 180;
  const dx = downstreamX - upstreamTurbine.x;
  const dy = downstreamY - upstreamTurbine.y;

  // Wind blows FROM windDir, so wind vector is: (sin(windDir), cos(windDir))
  // Downstream distance = projection onto wind direction
  const downDist = dx * Math.sin(windRad) + dy * Math.cos(windRad);
  const crossDist = Math.abs(-dx * Math.cos(windRad) + dy * Math.sin(windRad));

  if (downDist <= 0) return 0; // Upstream - no wake effect

  // Wake radius at downstream distance
  const wakeRadius = rotorRadius + WAKE_DECAY_CONSTANT * downDist;

  // Check if downstream point is within wake cone
  if (crossDist > wakeRadius) return 0;

  // Effective rotor area overlapping with wake
  const overlap = crossDist < rotorRadius 
    ? 1 - (crossDist / rotorRadius) 
    : 0;

  // PARK1 wake deficit
  const deficit = (1 - Math.sqrt(1 - CT)) / (1 + WAKE_DECAY_CONSTANT * downDist / rotorRadius) ** 2;

  return deficit * overlap;
}

/**
 * Calculate combined wake effect from all upstream turbines
 * Using Root Sum Square (RSS) superposition
 * 
 * @param targetTurbine - The turbine experiencing wake effects
 * @param allTurbines - All turbines in the farm
 * @param windSpeed - Free-stream wind speed (m/s)
 * @param windDir - Wind direction in degrees
 * @returns Effective wind speed at target turbine (m/s)
 */
export function calculateWakeEffect(
  targetTurbine: TurbineLayout,
  allTurbines: TurbineLayout[],
  windSpeed: number,
  windDir: number
): number {
  let sumDeficitSq = 0;

  for (const turbine of allTurbines) {
    if (turbine.id === targetTurbine.id) continue;

    const deficit = wakeDeficit(turbine, targetTurbine.x, targetTurbine.y, windSpeed, windDir);
    sumDeficitSq += deficit * deficit;
  }

  const combinedDeficit = Math.sqrt(sumDeficitSq);

  // Ensure deficit doesn't exceed physical limits
  const effectiveDeficit = Math.min(combinedDeficit, 0.6);

  return windSpeed * (1 - effectiveDeficit);
}

/**
 * Calculate wake loss per sector for all turbines
 * Returns wake-affected speed and loss percentage per sector per turbine
 */
export function calculateFarmWakeLosses(
  turbines: TurbineLayout[],
  sectorSpeeds: number[],
  sectorFrequencies: number[]
): { wakeSpeeds: number[][]; wakeLossBySector: number[][] } {
  const wakeSpeeds: number[][] = [];
  const wakeLossBySector: number[][] = [];

  for (const turbine of turbines) {
    const speeds: number[] = [];
    const losses: number[] = [];

    for (let s = 0; s < NUM_SECTORS; s++) {
      const freeSpeed = sectorSpeeds[s];
      if (freeSpeed <= 0 || sectorFrequencies[s] <= 0) {
        speeds.push(0);
        losses.push(0);
        continue;
      }

      const windDir = s * 30 + 15; // Sector center direction
      const wakeSpeed = calculateWakeEffect(turbine, turbines, freeSpeed, windDir);
      const loss = freeSpeed > 0 ? ((freeSpeed - wakeSpeed) / freeSpeed) * 100 : 0;

      speeds.push(Math.round(wakeSpeed * 100) / 100);
      losses.push(Math.round(loss * 100) / 100);
    }

    wakeSpeeds.push(speeds);
    wakeLossBySector.push(losses);
  }

  return { wakeSpeeds, wakeLossBySector };
}
