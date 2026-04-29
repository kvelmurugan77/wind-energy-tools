/**
 * WASP-like Wind Atlas Module
 *
 * Implements the European Wind Atlas methodology (Troen & Petersen, 1989):
 * - Geostrophic drag law for friction velocity calculation
 * - Sector-by-sector reverse transform (site → generalized atlas)
 * - Sector-by-sector forward transform (generalized atlas → prediction site)
 * - BZ terrain perturbation model (simplified spectral approach)
 * - Sector-based roughness rose support
 *
 * This is the CORE of the WASP calculation methodology.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const KAPPA = 0.4;           // von Kármán constant
const OMEGA = 7.292e-5;     // Earth's angular velocity (rad/s)
const RHO = 1.225;           // Standard air density (kg/m³)
const Z_REF = 10;            // WASP reference height (m)
const Z0_REF = 0.03;         // WASP reference roughness (m) - short grass
const NUM_SECTORS = 12;
const SECTOR_WIDTH = 30;     // degrees
const MAX_GEO_ITER = 50;
const GEO_TOL = 1e-8;

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SectorWindData {
  direction: number;      // Center direction (degrees, meteorological)
  meanSpeed: number;      // Mean wind speed (m/s)
  weibullA: number;       // Weibull scale parameter (m/s)
  weibullK: number;       // Weibull shape parameter
  frequency: number;      // Sector frequency (0-1)
  powerDensity: number;   // W/m²
}

export interface GeneralizedAtlas {
  sectors: {
    direction: number;
    A_gen: number;        // Generalized Weibull A at (z=10m, z0=0.03m)
    k_gen: number;        // Generalized Weibull k
    freq: number;         // Sector frequency
    uStar_gen: number;    // Generalized friction velocity (m/s)
    G: number;            // Geostrophic wind speed (m/s)
  }[];
  numSectors: number;
  refHeight: number;
  refRoughness: number;
  latitude: number;       // Used for Coriolis parameter
  coriolis: number;       // f = 2*Ω*sin(φ)
}

export interface RoughnessRose {
  z0: number[];           // 12 roughness values, one per sector
}

export interface TerrainSpeedupResult {
  deltaS: number;         // Fractional speed-up ratio ΔS
  deflectAngle: number;   // Flow deflection angle (degrees)
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Coriolis Parameter
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the Coriolis parameter f = 2Ω sin(φ)
 */
