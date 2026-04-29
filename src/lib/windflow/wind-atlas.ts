/**
 * Weibull Distribution & Wind Atlas Module
 *
 * Implements the Weibull probability distribution and the WASP-style
 * Wind Atlas method including reverse (site → generalized) and
 * forward (generalized → prediction site) transforms.
 *
 * All functions are pure with no side effects and no external dependencies.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Fitted Weibull distribution parameters. */
export interface WeibullParams {
  /** Scale parameter A (m/s) */
  A: number;
  /** Shape parameter k (dimensionless) */
  k: number;
  /** Arithmetic mean wind speed (m/s) */
  mean: number;
  /** Standard deviation of wind speed (m/s) */
  stdDev: number;
}

/** Observed wind climate at a specific measurement site. */
export interface SiteClimate {
  /** Anemometer measurement height (m) */
  z: number;
  /** Surface roughness length at measurement site (m) */
  z0: number;
  /** Weibull scale parameter (m/s) */
  A: number;
  /** Weibull shape parameter (dimensionless) */
  k: number;
  /** Number of directional sectors (e.g. 12 for 30-degree bins) */
  sectors: number;
  /** Frequency per sector (0–1, should sum to 1) */
  freq?: number[];
}

/** Generalized Wind Atlas entry for a single directional sector. */
export interface WindAtlasEntry {
  /** Generalized Weibull scale parameter (m/s) at standard conditions */
  A: number;
  /** Generalized Weibull shape parameter at standard conditions */
  k: number;
  /** Frequency in this sector (0–1) */
  sectorFreq: number;
}

/** Generalized Wind Atlas covering all directional sectors. */
export interface WindAtlas {
  /** Per-sector Weibull parameters and frequencies */
  sectors: WindAtlasEntry[];
  /** Total number of directional sectors */
  numSectors: number;
  /** Reference height for the generalized atlas (10 m) */
  refHeight: number;
  /** Reference roughness for the generalized atlas (0.03 m) */
  refRoughness: number;
}

/** Prediction site specification for the forward transform. */
export interface PredictionSite {
  /** Hub or measurement height at prediction site (m) */
  z: number;
  /** Surface roughness length at prediction site (m) */
  z0: number;
  /** Terrain speed-up factor (default 1.0) */
  terrainSpeedup?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Standard air density at sea level (kg/m³) */
const RHO = 1.225;

/** Standard Wind Atlas reference height (m) */
const Z_REF = 10;

/** Standard Wind Atlas reference roughness (m) – short grass */
const Z0_REF = 0.03;

// ---------------------------------------------------------------------------
// Lanczos Gamma Function
// ---------------------------------------------------------------------------

/**
 * Lanczos approximation of the Gamma function.
 *
 * Uses g = 7 and the 9-coefficient Lanczos series.
 * Accurate to approximately 15 significant digits for Re(z) > 0.
 *
 * @param z - Real positive number
 * @returns Γ(z)
 */
export function gammaFunction(z: number): number {
  // Lanczos coefficients for g = 7, n = 9
  const g = 7;
  const coefficients = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    // Reflection formula: Γ(z) = π / (sin(πz) · Γ(1 − z))
    return Math.PI / (Math.sin(Math.PI * z) * gammaFunction(1 - z));
  }

  // Shift z so that it lies in the Lanczos convergence region [0.5, 1.5)
  const zShifted = z - 1;
  let x = coefficients[0];

  for (let i = 1; i < coefficients.length; i++) {
    x += coefficients[i] / (zShifted + i);
  }

  const t = zShifted + g + 0.5;
  const sqrtTwoPi = Math.sqrt(2 * Math.PI);

  return sqrtTwoPi * Math.pow(t, zShifted + 0.5) * Math.exp(-t) * x;
}

// ---------------------------------------------------------------------------
// Weibull PDF & CDF
// ---------------------------------------------------------------------------

/**
 * Weibull probability density function.
 *
 * f(u) = (k / A) · (u / A)^(k−1) · exp(−(u / A)^k)
 *
 * @param u - Wind speed (m/s)
 * @param A - Scale parameter (m/s), must be > 0
 * @param k - Shape parameter, must be > 0
 * @returns Probability density at u
 */
export function weibullPDF(u: number, A: number, k: number): number {
  if (u <= 0 || A <= 0 || k <= 0) return 0;
  const ratio = u / A;
  return (k / A) * Math.pow(ratio, k - 1) * Math.exp(-Math.pow(ratio, k));
}

