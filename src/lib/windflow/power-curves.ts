// ============================================================
// Wind Flow Model - Turbine Power Curves
// Standard power curves for common wind turbine models
// ============================================================

import { TurbineModel, PowerCurvePoint } from './types';

/**
 * N163/7.0MW - Nordex (7.0 MW rated)
 * Cut-in: 3 m/s, Rated: 12.5 m/s, Cut-out: 25 m/s
 */
function nordexN163PowerCurve(): PowerCurvePoint[] {
  const ratedPower = 7000;
  const cutIn = 3;
  const ratedSpeed = 12.5;
  const cutOut = 25;
  const points: PowerCurvePoint[] = [];

  for (let v = 0; v <= 25; v += 0.5) {
    let power = 0;
    if (v < cutIn) {
      power = 0;
    } else if (v >= ratedSpeed && v <= cutOut) {
      power = ratedPower;
    } else if (v > cutOut) {
      power = 0;
    } else {
      // Cubic interpolation between cut-in and rated
      power = ratedPower * (v * v * v - cutIn * cutIn * cutIn) / (ratedSpeed * ratedSpeed * ratedSpeed - cutIn * cutIn * cutIn);
    }
    points.push({ speed: v, power: Math.round(power * 10) / 10 });
  }
  return points;
}

/**
 * Generic turbine power curve generator
 */
function genericPowerCurve(
  ratedPower: number,
  cutIn: number,
  ratedSpeed: number,
  cutOut: number
): PowerCurvePoint[] {
  const points: PowerCurvePoint[] = [];
  for (let v = 0; v <= 30; v += 0.5) {
    let power = 0;
    if (v < cutIn) {
      power = 0;
    } else if (v >= ratedSpeed && v <= cutOut) {
      power = ratedPower;
    } else if (v > cutOut) {
      power = 0;
    } else {
      power = ratedPower * (v * v * v - cutIn * cutIn * cutIn) / (ratedSpeed * ratedSpeed * ratedSpeed - cutIn * cutIn * cutIn);
    }
    points.push({ speed: v, power: Math.round(power * 10) / 10 });
  }
  return points;
}

/**
 * Get power at a given wind speed using linear interpolation
 */
export function getPowerAtSpeed(curve: PowerCurvePoint[], speed: number): number {
  if (speed <= curve[0].speed) return 0;
  if (speed >= curve[curve.length - 1].speed) return 0;

  for (let i = 1; i < curve.length; i++) {
    if (speed <= curve[i].speed) {
      const v0 = curve[i - 1].speed;
      const v1 = curve[i].speed;
      const p0 = curve[i - 1].power;
      const p1 = curve[i].power;
      const frac = (speed - v0) / (v1 - v0);
      return p0 + frac * (p1 - p0);
    }
  }
  return 0;
}

/**
 * Predefined turbine models database
 */
export const TURBINE_MODELS: Record<string, TurbineModel> = {
  'N163-7.0MW': {
    name: 'N163-7.0MW',
    ratedPower: 7000,
    rotorDiameter: 163,
    hubHeight: 138,
    cutInSpeed: 3,
    cutOutSpeed: 25,
    ratedSpeed: 12.5,
    powerCurve: nordexN163PowerCurve(),
  },
  'V150-5.6MW': {
    name: 'V150-5.6MW',
    ratedPower: 5600,
    rotorDiameter: 150,
    hubHeight: 166,
    cutInSpeed: 3,
    cutOutSpeed: 25,
    ratedSpeed: 12.5,
    powerCurve: genericPowerCurve(5600, 3, 12.5, 25),
  },
  'SG14-236DD': {
    name: 'SG14-236DD',
    ratedPower: 15000,
    rotorDiameter: 236,
    hubHeight: 160,
    cutInSpeed: 3,
    cutOutSpeed: 25,
    ratedSpeed: 11.5,
    powerCurve: genericPowerCurve(15000, 3, 11.5, 25),
  },
  'E-138': {
    name: 'E-138',
    ratedPower: 4200,
    rotorDiameter: 138,
    hubHeight: 131,
    cutInSpeed: 3,
    cutOutSpeed: 25,
    ratedSpeed: 12,
    powerCurve: genericPowerCurve(4200, 3, 12, 25),
  },
  'Generic-2.0MW': {
    name: 'Generic-2.0MW',
    ratedPower: 2000,
    rotorDiameter: 90,
    hubHeight: 80,
    cutInSpeed: 3,
    cutOutSpeed: 25,
    ratedSpeed: 12,
    powerCurve: genericPowerCurve(2000, 3, 12, 25),
  },
  'Generic-3.0MW': {
    name: 'Generic-3.0MW',
    ratedPower: 3000,
    rotorDiameter: 110,
    hubHeight: 100,
    cutInSpeed: 3,
    cutOutSpeed: 25,
    ratedSpeed: 12.5,
    powerCurve: genericPowerCurve(3000, 3, 12.5, 25),
  },
  'Generic-4.0MW': {
    name: 'Generic-4.0MW',
    ratedPower: 4000,
    rotorDiameter: 130,
    hubHeight: 110,
    cutInSpeed: 3,
    cutOutSpeed: 25,
    ratedSpeed: 12,
    powerCurve: genericPowerCurve(4000, 3, 12, 25),
  },
};

/**
 * Get or create turbine model by name
 */
export function getTurbineModel(name: string): TurbineModel {
  if (TURBINE_MODELS[name]) return TURBINE_MODELS[name];
  
  // Try to parse rated power from name (e.g., "N163-7.0MW" -> 7000)
  const match = name.match(/[\- ](\d+\.?\d*)\s*MW/i);
  if (match) {
    const ratedPower = parseFloat(match[1]) * 1000;
    return {
      name,
      ratedPower,
      rotorDiameter: 130,
      hubHeight: 100,
      cutInSpeed: 3,
      cutOutSpeed: 25,
      ratedSpeed: 12,
      powerCurve: genericPowerCurve(ratedPower, 3, 12, 25),
    };
  }

  // Default
  return TURBINE_MODELS['Generic-2.0MW'];
}

/**
 * Get list of available turbine models
 */
export function getAvailableModels(): string[] {
  return Object.keys(TURBINE_MODELS);
}
