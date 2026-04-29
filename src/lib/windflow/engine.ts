/**
 * Wind Flow Physics Engine
 *
 * Core wind resource assessment physics similar to WASP / Greenwich DTU.
 * All functions are pure (no side effects) and handle edge cases defensively.
 *
 * @module engine
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** von Kármán constant (dimensionless) */
const KAPPA = 0.4;

/** Reference roughness length used in the WASP roughness-class formula (m) */
const WASP_Z0_REF = 0.03;

/** Default power-law exponent for neutral atmospheric stability */
const DEFAULT_ALPHA = 0.14;

// ---------------------------------------------------------------------------
// 1. Log-law wind profile
// ---------------------------------------------------------------------------

/**
 * Computes the mean wind speed at height `z` using the logarithmic wind profile.
 *
 * ```
 * u(z) = (u* / κ) · ln(z / z₀)
 * ```
 *
 * @param z   - Height above ground (m). Must be > 0.
 * @param z0  - Surface roughness length (m). Must be > 0.
 * @param uStar - Friction velocity (m/s).
 * @returns Mean wind speed at height z (m/s). Returns 0 when inputs are invalid.
 */
export function logLawWindProfile(z: number, z0: number, uStar: number): number {
  if (z <= 0 || z0 <= 0 || !isFinite(z) || !isFinite(z0) || !isFinite(uStar)) {
    return 0;
  }
  if (z <= z0) {
    // Below the roughness length the log-law is undefined; return 0.
    return 0;
  }
  return (uStar / KAPPA) * Math.log(z / z0);
}

// ---------------------------------------------------------------------------
// 2. Power-law wind profile
// ---------------------------------------------------------------------------

/**
 * Computes the mean wind speed at height `z` using the power-law profile.
 *
 * ```
 * u(z) = uRef · (z / zRef)^α
 * ```
 *
 * @param z     - Height above ground (m). Must be > 0.
 * @param zRef  - Reference height (m). Must be > 0.
 * @param uRef  - Wind speed at reference height (m/s).
 * @param alpha - Power-law exponent (dimensionless). Defaults to 0.14 (neutral).
 * @returns Mean wind speed at height z (m/s). Returns 0 when inputs are invalid.
 */
export function powerLawWindProfile(
  z: number,
  zRef: number,
  uRef: number,
  alpha: number = DEFAULT_ALPHA,
): number {
  if (z <= 0 || zRef <= 0 || !isFinite(z) || !isFinite(zRef) || !isFinite(uRef) || !isFinite(alpha)) {
    return 0;
  }
  return uRef * Math.pow(z / zRef, alpha);
}

// ---------------------------------------------------------------------------
// 3. Friction velocity from reference wind
// ---------------------------------------------------------------------------

/**
 * Derives friction velocity (u*) from a known reference wind speed using the
 * log-law relationship.
 *
 * ```
 * u* = uRef · κ / ln(zRef / z₀)
 * ```
 *
 * @param uRef - Reference wind speed (m/s).
 * @param zRef - Reference height (m). Must be > 0 and > z0.
 * @param z0   - Surface roughness length (m). Must be > 0.
 * @returns Friction velocity u* (m/s). Returns 0 when inputs are invalid.
 */
export function frictionVelocity(uRef: number, zRef: number, z0: number): number {
  if (
    zRef <= 0 ||
    z0 <= 0 ||
    !isFinite(uRef) ||
    !isFinite(zRef) ||
    !isFinite(z0)
  ) {
    return 0;
  }
  if (zRef <= z0) {
    return 0;
  }
  return uRef * KAPPA / Math.log(zRef / z0);
}

// ---------------------------------------------------------------------------
// 4. Roughness length classification (WASP convention)
// ---------------------------------------------------------------------------

/**
 * Converts a roughness length z₀ to a WASP roughness class.
 *
 * ```
 * class = round(0.5 · ln(z₀ / 0.03) / ln(2))
 * ```
 *
 * Valid range: class 0 (z₀ = 0.0002 m) to class 8 (z₀ ≈ 4.0 m).
 * Values outside this range are clamped.
 *
 * @param z0 - Surface roughness length (m). Must be > 0.
 * @returns Roughness class (integer 0-8). Returns -1 for invalid input.
 */