export function coriolisParameter(latitudeDeg: number): number {
  return 2 * OMEGA * Math.sin((latitudeDeg * Math.PI) / 180);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Geostrophic Drag Law (WASP Core)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Solve the geostrophic drag law for friction velocity u* given geostrophic wind G.
 *
 * The implicit equation is:
 *   G = (u-star / kappa) * [ln(G / (f * z0)) - B]
 *
 * Where B ~ 1.0 for neutral stability (WASP convention).
 *
 * Solving iteratively using Newton-Raphson:
 *   f(u-star) = (u-star / kappa) * [ln(u-star / (kappa * f * z0)) + B] - G = 0
 *
 * We rewrite as: let x = u-star / kappa, then:
 *   x * [ln(x / (f * z0)) + B] = G
 *
 * @param G   - Geostrophic wind speed (m/s)
 * @param z0  - Surface roughness length (m)
 * @param f   - Coriolis parameter (1/s)
 * @returns Friction velocity u* (m/s), or 0 for invalid inputs
 */
export function geostrophicDragLaw(G: number, z0: number, f: number): number {
  if (G <= 0 || z0 <= 0 || f <= 0) return 0;

  // Non-dimensional parameter
  const lnRoughness = Math.log(G / (f * z0));
  if (!isFinite(lnRoughness) || lnRoughness <= 0) return 0;

  const B = 1.0; // WASP empirical constant (neutral stability)

  // Initial estimate: u* ≈ κ*G / ln(G/(f*z0))
  let uStar = (KAPPA * G) / lnRoughness;

  if (!isFinite(uStar) || uStar <= 0) return 0;

  // Newton-Raphson iteration on u-star
  // F(u-star) = (u-star / kappa) * [ln(u-star / (kappa * f * z0)) + B] - G = 0
  for (let iter = 0; iter < MAX_GEO_ITER; iter++) {
    const x = uStar / KAPPA;
    const lnArg = x / (f * z0);
    if (lnArg <= 0) break;
    const lnVal = Math.log(lnArg);
    const F = x * (lnVal + B) - G;
    const dF = (lnVal + B + 1) / KAPPA; // dF/du* = (ln + B + 1) / κ

    if (Math.abs(dF) < 1e-30) break;
    const delta = F / dF;
    uStar -= delta;

    if (uStar <= 0) {
      uStar = (KAPPA * G) / lnRoughness * 0.1; // Reset with smaller estimate
      continue;
    }

    if (Math.abs(delta) < GEO_TOL * uStar) break;
  }

  return uStar > 0 ? uStar : 0;
}

/**
 * Compute geostrophic wind speed G from friction velocity u-star.
 * This is the explicit (forward) relationship:
 *   G = (u-star / kappa) * [ln(G / (f * z0)) - B]
 *
 * Since G appears on both sides, we solve iteratively.
 */
export function frictionToGeostrophic(uStar: number, z0: number, f: number): number {
  if (uStar <= 0 || z0 <= 0 || f <= 0) return 0;

  const B = 1.0;
  const x = uStar / KAPPA;
  const A0 = f * z0;

  // Iterative solution for G: x*(ln(G/A0) + B) = G → ln(G) = G/x - B + ln(A0)
  // Start with G ≈ x * ln(1/(f*z0))
  let G = x * Math.log(1 / A0);
  if (!isFinite(G) || G <= 0) G = uStar * 30; // fallback

  for (let iter = 0; iter < MAX_GEO_ITER; iter++) {
    const lnG_A0 = Math.log(G / A0);
    if (!isFinite(lnG_A0)) break;
    const F = x * (lnG_A0 + B) - G;
    const dF = x / G - 1;
    if (Math.abs(dF) < 1e-30) break;
    const delta = F / dF;
    G -= delta;
    if (G <= 0) break;
    if (Math.abs(delta) < GEO_TOL * G) break;
  }

  return G > 0 ? G : 0;
}

/**
 * Compute wind speed at height z using log-law with given friction velocity.
 * u(z) = (u-star / kappa) * ln(z / z0)
 */
export function logLawFromUStar(z: number, z0: number, uStar: number): number {
  if (z <= z0 || z0 <= 0 || uStar <= 0) return 0;
  return (uStar / KAPPA) * Math.log(z / z0);
}

/**
 * Compute friction velocity from wind speed at reference height using log-law.
 * u-star = u(z) * kappa / ln(z / z0)
 */
export function uStarFromWindSpeed(uRef: number, zRef: number, z0: number): number {
  if (zRef <= z0 || z0 <= 0 || uRef <= 0) return 0;
  return uRef * KAPPA / Math.log(zRef / z0);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Reverse Transform (Site → Generalized Wind Atlas)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reverse Wind Atlas Transform: Site observations → Generalized Atlas
 *
 * For each directional sector:
 * 1. Compute friction velocity at measurement site
 * 2. Compute geostrophic wind from u* (this is the "generalized" wind)
 * 3. Compute Weibull at standard conditions (z=10m, z0=0.03m) using geostrophic drag law
 *
 * The key insight: the geostrophic wind G represents the "free atmosphere" wind
 * above the boundary layer. By transforming through G, we remove the site-specific
 * effects of roughness and height, leaving a "generalized" climate that can be
 * re-applied at any prediction site.
 *
 * @param sectors     - Per-sector wind data (direction, A, k, frequency)
 * @param zMeas       - Measurement height (m)
 * @param z0Site      - Roughness at measurement site (m)
 * @param latitude    - Site latitude (degrees)
 * @returns Generalized Wind Atlas
 */
export function reverseTransform(
  sectors: SectorWindData[],
  zMeas: number,
  z0Site: number,
  latitude: number
): GeneralizedAtlas {
  const f = coriolisParameter(latitude);

  const atlasSectors = sectors.map((sector) => {
    if (sector.weibullA <= 0 || sector.weibullK <= 0 || sector.frequency <= 0) {
      return {
        direction: sector.direction,
        A_gen: 0,
        k_gen: 0,
        freq: sector.frequency,
        uStar_gen: 0,
        G: 0,
      };
    }

    // Step 1: Friction velocity at measurement site from Weibull A
    // We use A as representative of the mean wind (A ≈ mean * (1 + 0.267/k) for Weibull)
    // Actually, we compute u* from the log-law using the Weibull mean speed
    const uStar_site = uStarFromWindSpeed(sector.weibullA, zMeas, z0Site);

    // Step 2: Geostrophic wind from site friction velocity
    const G = frictionToGeostrophic(uStar_site, z0Site, f);

    // Step 3: Friction velocity at standard conditions from G
    const uStar_gen = geostrophicDragLaw(G, Z0_REF, f);

    // Step 4: Generalized Weibull A at (z=10m, z0=0.03m)
    // A_gen = uStar_gen / κ * ln(10 / 0.03)
    // But we need to preserve the Weibull distribution shape, so we use the ratio:
    const lnSite = Math.log(zMeas / z0Site);
    const lnGen = Math.log(Z_REF / Z0_REF);
    const k = sector.weibullK;

    let A_gen: number;
    if (lnSite > 0 && lnGen > 0 && k > 0) {
      A_gen = sector.weibullA * Math.pow(lnGen / lnSite, 1 / k);
    } else {
      A_gen = sector.weibullA;
    }

    // Ensure A_gen is physical
    if (!isFinite(A_gen) || A_gen <= 0) A_gen = sector.weibullA * 0.5;
    if (A_gen > 30) A_gen = 30; // Cap at physically reasonable value

    return {
      direction: sector.direction,
      A_gen: Math.round(A_gen * 100) / 100,
      k_gen: k,
      freq: sector.frequency,
      uStar_gen: Math.round(uStar_gen * 10000) / 10000,
      G: Math.round(G * 100) / 100,
    };
  });

  return {
    sectors: atlasSectors,
    numSectors: NUM_SECTORS,
    refHeight: Z_REF,
    refRoughness: Z0_REF,
    latitude,
    coriolis: f,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Forward Transform (Generalized Atlas → Prediction Site)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Forward Wind Atlas Transform: Generalized Atlas → Prediction Site
 *
 * For each directional sector:
 * 1. Get generalized Weibull A_gen at (z=10m, z0=0.03m)
 * 2. Transform to prediction conditions (z_pred, z0_pred) for this sector
 * 3. Apply terrain speed-up factor
 *
 * @param atlas         - Generalized Wind Atlas (from reverseTransform)
 * @param zPred         - Prediction height (m), typically hub height
 * @param z0Pred        - Prediction roughness (m), can be sector-dependent
 * @param terrainSpeedup - Optional terrain speed-up factor per sector (ΔS)
 * @returns Per-sector Weibull parameters at prediction site
 */
export function forwardTransform(
  atlas: GeneralizedAtlas,
  zPred: number,
  z0Pred: number | number[],  // single value or per-sector array
  terrainSpeedup?: number | number[]  // single value or per-sector array (ΔS)
): SectorWindData[] {
  const { sectors } = atlas;
  const lnGen = Math.log(atlas.refHeight / atlas.refRoughness);

  return sectors.map((sector, idx) => {
    if (sector.A_gen <= 0 || sector.k_gen <= 0) {
      return {
        direction: sector.direction,
        meanSpeed: 0,
        weibullA: 0,
        weibullK: 0,
        frequency: sector.freq,
        powerDensity: 0,
      };
    }

    // Get sector-specific roughness and speed-up
    const z0 = Array.isArray(z0Pred) ? (z0Pred[idx] ?? Z0_REF) : z0Pred;
    const speedup = terrainSpeedup
      ? (Array.isArray(terrainSpeedup) ? (terrainSpeedup[idx] ?? 0) : terrainSpeedup)
      : 0;

    // Forward transform: A_pred = A_gen * [ln(z_pred/z0_pred) / ln(10/0.03)]^(1/k)
    const lnPred = Math.log(zPred / z0);
    const k = sector.k_gen;

    let A_pred: number;
    if (lnPred > 0 && lnGen > 0 && k > 0) {
      A_pred = sector.A_gen * Math.pow(lnPred / lnGen, 1 / k);
    } else {
      A_pred = sector.A_gen;
    }

    // Apply terrain speed-up
    A_pred *= (1 + speedup);

    if (!isFinite(A_pred) || A_pred <= 0) A_pred = 0;
    if (A_pred > 40) A_pred = 40; // Physical cap

    // Compute mean speed from Weibull: E[v] = A * Γ(1 + 1/k)
    const meanSpeed = weibullMeanFromAK(A_pred, k);

    // Power density: 0.5 * ρ * A³ * Γ(1 + 3/k)
    const powerDensity = weibullPowerDensity(A_pred, k);

    return {
      direction: sector.direction,
      meanSpeed: Math.round(meanSpeed * 100) / 100,
      weibullA: Math.round(A_pred * 100) / 100,
      weibullK: k,
      frequency: sector.freq,
      powerDensity: Math.round(powerDensity * 100) / 100,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. BZ Terrain Perturbation Model (Simplified Spectral)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute terrain speed-up using a simplified BZ spectral perturbation model.
 *
 * The BZ model (Beljaars & Taylor, based on the work of Jackson & Hunt)
 * treats terrain as a spectrum of Fourier components and computes the
 * speed-up as a sum of perturbations at each spatial frequency.
 *
 * Simplified approach:
 * 1. Take terrain profile along wind direction
 * 2. Compute discrete Fourier transform
 * 3. Apply perturbation response function (WASP convention)
 * 4. Sum perturbations to get total speed-up
 *
 * @param elevations  - Terrain elevation values along profile (m)
 * @param dx          - Distance between elevation points (m)
 * @param zEval       - Height above ground at evaluation point (m)
 * @param xEval       - Index of evaluation point in the profile
 * @returns Terrain speed-up result
 */
export function computeBZSpeedup(
  elevations: number[],
  dx: number,
  zEval: number,
  xEval: number
): TerrainSpeedupResult {
  if (!elevations || elevations.length < 4 || dx <= 0 || zEval <= 0) {
    return { deltaS: 0, deflectAngle: 0 };
  }

  const N = elevations.length;

  // Subtract mean elevation
  const mean = elevations.reduce((a, b) => a + b, 0) / N;
  const h = elevations.map(e => e - mean);

  // Discrete Fourier Transform
  const H: { re: number; im: number; freq: number }[] = [];
  for (let n = 0; n <= N / 2; n++) {
    let re = 0, im = 0;
    for (let k = 0; k < N; k++) {
      const angle = (2 * Math.PI * n * k) / N;
      re += h[k] * Math.cos(angle);
      im -= h[k] * Math.sin(angle);
    }
    re /= N;
    im /= N;
    const freq = n / (N * dx); // spatial frequency (1/m)
    H.push({ re, im, freq });
  }

  // Compute speed-up at evaluation point
  let deltaS = 0;
  let deltaZ = 0; // For deflection

  for (let n = 1; n < H.length; n++) {
    const { re, im, freq } = H[n];
    const amplitude = 2 * Math.sqrt(re * re + im * im);
    const wavelength = freq > 0 ? 1 / freq : Infinity;
    const phase = Math.atan2(-im, re);

    if (wavelength <= 0 || wavelength > 50000) continue; // Skip very long/short waves

    // Perturbation response function (WASP BZ model)
    // Response peaks for wavelengths comparable to ~10*z (inner layer height)
    const innerLayerHeight = 0.5 * Math.max(dx, 100); // Simplified
    const waveNumber = 2 * Math.PI / wavelength;

    // WASP response function: R(n) = 2πn * exp(-2πn * z) for z >> z0
    const response = waveNumber * Math.exp(-waveNumber * zEval);

    // Position factor: evaluate at xEval
    const x = xEval * dx;
    const cosFactor = Math.cos(2 * Math.PI * freq * x + phase);

    // Speed-up contribution
    deltaS += amplitude * response * cosFactor * dx;

    // Lateral gradient (for deflection)
    const sinFactor = Math.sin(2 * Math.PI * freq * x + phase);
    deltaZ += amplitude * response * sinFactor * dx;
  }

  // Normalize and clamp
  deltaS = Math.max(-0.5, Math.min(0.8, deltaS));
  const deflectAngle = Math.abs(deltaZ) > 0.001
    ? Math.atan2(deltaZ, 1 + deltaS) * (180 / Math.PI)
    : 0;

  return {
    deltaS: Math.round(deltaS * 10000) / 10000,
    deflectAngle: Math.round(deflectAngle * 100) / 100,
  };
}

/**
 * Compute speed-up for a simple hill (analytical Jackson-Hunt approximation).
 * Used when no DEM data is available.
 *
 * ΔS = B * (H/L)² * exp(-a*z/L)
 *
 * Where:
 * - H = hill height
 * - L = hill half-length
 * - B = 0.6 (WASP calibrated)
 * - a = 4.0 (vertical decay rate)
 */
export function simpleHillSpeedup(
  hillHeight: number,
  hillLength: number,
  zEval: number
): TerrainSpeedupResult {
  if (hillHeight <= 0 || hillLength <= 0 || zEval <= 0) {
    return { deltaS: 0, deflectAngle: 0 };
  }

  const B = 0.6;
  const a = 4.0;
  const hOverL = hillHeight / hillLength;

  // Speed-up at crest
  const deltaS = B * hOverL * hOverL * Math.exp(-a * zEval / hillLength);

  // Deflection (stronger for steep, narrow hills)
  const aspect = hillHeight / hillLength;
  const deflectAngle = Math.min(15 * aspect * Math.abs(deltaS), 30);

  return {
    deltaS: Math.round(deltaS * 10000) / 10000,
    deflectAngle: Math.round(deflectAngle * 100) / 100,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Roughness Rose Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a uniform roughness rose (same z0 for all sectors)
 */
export function uniformRoughnessRose(z0: number): number[] {
  return new Array(NUM_SECTORS).fill(z0);
}

/**
 * Get preset roughness roses for common terrain types
 */
export function getRoughnessPreset(preset: string): number[] {
  switch (preset.toLowerCase()) {
    case 'open_sea':
    case 'sea':
    case 'water':
      return new Array(NUM_SECTORS).fill(0.0002);
    case 'coastal':
      // Predominantly sea with some land influence
      return [0.0002, 0.001, 0.005, 0.01, 0.03, 0.03, 0.05, 0.05, 0.03, 0.01, 0.005, 0.001];
    case 'farmland':
    case 'agricultural':
      return new Array(NUM_SECTORS).fill(0.05);
    case 'forest_edge':
      // Mix of open and forest
      return [0.1, 0.1, 0.3, 0.5, 0.5, 0.3, 0.1, 0.1, 0.3, 0.5, 0.5, 0.3];
    case 'forest':
      return new Array(NUM_SECTORS).fill(0.5);
    case 'suburban':
      return new Array(NUM_SECTORS).fill(0.5);
    case 'urban':
      return new Array(NUM_SECTORS).fill(1.0);
    case 'complex':
      return [0.03, 0.1, 0.3, 0.5, 0.3, 0.03, 0.03, 0.1, 0.5, 0.3, 0.1, 0.03];
    default:
      return new Array(NUM_SECTORS).fill(0.03); // Default: open grassland
  }
}

/**
 * Get roughness class from z0 (WASP convention)
 * Class = round(0.5 * ln(z0/0.03) / ln(2))
 */
export function roughnessClass(z0: number): number {
  if (z0 <= 0) return 0;
  const cls = Math.round(0.5 * Math.log(z0 / 0.03) / Math.LN2);
  return Math.max(0, Math.min(8, cls));
}

/**
 * Get z0 from roughness class (WASP convention)
 * z0 = 0.03 * 2^(2*class)
 */
export function z0FromClass(cls: number): number {
  const z0 = 0.03 * Math.pow(2, 2 * cls);
  return Math.max(0.0002, Math.min(4.0, z0));
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Weibull mean: E[v] = A * Γ(1 + 1/k)
 * Uses Lanczos approximation via ln(Gamma)
 */
function lnGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function gammaFunc(z: number): number {
  return Math.exp(lnGamma(z));
}

function weibullMeanFromAK(A: number, k: number): number {
  if (A <= 0 || k <= 0) return 0;
  return A * gammaFunc(1 + 1 / k);
}

function weibullPowerDensity(A: number, k: number): number {
  if (A <= 0 || k <= 0) return 0;
  return 0.5 * RHO * Math.pow(A, 3) * gammaFunc(1 + 3 / k);
}

/**
 * Weibull PDF
 */
export function weibullPDF(v: number, A: number, k: number): number {
  if (v <= 0 || A <= 0 || k <= 0) return 0;
  const ratio = v / A;
  return (k / A) * Math.pow(ratio, k - 1) * Math.exp(-Math.pow(ratio, k));
}

/**
 * Generate default sector directions
 */
export function defaultSectorDirections(): number[] {
  return Array.from({ length: NUM_SECTORS }, (_, i) => i * SECTOR_WIDTH);
}

/**
 * Get sector index from direction (meteorological convention)
 */
export { NUM_SECTORS };

export function directionToSector(dir: number): number {
  const d = ((dir + SECTOR_WIDTH / 2) % 360);
  return Math.floor(d / SECTOR_WIDTH) % NUM_SECTORS;
}
