// ============================================================
// Geographic & Wind Engineering Calculation Utilities
// ============================================================

import type { GeoCoordinate, TerrainPoint } from './types';

/** Earth radius in meters (WGS84) */
const EARTH_RADIUS = 6371000;

/**
 * Calculate distance between two geographic coordinates using Haversine formula
 * Returns distance in meters
 */
export function haversineDistance(a: GeoCoordinate, b: GeoCoordinate): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;

  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Calculate bearing from point A to point B in degrees (0 = North, clockwise)
 */
export function bearing(a: GeoCoordinate, b: GeoCoordinate): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  let result = toDeg(Math.atan2(y, x));
  return ((result % 360) + 360) % 360;
}

/**
 * Calculate destination point given start, bearing, and distance
 * Used for creating terrain profiles along sector directions
 */
export function destinationPoint(
  start: GeoCoordinate,
  bearingDeg: number,
  distanceM: number
): GeoCoordinate {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dR = distanceM / EARTH_RADIUS;
  const lat1 = toRad(start.latitude);
  const lon1 = toRad(start.longitude);
  const brng = toRad(bearingDeg);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(dR) * Math.cos(lat1),
      Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    latitude: toDeg(lat2),
    longitude: toDeg(lon2),
  };
}

/**
 * Convert geographic coordinates to a local Cartesian system (meters)
 * Using flat-earth approximation (valid for small areas)
 */
export function geoToLocal(
  origin: GeoCoordinate,
  points: GeoCoordinate[]
): { x: number; y: number }[] {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const cosLat = Math.cos(toRad(origin.latitude));
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS;
  const mPerDegLon = mPerDegLat * cosLat;

  return points.map((p) => ({
    x: (p.longitude - origin.longitude) * mPerDegLon,
    y: (p.latitude - origin.latitude) * mPerDegLat,
  }));
}

/**
 * Convert local Cartesian coordinates back to geographic
 */
export function localToGeo(
  origin: GeoCoordinate,
  x: number,
  y: number
): GeoCoordinate {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const cosLat = Math.cos(toRad(origin.latitude));
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS;
  const mPerDegLon = mPerDegLat * cosLat;

  return {
    latitude: origin.latitude + y / mPerDegLat,
    longitude: origin.longitude + x / mPerDegLon,
  };
}

/**
 * Calculate terrain slope between consecutive points
 * Returns slope in percent (rise/run * 100)
 */
export function calculateSlope(
  point1: { elevation: number; distance: number },
  point2: { elevation: number; distance: number }
): number {
  const dElev = point2.elevation - point1.elevation;
  const dDist = point2.distance - point1.distance;
  if (dDist === 0) return 0;
  return (dElev / dDist) * 100;
}

/**
 * Calculate terrain slope between consecutive points in degrees
 */
export function calculateSlopeDeg(slopePercent: number): number {
  return Math.atan(slopePercent / 100) * (180 / Math.PI);
}

/**
 * Calculate angle between a reference direction and a line connecting two points
 * Used for wake analysis
 */