export function roughnessClassFromZ0(z0: number): number {
  if (z0 <= 0 || !isFinite(z0)) {
    return -1;
  }
  const cls = Math.round(0.5 * Math.log(z0 / WASP_Z0_REF) / Math.LN2);
  return Math.max(0, Math.min(8, cls));
}

// ---------------------------------------------------------------------------
// 5. Jackson-Hunt terrain speed-up model (simplified)
// ---------------------------------------------------------------------------

/** Terrain profile used by the Jackson-Hunt model. */
export interface TerrainProfile {
  /** Distance along the wind direction (m). */
  distance: number[];
  /** Terrain elevation at each distance (m). */
  elevation: number[];
}

/**
 * Computes the fractional speed-up ratio ΔS/uRef at a given point above a
 * hill using a simplified Jackson-Hunt / BZ model.
 *
 * ```
 * ΔS = B · (h / L) · exp(-a · z / L)
 * ```
 *
 * - `B` = 0.25 (peak speed-up coefficient)
 * - `a` = 3 (vertical decay parameter)
 * - `h` = hill height above upwind terrain at position `x`
 * - `L` = horizontal length scale of the hill
 *
 * @param profile - Terrain profile (distance & elevation arrays).
 * @param x       - Position along the profile (m).
 * @param z       - Height above local ground (m).
 * @param L       - Horizontal length scale of the hill (m). Must be > 0.
 * @returns Fractional speed-up ratio ΔS (dimensionless). 0 for invalid input.
 */
export function jacksonHuntSpeedup(
  profile: TerrainProfile,
  x: number,
  z: number,
  L: number,
): number {
  if (
    !profile ||
    !Array.isArray(profile.distance) ||
    !Array.isArray(profile.elevation) ||
    profile.distance.length < 2 ||
    profile.distance.length !== profile.elevation.length ||
    !isFinite(x) ||
    !isFinite(z) ||
    !isFinite(L) ||
    L <= 0
  ) {
    return 0;
  }

  // Determine upwind terrain elevation (minimum of profile)
  const upwindElevation = Math.min(...profile.elevation);

  // Interpolate local elevation at position x
  const localElevation = interpolateElevation(profile, x);
  if (localElevation === null) {
    return 0;
  }

  const h = localElevation - upwindElevation;
  if (h <= 0) {
    // Only positive speed-up over elevated terrain
    return 0;
  }

  const B = 0.25;
  const a = 3;

  return B * (h / L) * Math.exp(-a * z / L);
}

/**
 * Linearly interpolates terrain elevation at a given distance.
 * Returns null when `x` is outside the profile extent.
 */
function interpolateElevation(profile: TerrainProfile, x: number): number | null {
  const { distance, elevation } = profile;

  if (x < distance[0] || x > distance[distance.length - 1]) {
    return null;
  }

  // Exact match
  for (let i = 0; i < distance.length; i++) {
    if (distance[i] === x) {
      return elevation[i];
    }
  }

  // Binary search for the enclosing segment
  let lo = 0;
  let hi = distance.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (distance[mid] <= x) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const t = (x - distance[lo]) / (distance[hi] - distance[lo]);
  return elevation[lo] + t * (elevation[hi] - elevation[lo]);
}

// ---------------------------------------------------------------------------
// 6. Elliott Internal Boundary Layer (IBL) for roughness changes
// ---------------------------------------------------------------------------

/** Result of the Elliott IBL model. */
export interface ElliottIBLResult {
  /** Height of the internal boundary layer (m). */
  deltaIBL: number;
  /**
   * Wind speed adjustment factor at any height z.
   *
   * Below the IBL height: logarithmic interpolation between upstream and
   * downstream profiles.
   * Above the IBL height: upstream (undisturbed) profile.
   */
  getAdjustedWind: (z: number, uUpstream: number) => number;
}

/**
 * Computes the Internal Boundary Layer height and provides a closure for
 * adjusting wind speed profiles following a roughness change (Elliott 1958).
 *
 * ```
 * δ_IBL = 0.28 · (z₀_down / z₀_up)^0.8 · x^0.8
 * ```
 *
 * @param x             - Distance downwind of the roughness change (m). Must be ≥ 0.
 * @param z0Upstream    - Upstream roughness length (m). Must be > 0.
 * @param z0Downstream  - Downstream roughness length (m). Must be > 0.
 * @param uStarUpstream - Upstream friction velocity (m/s).
 * @returns IBL height, adjustment factor, and a closure for wind speed at any height.
 */