/**
 * Weibull cumulative distribution function.
 *
 * F(u) = 1 − exp(−(u / A)^k)
 *
 * @param u - Wind speed (m/s)
 * @param A - Scale parameter (m/s), must be > 0
 * @param k - Shape parameter, must be > 0
 * @returns Cumulative probability P(U ≤ u)
 */
export function weibullCDF(u: number, A: number, k: number): number {
  if (u <= 0 || A <= 0 || k <= 0) return 0;
  return 1 - Math.exp(-Math.pow(u / A, k));
}

// ---------------------------------------------------------------------------
// Weibull Statistics
// ---------------------------------------------------------------------------

/**
 * Arithmetic mean wind speed from Weibull parameters.
 *
 * mean = A · Γ(1 + 1/k)
 *
 * @param A - Scale parameter (m/s)
 * @param k - Shape parameter
 * @returns Mean wind speed (m/s)
 */
export function weibullMean(A: number, k: number): number {
  if (A <= 0 || k <= 0) return 0;
  return A * gammaFunction(1 + 1 / k);
}

/**
 * Energy pattern factor (cube factor) from Weibull parameters.
 *
 * K = Γ(1 + 3/k) / [Γ(1 + 1/k)]³
 *
 * This ratio relates the mean of the cube of the wind speed to the
 * cube of the mean wind speed. It is always ≥ 1 (by Jensen's inequality)
 * and equals 1 only for a constant (zero-variance) wind.
 *
 * @param A - Scale parameter (m/s)
 * @param k - Shape parameter
 * @returns Energy pattern factor K (dimensionless)
 */
export function energyPatternFactor(A: number, k: number): number {
  if (A <= 0 || k <= 0) return 1;
  const g1 = gammaFunction(1 + 1 / k);
  if (g1 === 0) return 1;
  const g3 = gammaFunction(1 + 3 / k);
  return g3 / (g1 * g1 * g1);
}

/**
 * Mean wind power density from Weibull parameters.
 *
 * P_mean = 0.5 · ρ · A³ · Γ(1 + 3/k)   [W/m²]
 *
 * where ρ = 1.225 kg/m³ (standard air density at sea level).
 *
 * @param A - Scale parameter (m/s)
 * @param k - Shape parameter
 * @returns Mean wind power density (W/m²)
 */
export function weibullMeanPower(A: number, k: number): number {
  if (A <= 0 || k <= 0) return 0;
  return 0.5 * RHO * Math.pow(A, 3) * gammaFunction(1 + 3 / k);
}

// ---------------------------------------------------------------------------
// Weibull Fitting (Method of Moments + MLE refinement)
// ---------------------------------------------------------------------------

/**
 * Fit a Weibull distribution to an array of observed wind speeds using
 * Method of Moments for the initial estimate followed by Newton-Raphson
 * MLE refinement.
 *
 * **Edge-case handling:**
 * - Empty array → returns all zeros
 * - Single data point → returns k = 1, A = value, stdDev = 0
 * - Negative or zero speeds are filtered out
 *
 * @param windSpeeds - Observed wind speed measurements (m/s)
 * @returns Fitted Weibull parameters
 */