export function angularDeviation(
  referenceBearing: number,
  pointBearing: number
): number {
  let diff = Math.abs(referenceBearing - pointBearing);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/**
 * Calculate wake width at a given distance based on simple wake model
 * Wake expands approximately 1° per rotor diameter downstream
 * Returns wake half-width in meters
 */
export function wakeHalfWidth(
  rotorDiameter: number,
  distance: number
): number {
  const wakeExpansionAngle = 7.5; // degrees (typical Jensen model expansion)
  const halfWidth = (D: number, dist: number) =>
    (D / 2) + dist * Math.tan((wakeExpansionAngle * Math.PI) / 180);
  return halfWidth(rotorDiameter, distance);
}

/**
 * Determine if a point falls within the wake cone
 */
export function isInWakeCone(
  mastLocation: GeoCoordinate,
  wtgLocation: GeoCoordinate,
  testDirection: number,
  rotorDiameter: number,
  wakeAngularThreshold: number = 30
): boolean {
  const dist = haversineDistance(mastLocation, wtgLocation);
  // WTG is upstream if it's in the direction the wind comes from
  // testDirection is the direction wind comes FROM (meteorological convention)
  const wtgBearing = bearing(mastLocation, wtgLocation);
  const angularDev = angularDeviation(testDirection, wtgBearing);

  if (angularDev <= wakeAngularThreshold) {
    return true;
  }
  return false;
}

/**
 * Get a point on the terrain profile at a given distance and bearing from origin
 * Interpolates from terrain data
 */
export function getTerrainElevation(
  origin: GeoCoordinate,
  bearingDeg: number,
  distanceM: number,
  terrainPoints: TerrainPoint[]
): number | null {
  if (terrainPoints.length === 0) return null;

  const dest = destinationPoint(origin, bearingDeg, distanceM);
  const originLocal = geoToLocal(origin, [origin])[0];

  // Convert terrain points to local coordinates
  const localPoints = terrainPoints.map((tp) => {
    const geoPoint: GeoCoordinate = { latitude: 0, longitude: 0 };
    return { ...tp, x: 0, y: 0 }; // placeholder
  });

  // For now, use a simple elevation model based on lat/lon
  // In a real app, this would use a proper DEM/DTM
  const nearestPoints = findNearestTerrainPoints(
    dest,
    terrainPoints,
    3
  );

  if (nearestPoints.length === 0) return null;

  // Inverse distance weighting interpolation
  let totalWeight = 0;
  let totalElevation = 0;
  for (const p of nearestPoints) {
    const weight = 1 / (p.distance * p.distance || 1);
    totalWeight += weight;
    totalElevation += p.elevation * weight;
  }

  return totalElevation / totalWeight;
}

/**
 * Find N nearest terrain points to a given location
 */
function findNearestTerrainPoints(
  location: GeoCoordinate,
  terrainPoints: TerrainPoint[],
  count: number
): { elevation: number; distance: number }[] {
  if (terrainPoints.length === 0) return [];

  const results = terrainPoints.map((tp) => {
    const tpGeo: GeoCoordinate = {
      latitude: tp.northing / 111320,
      longitude: tp.easting / (111320 * Math.cos((location.latitude * Math.PI) / 180)),
    };
    const dist = haversineDistance(location, tpGeo);
    return { elevation: tp.elevation, distance: dist };
  });

  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, count);
}

/**
 * Simple hash function for smooth noise generation
 */
function hash(x: number, y: number, seed: number): number {
  let h = seed + x * 374761393 + y * 668265263;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
}

/**
 * Smooth interpolation (smoothstep)
 */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Value noise with smooth interpolation
 * Generates smooth terrain at the given position
 */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);

  const n00 = hash(ix, iy, seed);
  const n10 = hash(ix + 1, iy, seed);
  const n01 = hash(ix, iy + 1, seed);
  const n11 = hash(ix + 1, iy + 1, seed);

  const nx0 = n00 + (n10 - n00) * fx;
  const nx1 = n01 + (n11 - n01) * fx;

  return nx0 + (nx1 - nx0) * fy;
}

/**
 * Fractal Brownian Motion for multi-octave terrain
 */
function fbm(x: number, y: number, seed: number, octaves: number = 4): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * valueNoise(x * frequency, y * frequency, seed + i * 31);
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / maxValue; // Normalized to [0, 1]
}

/**
 * Generate synthetic terrain elevation based on position
 * Used when no DEM data is provided - creates realistic rolling terrain
 * Typical slopes: 2-10% with some steeper sections up to 15%
 */