export function elliottIBL(
  x: number,
  z0Upstream: number,
  z0Downstream: number,
  uStarUpstream: number,
): ElliottIBLResult {
  // Defaults for invalid input
  const emptyResult: ElliottIBLResult = {
    deltaIBL: 0,
    getAdjustedWind: (_z: number, uUpstream: number) => uUpstream,
  };

  if (
    x < 0 ||
    z0Upstream <= 0 ||
    z0Downstream <= 0 ||
    !isFinite(x) ||
    !isFinite(z0Upstream) ||
    !isFinite(z0Downstream) ||
    !isFinite(uStarUpstream)
  ) {
    return emptyResult;
  }

  if (x === 0) {
    return emptyResult;
  }

  // IBL height
  const ratio = z0Downstream / z0Upstream;
  const deltaIBL = 0.28 * Math.pow(ratio, 0.8) * Math.pow(x, 0.8);

  // Downstream friction velocity (from continuity of shear stress)
  const uStarDownstream =
    uStarUpstream * Math.pow(ratio, -0.2);

  /**
   * Computes the adjusted wind speed at height z.
   *
   * Below δ_IBL the profile transitions from upstream to downstream;
   * above δ_IBL the upstream profile is preserved.
   *
   * @param z          - Height above ground (m).
   * @param uUpstream  - Upstream wind speed at height z (m/s).
   * @returns Adjusted wind speed (m/s).
   */
  const getAdjustedWind = (z: number, uUpstream: number): number => {
    if (z <= 0 || !isFinite(z) || !isFinite(uUpstream)) {
      return 0;
    }

    if (z >= deltaIBL) {
      // Above the IBL: undisturbed upstream flow
      return uUpstream;
    }

    // Below the IBL: interpolate between upstream and downstream log profiles
    const lnZz0Up = z0Upstream > 0 ? Math.log(z / z0Upstream) : 0;
    const lnZz0Down = z0Downstream > 0 ? Math.log(z / z0Downstream) : 0;

    const uUpstreamProfile = lnZz0Up > 0
      ? (uStarUpstream / KAPPA) * lnZz0Up
      : 0;
    const uDownstreamProfile = lnZz0Down > 0
      ? (uStarDownstream / KAPPA) * lnZz0Down
      : 0;

    // Fractional blending height: 0 at ground, 1 at δ_IBL
    const blend = z / deltaIBL;

    return (1 - blend) * uDownstreamProfile + blend * uUpstreamProfile;
  };

  return { deltaIBL, getAdjustedWind };
}

// ---------------------------------------------------------------------------
// 7. Monin-Obukhov stability correction (Businger-Dyer)
// ---------------------------------------------------------------------------

/** Atmospheric stability classification. */
export type StabilityType = 'stable' | 'neutral' | 'unstable';

/** Parameters describing the atmospheric stability state. */
export interface StabilityParams {
  /** Surface roughness length (m). */
  z0: number;
  /**
   * Obukhov length (m).
   * - Positive → stable stratification
   * - Negative → unstable (convective) stratification
   * - Infinity / very large → neutral
   */
  L: number;
  /** Pre-computed stability classification. */
  type: StabilityType;
}

/**
 * Computes the Businger-Dyer stability correction function ψ.
 *
 * | Stability  | Formula                                                                 |
 * |------------|-------------------------------------------------------------------------|
 * | Stable     | ψ = −5 · (z / L)  for z/L > 0                                         |
 * | Unstable   | ψ = 2·ln((1 + √(1 − 16·z/L)) / 2)  for z/L < 0                      |
 * | Neutral    | ψ = 0                                                                   |
 *
 * @param z          - Height above ground (m).
 * @param stability  - Stability parameters (z₀, L, type).
 * @returns Stability correction ψ (dimensionless). 0 for neutral or invalid input.
 */