export function fitWeibull(windSpeeds: number[]): WeibullParams {
  const empty: WeibullParams = { A: 0, k: 0, mean: 0, stdDev: 0 };

  if (windSpeeds.length === 0) return empty;

  // Filter out non-positive speeds
  const speeds = windSpeeds.filter((u) => u > 0);
  if (speeds.length === 0) return empty;

  // Mean & standard deviation
  const n = speeds.length;
  const sum = speeds.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  if (n === 1) {
    return { A: mean, k: 1, mean, stdDev: 0 };
  }

  const variance = speeds.reduce((a, u) => a + (u - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0 || mean === 0) {
    return { A: mean, k: 1, mean, stdDev };
  }

  // -----------------------------------------------------------------------
  // Step 1: Method of Moments initial estimate (Justus formula)
  // -----------------------------------------------------------------------
  const cv = stdDev / mean; // coefficient of variation
  let k = Math.pow(cv, -1.086);
  let A = mean / gammaFunction(1 + 1 / k);

  // Guard against degenerate initial values
  if (!isFinite(k) || k <= 0) k = 2;
  if (!isFinite(A) || A <= 0) A = mean;

  // -----------------------------------------------------------------------
  // Step 2: MLE refinement using Newton-Raphson on k
  //
  // The MLE equation for k (given A = k * n / Σ u^k) reduces to:
  //
  //   g(k) = Σ u_i^k · ln(u_i) / Σ u_i^k  −  1/k  −  (1/n)·Σ ln(u_i) = 0
  //
  // We iterate:  k_{new} = k − g(k) / g'(k)
  // -----------------------------------------------------------------------
  const sumLnU = speeds.reduce((a, u) => a + Math.log(u), 0);
  const meanLnU = sumLnU / n;

  const MAX_ITER = 100;
  const TOL = 1e-10;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let sumUk = 0;
    let sumUkLnU = 0;
    let sumUkLnU2 = 0;

    for (let i = 0; i < n; i++) {
      const u = speeds[i];
      const lnU = Math.log(u);
      const uk = Math.pow(u, k);
      sumUk += uk;
      sumUkLnU += uk * lnU;
      sumUkLnU2 += uk * lnU * lnU;
    }

    if (sumUk === 0) break;

    // g(k) = sumUkLnU / sumUk − 1/k − meanLnU
    const gk = sumUkLnU / sumUk - 1 / k - meanLnU;

    // g'(k) ≈ sumUkLnU2 / sumUk − (sumUkLnU / sumUk)² + 1/k²
    const gkPrime =
      sumUkLnU2 / sumUk -
      (sumUkLnU / sumUk) ** 2 +
      1 / (k * k);

    if (Math.abs(gkPrime) < 1e-30) break;

    const delta = gk / gkPrime;
    k -= delta;

    // Keep k in a physically reasonable range
    if (k < 0.5) k = 0.5;
    if (k > 50) k = 50;

    if (Math.abs(delta) < TOL * k) break;
  }

  // Recompute A from MLE relation: A = (Σ u_i^k / n)^(1/k)
  let sumUk = 0;
  for (let i = 0; i < n; i++) {
    sumUk += Math.pow(speeds[i], k);
  }
  A = Math.pow(sumUk / n, 1 / k);

  if (!isFinite(A) || A <= 0) A = mean;
  if (!isFinite(k) || k <= 0) k = 2;

  return { A, k, mean, stdDev };
}

// ---------------------------------------------------------------------------
// Wind Rose Frequency Distribution
// ---------------------------------------------------------------------------

/**
 * Bin wind data into directional sectors and compute per-sector statistics.
 *
 * Directions are in meteorological convention (0° = N, 90° = E, etc.).
 * Sectors are centered on 0, 360/n, 2·360/n, … degrees.
 *
 * @param windSpeeds  - Observed wind speeds (m/s), same length as directions
 * @param windDirections - Observed wind directions (degrees), meteorological convention
 * @param numSectors  - Number of directional sectors (e.g. 12 or 16)
 * @returns Object with frequency, mean speed, and fitted Weibull per sector
 */
export function calculateWindRoseFrequencies(
  windSpeeds: number[],
  windDirections: number[],
  numSectors: number
): { freq: number[]; meanSpeed: number[]; meanWeibull: WeibullParams[] } {
  const freq = new Array(numSectors).fill(0);
  const meanSpeed = new Array(numSectors).fill(0);
  const meanWeibull: WeibullParams[] = [];

  // Initialize per-sector storage
  const sectorSpeeds: number[][] = Array.from({ length: numSectors }, () => []);

  const n = Math.min(windSpeeds.length, windDirections.length);

  for (let i = 0; i < n; i++) {
    const speed = windSpeeds[i];
    const dir = ((windDirections[i] % 360) + 360) % 360;
    const sectorWidth = 360 / numSectors;
    const sectorIndex = Math.floor((dir + sectorWidth / 2) % 360 / sectorWidth);

    if (sectorIndex >= 0 && sectorIndex < numSectors) {
      sectorSpeeds[sectorIndex].push(speed);
    }
  }

  const totalValid = n > 0 ? n : 1;

  for (let s = 0; s < numSectors; s++) {
    const count = sectorSpeeds[s].length;
    freq[s] = count / totalValid;

    if (count > 0) {
      const sectorMean =
        sectorSpeeds[s].reduce((a, b) => a + b, 0) / count;
      meanSpeed[s] = sectorMean;
      meanWeibull[s] = fitWeibull(sectorSpeeds[s]);
    } else {
      meanSpeed[s] = 0;
      meanWeibull[s] = { A: 0, k: 0, mean: 0, stdDev: 0 };
    }
  }

  return { freq, meanSpeed, meanWeibull };
}

// ---------------------------------------------------------------------------
// Wind Atlas – Reverse Transform (Site → Generalized)
// ---------------------------------------------------------------------------