export function syntheticElevation(
  latitude: number,
  longitude: number,
  baseElevation: number = 50,
  seed: number = 42
): number {
  // Scale lat/lon to get reasonable spatial frequency
  // ~111km per degree, so at this scale 1 unit = ~111km
  // We want features on the 100m - 500m scale, so multiply by ~1000
  const x = longitude * 1000;
  const y = latitude * 1000;

  // Multi-octave noise for realistic terrain variation
  // Base terrain: gentle rolling hills (amplitude ~20m over 1km)
  const baseNoise = (fbm(x * 0.01, y * 0.01, seed, 3) - 0.5) * 40;

  // Medium features: moderate hills (amplitude ~10m over 500m)
  const midNoise = (fbm(x * 0.02, y * 0.02, seed + 100, 3) - 0.5) * 20;

  // Fine detail: small terrain variations (amplitude ~3m over 100m)
  const fineNoise = (fbm(x * 0.05, y * 0.05, seed + 200, 2) - 0.5) * 6;

  const elev = baseElevation + baseNoise + midNoise + fineNoise;

  return Math.round(elev * 10) / 10;
}

/**
 * Generate terrain profile along a given direction
 * Creates elevation data at regular intervals
 */
export function generateTerrainProfile(
  origin: GeoCoordinate,
  bearingDeg: number,
  maxDistance: number,
  stepSize: number = 50,
  terrainPoints?: TerrainPoint[]
): { distance: number; elevation: number; slope: number }[] {
  const profile: { distance: number; elevation: number; slope: number }[] = [];
  const baseElev = origin.elevation || syntheticElevation(origin.latitude, origin.longitude);

  for (let d = stepSize; d <= maxDistance; d += stepSize) {
    const point = destinationPoint(origin, bearingDeg, d);
    let elevation: number;

    if (terrainPoints && terrainPoints.length > 0) {
      elevation = getTerrainElevation(origin, bearingDeg, d, terrainPoints) ?? baseElev;
    } else {
      elevation = syntheticElevation(point.latitude, point.longitude, baseElev);
    }

    const prevElev = profile.length > 0 ? profile[profile.length - 1].elevation : baseElev;
    const slope = calculateSlope(
      { elevation: prevElev, distance: d - stepSize },
      { elevation, distance: d }
    );

    profile.push({ distance: d, elevation, slope });
  }

  return profile;
}

/**
 * Roughness length (z0) classification per IEC 61400-12-1
 */
export function roughnessClass(z0: number): { class: number; description: string } {
  if (z0 <= 0.0002) return { class: 0, description: 'Open water, sand' };
  if (z0 <= 0.005) return { class: 0.5, description: 'Smooth bare soil, concrete' };
  if (z0 <= 0.03) return { class: 1, description: 'Open agricultural land with few obstacles' };
  if (z0 <= 0.1) return { class: 1.5, description: 'Agricultural land with scattered obstacles' };
  if (z0 <= 0.25) return { class: 2, description: 'Agricultural land with many obstacles' };
  if (z0 <= 0.5) return { class: 2.5, description: 'Villages, small towns, farmland with hedges' };
  if (z0 <= 1.0) return { class: 3, description: 'Small towns, forest edges' };
  if (z0 <= 2.0) return { class: 3.5, description: 'Large towns, suburbs, dense forest' };
  return { class: 4, description: 'City centers, industrial areas' };
}

/**
 * Normalize angle to [0, 360) range
 */
export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

/**
 * Check if angle is within sector range
 */
export function isAngleInSector(
  angle: number,
  sectorFrom: number,
  sectorTo: number
): boolean {
  const normalizedAngle = normalizeAngle(angle);
  const normalizedFrom = normalizeAngle(sectorFrom);
  const normalizedTo = normalizeAngle(sectorTo);

  if (normalizedFrom <= normalizedTo) {
    return normalizedAngle >= normalizedFrom && normalizedAngle < normalizedTo;
  } else {
    // Wraps around 0/360
    return normalizedAngle >= normalizedFrom || normalizedAngle < normalizedTo;
  }
}