export function stabilityCorrectionPsi(z: number, stability: StabilityParams): number {
  if (z <= 0 || !isFinite(z) || !stability || !isFinite(stability.L)) {
    return 0;
  }

  const zeta = z / stability.L;

  if (stability.type === 'stable' && zeta > 0) {
    // Stable: ψ = -5·(z/L), capped to prevent extreme corrections
    return -5 * Math.min(zeta, 5);
  }

  if (stability.type === 'unstable' && zeta < 0) {
    // Unstable: Businger-Dyer free-convection form
    const argument = 1 - 16 * zeta; // zeta < 0 ⇒ argument > 1
    return 2 * Math.log((1 + Math.sqrt(argument)) / 2);
  }

  // Neutral or small |z/L|
  return 0;
}

/**
 * Computes the mean wind speed at height z using the stability-corrected
 * log-law profile (Monin-Obukhov similarity theory).
 *
 * ```
 * u(z) = (u* / κ) · [ln(z / z₀) − ψ(z / L)]
 * ```
 *
 * @param z          - Height above ground (m).
 * @param z0         - Surface roughness length (m).
 * @param uStar      - Friction velocity (m/s).
 * @param stability  - Stability parameters.
 * @returns Mean wind speed at height z (m/s). 0 for invalid input.
 */
export function stabilityCorrectedProfile(
  z: number,
  z0: number,
  uStar: number,
  stability: StabilityParams,
): number {
  if (z <= 0 || z0 <= 0 || !isFinite(z) || !isFinite(z0) || !isFinite(uStar)) {
    return 0;
  }
  if (z <= z0) {
    return 0;
  }

  const psi = stabilityCorrectionPsi(z, stability);
  return (uStar / KAPPA) * (Math.log(z / z0) - psi);
}

// ---------------------------------------------------------------------------
// 8. Flow deflection around terrain
// ---------------------------------------------------------------------------

/**
 * Estimates the wind flow deflection angle caused by terrain effects.
 *
 * Higher aspect ratios (narrow ridges) and larger speed-up ratios produce
 * stronger lateral deflection toward the ridge crest.
 *
 * ```
 * δθ = 15° · (aspectRatio · speedupRatio)^0.6
 * ```
 *
 * The empirical constants are calibrated to typical mid-latitude terrain.
 *
 * @param hillAspect   - Ratio of perpendicular to parallel hill dimensions (> 0).
 * @param speedupRatio - Fractional speed-up ratio ΔS/uRef (dimensionless).
 * @returns Deflection angle in degrees (0-45°). 0 for invalid input.
 */
export function flowDeflectionAngle(
  hillAspect: number,
  speedupRatio: number,
): number {
  if (!isFinite(hillAspect) || !isFinite(speedupRatio) || hillAspect <= 0 || speedupRatio <= 0) {
    return 0;
  }

  const rawAngle = 15 * Math.pow(hillAspect * speedupRatio, 0.6);
  // Cap at a physically reasonable maximum
  return Math.min(rawAngle, 45);
}

// ---------------------------------------------------------------------------
// 9. Turbulence intensity estimation
// ---------------------------------------------------------------------------

/**
 * Estimates the longitudinal turbulence intensity at height z.
 *
 * ```
 * TI = σ_u / ū
 * ```
 *
 * Where:
 * - Neutral: σ_u = 2.4 · u*  (standard ESDU approach)
 * - Stable: σ_u = 1.3 · u*  (suppressed turbulence)
 * - Unstable: σ_u = 2.5 · u* + roughness enhancement
 *
 * A roughness-dependent component is added to reflect mechanical mixing
 * over rougher surfaces.
 *
 * @param uStar     - Friction velocity (m/s).
 * @param uMean     - Mean wind speed at height z (m/s).
 * @param z         - Height above ground (m).
 * @param z0        - Surface roughness length (m).
 * @param stability - Atmospheric stability type. Defaults to 'neutral'.
 * @returns Turbulence intensity (fraction 0-1). 0 for invalid input.
 */