/**
 * Transform observed Weibull parameters at a specific measurement site into
 * the generalized Wind Atlas at standard reference conditions (z = 10 m,
 * z₀ = 0.03 m, neutral stability).
 *
 * The method uses a simplified power-law roughness/height correction
 * based on the logarithmic wind profile:
 *
 *   A_gen = A_site · [ ln(z_ref / z₀_ref) / ln(z_site / z₀_site) ]^(1/k)
 *
 * The shape parameter k is carried through unchanged (roughness effects
 * on k are minor in this simplified formulation).
 *
 * @param climate     - Observed site climate
 * @param numSectors  - Override number of sectors (defaults to climate.sectors)
 * @returns Generalized Wind Atlas
 */
export function reverseWindAtlas(
  climate: SiteClimate,
  numSectors?: number
): WindAtlas {
  const n = numSectors ?? climate.sectors;
  const { z, z0, A, k, freq } = climate;

  // Guard against degenerate inputs
  if (z <= 0 || z0 <= 0 || A <= 0 || k <= 0) {
    const emptySectors = Array.from({ length: n }, () => ({
      A: 0,
      k: 0,
      sectorFreq: 0,
    }));
    return {
      sectors: emptySectors,
      numSectors: n,
      refHeight: Z_REF,
      refRoughness: Z0_REF,
    };
  }

  // Logarithmic wind profile ratio
  const lnSite = Math.log(z / z0);
  const lnRef = Math.log(Z_REF / Z0_REF);
  const correctionFactor = lnRef > 0 && lnSite > 0 ? Math.pow(lnRef / lnSite, 1 / k) : 1;

  const A_gen = A * correctionFactor;

  // Build per-sector entries
  const sectorFreqs = freq && freq.length === n
    ? [...freq]
    : new Array(n).fill(1 / n);

  // Normalize frequencies to sum exactly to 1
  const freqSum = sectorFreqs.reduce((a, b) => a + b, 0);
  const normalizedFreq = freqSum > 0
    ? sectorFreqs.map((f) => f / freqSum)
    : new Array(n).fill(1 / n);

  const sectors: WindAtlasEntry[] = normalizedFreq.map((sf) => ({
    A: A_gen,
    k,
    sectorFreq: sf,
  }));

  return {
    sectors,
    numSectors: n,
    refHeight: Z_REF,
    refRoughness: Z0_REF,
  };
}

// ---------------------------------------------------------------------------
// Wind Atlas – Forward Transform (Generalized → Prediction Site)
// ---------------------------------------------------------------------------

/**
 * Transform the generalized Wind Atlas to Weibull parameters at a
 * prediction site with specified height, roughness, and optional
 * terrain speed-up.
 *
 *   A_pred = A_gen · [ ln(z_pred / z₀_pred) / ln(z_ref / z₀_ref) ]^(1/k) · speedup
 *
 * @param atlas - Generalized Wind Atlas (output of reverseWindAtlas)
 * @param site  - Prediction site specification
 * @returns Wind Atlas adjusted for the prediction site
 */
export function forwardWindAtlas(
  atlas: WindAtlas,
  site: PredictionSite
): WindAtlas {
  const { z, z0, terrainSpeedup = 1.0 } = site;
  const { refHeight, refRoughness } = atlas;

  // Guard against degenerate inputs
  if (z <= 0 || z0 <= 0) {
    return {
      sectors: atlas.sectors.map((s) => ({ ...s, A: 0, k: 0 })),
      numSectors: atlas.numSectors,
      refHeight: atlas.refHeight,
      refRoughness: atlas.refRoughness,
    };
  }

  const lnRef = Math.log(refHeight / refRoughness);
  const lnSite = Math.log(z / z0);

  const sectors: WindAtlasEntry[] = atlas.sectors.map((entry) => {
    const { A: A_gen, k, sectorFreq } = entry;

    if (A_gen <= 0 || k <= 0 || lnRef <= 0 || lnSite <= 0) {
      return { A: 0, k: 0, sectorFreq };
    }

    const correctionFactor = Math.pow(lnSite / lnRef, 1 / k);
    const A_pred = A_gen * correctionFactor * terrainSpeedup;

    return {
      A: isFinite(A_pred) ? A_pred : 0,
      k,
      sectorFreq,
    };
  });

  return {
    sectors,
    numSectors: atlas.numSectors,
    refHeight: atlas.refHeight,
    refRoughness: atlas.refRoughness,
  };
}