export function turbulenceIntensity(
  uStar: number,
  uMean: number,
  z: number,
  z0: number,
  stability: StabilityType = 'neutral',
): number {
  if (
    !isFinite(uStar) ||
    !isFinite(uMean) ||
    !isFinite(z) ||
    !isFinite(z0) ||
    uMean <= 0 ||
    z <= 0 ||
    z0 <= 0
  ) {
    return 0;
  }

  // Base standard deviation depending on stability
  let sigmaU: number;

  switch (stability) {
    case 'stable':
      sigmaU = 1.3 * uStar;
      break;
    case 'unstable':
      sigmaU = 2.5 * uStar;
      break;
    case 'neutral':
    default:
      sigmaU = 2.4 * uStar;
      break;
  }

  // Roughness-dependent enhancement (mechanical turbulence over rough terrain)
  // Normalized z0 contribution: larger z0 → more turbulence
  const roughnessFactor = 0.1 * Math.log(1 + z0 / 0.03);
  sigmaU += roughnessFactor * uStar;

  const ti = sigmaU / uMean;

  // Physically plausible upper bound (~50 %)
  return Math.min(ti, 0.5);
}

// ---------------------------------------------------------------------------
// 10. Surface roughness from land cover
// ---------------------------------------------------------------------------

/**
 * Mapping of land-cover categories to representative roughness lengths z₀ (m).
 *
 * Values follow the WAsP / European Wind Atlas conventions.
 */
export const LAND_COVER_ROUGHNESS: Record<string, number> = {
  water: 0.0002,
  bare_ground: 0.005,
  grassland: 0.03,
  crops: 0.05,
  shrubs: 0.1,
  open_forest: 0.5,
  dense_forest: 1.0,
  urban: 1.0,
  suburban: 0.5,
  wetland: 0.03,
  snow_ice: 0.001,
  desert: 0.003,
  savanna: 0.15,
  mosaic: 0.1,
};

/** Human-readable description for roughness classes and typical land covers. */
const ROUGHNESS_DESCRIPTIONS: Array<{
  maxZ0: number;
  name: string;
  description: string;
  cls: number;
}> = [
  { maxZ0: 0.0005, name: 'Water / Sea', description: 'Open water surfaces, calm sea', cls: 0 },
  { maxZ0: 0.002, name: 'Smooth', description: 'Bare sand, snow, tidal flats, calm open sea', cls: 0 },
  { maxZ0: 0.01, name: 'Open', description: 'Beach, snow-covered plains, flat desert', cls: 1 },
  { maxZ0: 0.02, name: 'Very Open', description: 'Short grass, airport runways, fallow land', cls: 1 },
  { maxZ0: 0.05, name: 'Open', description: 'Grassland, few isolated obstacles', cls: 2 },
  { maxZ0: 0.1, name: 'Slightly Open', description: 'Farmland with hedges, scattered bushes', cls: 2 },
  { maxZ0: 0.25, name: 'Rough', description: 'Crops, shrubland, small forest gaps', cls: 3 },
  { maxZ0: 0.5, name: 'Very Rough', description: 'Open forest, suburban areas, orchards', cls: 3 },
  { maxZ0: 1.0, name: 'Closed', description: 'Dense forest, dense suburban, urban edges', cls: 4 },
  { maxZ0: 2.0, name: 'Very Closed', description: 'Urban centres, industrial zones', cls: 4 },
  { maxZ0: 4.0, name: 'Extreme', description: 'Dense urban / city centre, large obstacles', cls: 5 },
];

/**
 * Classifies a roughness length z₀ into a descriptive category.
 *
 * @param z0 - Surface roughness length (m). Must be > 0.
 * @returns An object with `name`, `description`, and WASP roughness `class`.
 *          Returns a fallback for invalid input.
 */
export function classifyRoughness(z0: number): {
  name: string;
  description: string;
  class: number;
} {
  if (z0 <= 0 || !isFinite(z0)) {
    return {
      name: 'Invalid',
      description: 'Roughness length must be positive and finite',
      class: -1,
    };
  }

  const cls = roughnessClassFromZ0(z0);

  // Find the best-matching description
  for (const entry of ROUGHNESS_DESCRIPTIONS) {
    if (z0 <= entry.maxZ0) {
      return {
        name: entry.name,
        description: entry.description,
        class: cls,
      };
    }
  }

  // z0 > 4 m → extreme
  return {
    name: 'Extreme',
    description: 'Very large roughness elements, dense urban core',
    class: Math.min(cls, 8),
  };
}
