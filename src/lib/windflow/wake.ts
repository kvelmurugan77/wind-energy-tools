/**
 * PARK1 Wake Model with Gaussian Radial Profile
 *
 * Implements the PARK1 engineering wake model with:
 * - Katic wake expansion formula
 * - Gaussian radial velocity deficit profile
 * - Multiple wake superposition methods (RSS, SUM, MAX)
 * - Directional wake analysis for full wind farms
 *
 * Wind direction follows meteorological convention:
 * degrees clockwise from North, indicating the direction wind comes FROM.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Parameters for the PARK1 wake deficit calculation */
export interface WakeParams {
  /** Rotor diameter (m) */
  D0: number;
  /** Thrust coefficient (dimensionless, 0–1) */
  Ct: number;
  /** Wake decay constant (onshore ≈ 0.04–0.075, default 0.075) */
  k_wake: number;
}

/** Supported wake superposition methods */
export type SuperpositionMethod = 'RSS' | 'SUM' | 'MAX';

/** Wind turbine definition */
export interface Turbine {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** East coordinate (m) */
  x: number;
  /** North coordinate (m) */
  y: number;
  /** Hub height above ground (m) */
  hubHeight: number;
  /** Rotor diameter (m) */
  rotorDiameter: number;
  /** Rated power output (kW) */
  ratedPower: number;
  /** Rated wind speed (m/s) */
  ratedSpeed: number;
  /** Cut-in wind speed (m/s) */
  cutInSpeed: number;
  /** Cut-out wind speed (m/s) */
  cutOutSpeed: number;
}

/** Wake contribution detail from a single upstream turbine */
export interface WakeContributor {
  /** ID of the upstream (wake-source) turbine */
  sourceId: string;
  /** Fractional velocity deficit at the downstream rotor (0–1) */
  deficit: number;
  /** Longitudinal distance between turbines along wind direction (m) */
  distance: number;
  /** Angle (degrees) between the wind direction vector and the line connecting the turbines */
  angle: number;
}

/** Wake result for a single turbine within the farm */
export interface WakeResult {
  /** Turbine ID */
  turbineId: string;
  /** Free-stream (undisturbed) wind speed (m/s) */
  freeStreamSpeed: number;
  /** Effective wind speed at rotor after wake losses (m/s) */
  effectiveSpeed: number;
  /** Total fractional velocity deficit (0–1) */
  totalDeficit: number;
  /** Power output after wake losses (kW) */
  powerOutput: number;
  /** Instantaneous capacity factor (powerOutput / ratedPower) */
  capacityFactor: number;
  /** Individual wake contributions from upstream turbines */
  wakeContributors: WakeContributor[];
}

/** Wake analysis result for the entire wind farm under one wind condition */
export interface WindFarmWakeResult {
  /** Wind sector number (0-based) */
  sector: number;
  /** Center angle of the wind sector (degrees, meteorological convention) */
  sectorAngle: number;
  /** Free-stream wind speed used for the calculation (m/s) */
  windSpeed: number;
  /** Wind direction used for the calculation (degrees, meteorological convention) */
  windDirection: number;
  /** Ratio of actual (with-wake) power to ideal (no-wake) power */
  farmEfficiency: number;
  /** Wake loss as a percentage of ideal power */
  wakeLossPercent: number;
  /** Per-turbine wake results */
  results: WakeResult[];
}

/** Single point on a turbine power curve */
export type PowerCurvePoint = { windSpeed: number; power: number };

/** Result of a full directional (multi-sector) wake analysis */
export interface DirectionalWakeAnalysisResult {
  /** Per-sector wake results */
  sectorResults: WindFarmWakeResult[];
  /** Frequency-weighted farm efficiency across all sectors */
  overallEfficiency: number;
  /** Overall wake loss as a percentage */
  overallWakeLoss: number;
  /** Estimated annual energy production (GWh) */
  aep: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Default number of directional sectors */
const DEFAULT_NUM_SECTORS = 12;

/** Number of hours in a standard year */
const HOURS_PER_YEAR = 8760;

/** Typical onshore wake decay constant */
const DEFAULT_K_WAKE = 0.075;

/** Threshold below which a deficit is considered negligible */
const DEFICIT_THRESHOLD = 0.001;

/** Lateral distance threshold: skip turbines beyond this multiple of wake diameter */
const WAKE_OVERLAP_FACTOR = 1.0;

// ─── 1. Thrust Coefficient Estimation ────────────────────────────────────────

/**
 * Estimates the thrust coefficient (Ct) based on wind speed using a
 * simplified piecewise-linear model.
 *
 * | Region                  | Ct value                          |
 * |-------------------------|-----------------------------------|
 * | Below cut-in            | 0 (turbine not operating)         |
 * | Cut-in to rated         | 0.8 (typical maximum)             |
 * | Rated to cut-out        | Linearly decreasing: 0.8 → ~0.1   |
 * | Above cut-out           | 0 (turbine shut down)             |
 *
 * @param u - Wind speed (m/s)
 * @param ratedSpeed - Rated wind speed (m/s), default 12
 * @param cutInSpeed - Cut-in wind speed (m/s), default 3
 * @param cutOutSpeed - Cut-out wind speed (m/s), default 25
 * @returns Thrust coefficient (dimensionless, 0–0.8)
 *
 * @example
 * ```ts
 * estimateCt(5);   // 0.8  (between cut-in and rated)
 * estimateCt(18);  // 0.52 (above rated, linear decrease)
 * estimateCt(2);   // 0    (below cut-in)
 * estimateCt(30);  // 0    (above cut-out)
 * ```
 */
export function estimateCt(
  u: number,
  ratedSpeed: number = 12,
  cutInSpeed: number = 3,
  cutOutSpeed: number = 25,
): number {
  if (u < cutInSpeed || u > cutOutSpeed) return 0;
  if (u <= ratedSpeed) return 0.8;

  // Linear ramp from 0.8 at rated speed down to ~0.1 at cut-out
  const fraction = (u - ratedSpeed) / (cutOutSpeed - ratedSpeed);
  return 0.8 - 0.7 * fraction;
}

// ─── 2. Wake Diameter Expansion ──────────────────────────────────────────────

/**
 * Calculates the wake diameter at a given downstream distance using the
 * Katic (Jensen) expansion formula.
 *
 * **Katic formula:**
 * ```
 * D(x) = D0 * sqrt(1 + alpha * x / D0)
 * ```
 *
 * @param D0 - Rotor diameter of the upstream turbine (m)
 * @param x - Downstream distance from the rotor (m); must be ≥ 0
 * @param Ct - Thrust coefficient (kept for API compatibility; not used
 *             in the Katic formula)
 * @param alpha - Wake expansion coefficient. Onshore ≈ 0.04–0.075.
 *                Default 0.04.
 * @returns Wake diameter at distance x (m)
 *
 * @example
 * ```ts
 * wakeDiameter(80, 500, 0.8, 0.04);  // ≈ 89.4 m
 * wakeDiameter(80, 0, 0.8);           // 80 m (at rotor)
 * ```
 */
export function wakeDiameter(
  D0: number,
  x: number,
  _Ct: number,
  alpha: number = 0.04,
): number {
  if (x <= 0) return D0;
  return D0 * Math.sqrt(1 + alpha * x / D0);
}

// ─── 3. PARK1 Wake Deficit (Gaussian Profile) ───────────────────────────────

/**
 * Computes the fractional velocity deficit at a point in the wake of an
 * upstream turbine using the PARK1 model with a Gaussian radial profile.
 *
 * **Centerline deficit:**
 * ```
 * ΔU/U₀ = (1 − √(1 − Ct)) / (1 + k_wake · x / D₀)²
 * ```
 *
 * **Gaussian radial profile:**
 * ```
 * deficit(x, r) = centerline × exp(−0.5 · r² / σ²)
 * ```
 *
 * where `r = √(y² + z²)` is the radial distance from the wake center
 * and `σ = D(x) / 2` is the Gaussian spread.
 *
 * @param x - Downstream distance from the rotor (m)
 * @param y - Lateral (cross-wind) offset from wake centerline (m)
 * @param z - Vertical offset from hub height (m)
 * @param freeStream - Free-stream wind speed (m/s). Used for reference;
 *                     the deficit ratio is independent of this value.
 * @param params - Wake model parameters (D0, Ct, k_wake)
 * @returns Fractional velocity deficit (0–1)
 *
 * @example
 * ```ts
 * park1Deficit(400, 0, 0, 10, { D0: 80, Ct: 0.8, k_wake: 0.075 });
 * // Centerline deficit at 400 m downstream
 * ```
 */
export function park1Deficit(
  x: number,
  y: number,
  z: number,
  _freeStream: number,
  params: WakeParams,
): number {
  const { D0, Ct, k_wake } = params;

  if (x <= 0) return 0;
  if (Ct <= 0 || Ct >= 1) return 0;

  // ── Centerline deficit ──
  const axialFactor = 1 + k_wake * x / D0;
  const centerlineDeficit =
    (1 - Math.sqrt(1 - Ct)) / (axialFactor * axialFactor);

  // ── Gaussian radial profile ──
  const D_wake = wakeDiameter(D0, x, Ct);
  const sigma = D_wake / 2;
  const rSquared = y * y + z * z;
  const sigmaSquared = sigma * sigma;

  // Avoid division by zero (should not happen since D_wake ≥ D0 > 0)
  if (sigmaSquared <= 0) return centerlineDeficit;

  const gaussianFactor = Math.exp(-0.5 * rSquared / sigmaSquared);

  return centerlineDeficit * gaussianFactor;
}

// ─── 4. Superposition Methods ────────────────────────────────────────────────

/**
 * Superposes multiple wake deficits into a single combined deficit.
 *
 * | Method | Formula                                               |
 * |--------|-------------------------------------------------------|
 * | RSS    | `√(Σ ΔUᵢ²)` — Root Sum Square (Katic, most common)   |
 * | SUM    | `Σ ΔUᵢ` — Linear sum, capped at 1.0                   |
 * | MAX    | `max(ΔUᵢ)` — Dominant wake only                        |
 *
 * @param deficits - Array of individual fractional deficits (each 0–1)
 * @param method - Superposition method. Default `'RSS'`.
 * @returns Combined fractional deficit (0–1)
 *
 * @example
 * ```ts
 * superposeDeficits([0.15, 0.10, 0.05], 'RSS');  // ≈ 0.187
 * superposeDeficits([0.15, 0.10, 0.05], 'SUM');  // 0.30
 * superposeDeficits([0.15, 0.10, 0.05], 'MAX');  // 0.15
 * ```
 */
export function superposeDeficits(
  deficits: number[],
  method: SuperpositionMethod = 'RSS',
): number {
  if (deficits.length === 0) return 0;

  switch (method) {
    case 'SUM':
      return Math.min(1.0, deficits.reduce((sum, d) => sum + d, 0));

    case 'MAX':
      return Math.max(...deficits);

    case 'RSS':
    default:
      return Math.min(
        1.0,
        Math.sqrt(deficits.reduce((sum, d) => sum + d * d, 0)),
      );
  }
}

// ─── 7. Power Curve ──────────────────────────────────────────────────────────

/**
 * Generates a default turbine power curve as an array of (windSpeed, power)
 * points in 0.5 m/s increments.
 *
 * | Region                  | Power output                    |
 * |-------------------------|---------------------------------|
 * | Below cut-in            | 0 kW                            |
 * | Cut-in to rated         | Cubic: `P_rated × ((u−u_in)/(u_r−u_in))³` |
 * | Rated to cut-out        | P_rated (constant)              |
 * | Above cut-out           | 0 kW                            |
 *
 * @param ratedPower - Rated power output (kW)
 * @param cutIn - Cut-in wind speed (m/s)
 * @param ratedSpeed - Rated wind speed (m/s)
 * @param cutOut - Cut-out wind speed (m/s)
 * @returns Array of power curve points
 *
 * @example
 * ```ts
 * const curve = getDefaultPowerCurve(5000, 3, 12, 25);
 * // [{ windSpeed: 0, power: 0 }, { windSpeed: 0.5, power: 0 }, ...]
 * ```
 */
export function getDefaultPowerCurve(
  ratedPower: number,
  cutIn: number,
  ratedSpeed: number,
  cutOut: number,
): PowerCurvePoint[] {
  const curve: PowerCurvePoint[] = [];
  const step = 0.5;
  // Use integer iteration to avoid floating-point accumulation
  const maxSteps = Math.ceil((cutOut + 1) / step);

  for (let i = 0; i <= maxSteps; i++) {
    const u = Math.round(i * step * 1000) / 1000; // millisecond precision
    let power: number;

    if (u < cutIn || u > cutOut) {
      power = 0;
    } else if (u <= ratedSpeed) {
      const ratio = (u - cutIn) / (ratedSpeed - cutIn);
      power = ratedPower * ratio * ratio * ratio;
    } else {
      power = ratedPower;
    }

    curve.push({ windSpeed: u, power });
  }

  return curve;
}

/**
 * Interpolates power output from a discrete power curve using linear
 * interpolation between adjacent points.
 *
 * - If `windSpeed` is below the first point or above the last point,
 *   returns 0 (turbine not operating).
 * - If `windSpeed` falls exactly on a curve point, returns that value.
 *
 * @param windSpeed - Wind speed at which to evaluate power (m/s)
 * @param powerCurve - Array of power curve points sorted by ascending wind speed
 * @returns Interpolated power output (kW)
 *
 * @example
 * ```ts
 * const curve = getDefaultPowerCurve(5000, 3, 12, 25);
 * interpolatePower(7.5, curve);  // Cubic interpolation result
 * interpolatePower(1, curve);    // 0 (below cut-in)
 * ```
 */
export function interpolatePower(
  windSpeed: number,
  powerCurve: PowerCurvePoint[],
): number {
  if (powerCurve.length === 0) return 0;

  const first = powerCurve[0];
  const last = powerCurve[powerCurve.length - 1];

  if (windSpeed <= first.windSpeed) return 0;
  if (windSpeed >= last.windSpeed) return 0;

  // Find the bracketing segment
  for (let i = 0; i < powerCurve.length - 1; i++) {
    const p0 = powerCurve[i];
    const p1 = powerCurve[i + 1];

    if (windSpeed >= p0.windSpeed && windSpeed <= p1.windSpeed) {
      const span = p1.windSpeed - p0.windSpeed;
      if (span === 0) return p0.power;

      const fraction = (windSpeed - p0.windSpeed) / span;
      return p0.power + fraction * (p1.power - p0.power);
    }
  }

  return 0;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Determines the sector number and center angle for a given wind direction.
 *
 * Sector layout (12-sector example):
 * - Sector 0:  345°–15°   → center 0°
 * - Sector 1:  15°–45°    → center 30°
 * - Sector 2:  45°–75°    → center 60°
 * - …
 * - Sector 11: 315°–345°  → center 330°
 *
 * @param windDirection - Wind direction in degrees (meteorological convention)
 * @param numSectors - Number of sectors (default 12)
 * @returns Sector number (0-based) and center angle in degrees
 */
function computeSector(
  windDirection: number,
  numSectors: number = DEFAULT_NUM_SECTORS,
): { sector: number; sectorAngle: number } {
  const sectorWidth = 360 / numSectors;
  // Offset by half a sector width so that sector boundaries fall between sectors
  const offset = ((windDirection + sectorWidth / 2) % 360 + 360) % 360;
  const sector = Math.floor(offset / sectorWidth) % numSectors;
  const sectorAngle = sector * sectorWidth;
  return { sector, sectorAngle };
}

/**
 * Converts a meteorological wind direction (direction FROM, degrees)
 * into Cartesian unit vector components representing the direction
 * the wind is traveling TO.
 *
 * @param windDirection - Wind direction (degrees, meteorological convention)
 * @returns Object with dx (east) and dy (north) components, plus perpendicular direction
 */
function windDirectionToVector(windDirection: number): {
  dx: number;
  dy: number;
  perpDx: number;
  perpDy: number;
} {
  const rad = windDirection * DEG_TO_RAD;
  // Wind direction vector (where wind GOES TO)
  const dx = -Math.sin(rad); // East component
  const dy = -Math.cos(rad); // North component
  // Perpendicular direction (90° CCW rotation for consistent sign convention)
  const perpDx = -dy;
  const perpDy = dx;
  return { dx, dy, perpDx, perpDy };
}

// ─── 5. Full Wind Farm Wake Calculation ──────────────────────────────────────

/**
 * Calculates wake effects across all turbines in a wind farm for a
 * single wind speed and direction.
 *
 * **Algorithm:**
 * 1. Convert wind direction to a Cartesian unit vector.
 * 2. For each turbine:
 *    a. Identify all upstream turbines (upwind of the current turbine).
 *    b. For each upstream turbine, compute the longitudinal (along-wind)
 *       distance, lateral (cross-wind) offset, and vertical offset.
 *    c. Check if the wake overlaps the downstream rotor.
 *    d. Calculate the wake deficit at the downstream rotor center.
 *    e. Superpose all individual deficits.
 *    f. Derive effective wind speed and power output.
 * 3. Aggregate to compute farm efficiency and wake loss percentage.
 *
 * @param turbines - Array of turbine definitions
 * @param windSpeed - Free-stream wind speed (m/s)
 * @param windDirection - Wind direction (degrees, meteorological convention,
 *                       i.e., direction the wind comes FROM)
 * @param method - Wake superposition method. Default `'RSS'`.
 * @returns Complete wake analysis result for the farm
 *
 * @example
 * ```ts
 * const result = calculateWindFarmWakes(turbines, 8.5, 210, 'RSS');
 * console.log(`Farm efficiency: ${(result.farmEfficiency * 100).toFixed(1)}%`);
 * ```
 */
export function calculateWindFarmWakes(
  turbines: Turbine[],
  windSpeed: number,
  windDirection: number,
  method: SuperpositionMethod = 'RSS',
): WindFarmWakeResult {
  const { sector, sectorAngle } = computeSector(windDirection);

  // ── Edge cases ──
  if (turbines.length === 0 || windSpeed <= 0) {
    return {
      sector,
      sectorAngle,
      windSpeed,
      windDirection,
      farmEfficiency: 0,
      wakeLossPercent: 0,
      results: [],
    };
  }

  const { dx: windDx, dy: windDy, perpDx, perpDy } =
    windDirectionToVector(windDirection);

  let totalIdealPower = 0;
  let totalActualPower = 0;
  const results: WakeResult[] = [];

  for (const turbine of turbines) {
    // ── Ideal (no-wake) power at free-stream speed ──
    const powerCurve = getDefaultPowerCurve(
      turbine.ratedPower,
      turbine.cutInSpeed,
      turbine.ratedSpeed,
      turbine.cutOutSpeed,
    );
    const idealPower = interpolatePower(windSpeed, powerCurve);
    totalIdealPower += idealPower;

    const wakeContributors: WakeContributor[] = [];
    const deficits: number[] = [];

    // ── Check each other turbine as a potential wake source ──
    for (const upstream of turbines) {
      if (upstream.id === turbine.id) continue;

      // Vector from upstream to current turbine
      const dx = turbine.x - upstream.x;
      const dy = turbine.y - upstream.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1) continue; // Coincident turbines — skip

      // Longitudinal distance (projection onto wind direction)
      const longitudinal = dx * windDx + dy * windDy;
      if (longitudinal <= 0) continue; // Not upwind — skip

      // Lateral offset (absolute distance from wake centerline)
      const lateral = Math.abs(dx * perpDx + dy * perpDy);

      // Vertical offset (hub height difference)
      const vertical = turbine.hubHeight - upstream.hubHeight;

      // ── Wake overlap check ──
      const upstreamCt = estimateCt(
        windSpeed,
        upstream.ratedSpeed,
        upstream.cutInSpeed,
        upstream.cutOutSpeed,
      );
      if (upstreamCt <= 0) continue; // Upstream turbine not operating

      const D_wake = wakeDiameter(upstream.rotorDiameter, longitudinal, upstreamCt);

      if (lateral > D_wake * WAKE_OVERLAP_FACTOR) continue; // No significant overlap

      // ── Calculate wake deficit ──
      const params: WakeParams = {
        D0: upstream.rotorDiameter,
        Ct: upstreamCt,
        k_wake: DEFAULT_K_WAKE,
      };

      const deficit = park1Deficit(
        longitudinal,
        lateral,
        vertical,
        windSpeed,
        params,
      );

      if (deficit <= DEFICIT_THRESHOLD) continue; // Negligible contribution

      deficits.push(deficit);

      // ── Angle between wind direction and turbine-connecting line ──
      const connDx = dx / dist;
      const connDy = dy / dist;
      const dotProduct = connDx * windDx + connDy * windDy;
      const clampedDot = Math.max(-1, Math.min(1, dotProduct));
      const angle = Math.acos(clampedDot) * RAD_TO_DEG;

      wakeContributors.push({
        sourceId: upstream.id,
        deficit,
        distance: longitudinal,
        angle,
      });
    }

    // ── Superpose deficits and derive results ──
    const totalDeficit = superposeDeficits(deficits, method);
    const effectiveSpeed = windSpeed * (1 - totalDeficit);
    const powerOutput = interpolatePower(effectiveSpeed, powerCurve);

    totalActualPower += powerOutput;

    results.push({
      turbineId: turbine.id,
      freeStreamSpeed: windSpeed,
      effectiveSpeed: Math.max(0, effectiveSpeed),
      totalDeficit,
      powerOutput,
      capacityFactor:
        turbine.ratedPower > 0 ? powerOutput / turbine.ratedPower : 0,
      wakeContributors,
    });
  }

  const farmEfficiency =
    totalIdealPower > 0 ? totalActualPower / totalIdealPower : 1;
  const wakeLossPercent = (1 - farmEfficiency) * 100;

  return {
    sector,
    sectorAngle,
    windSpeed,
    windDirection,
    farmEfficiency,
    wakeLossPercent,
    results,
  };
}

// ─── 6. Directional Wake Analysis ────────────────────────────────────────────

/**
 * Performs a full directional wake analysis across all wind sectors,
 * weighting results by sector frequency to produce an overall farm
 * efficiency and annual energy production (AEP) estimate.
 *
 * For each sector:
 * 1. Runs `calculateWindFarmWakes` with the sector's mean wind speed
 *    and center direction.
 * 2. Weights the result by the sector's frequency of occurrence.
 *
 * **AEP calculation:**
 * ```
 * AEP = Σᵢ (freqᵢ × P_total,ᵢ × 8760) / 1e6  [GWh]
 * ```
 *
 * @param turbines - Array of turbine definitions
 * @param windAtlas - Wind atlas with per-sector frequency (fraction, 0–1)
 *                   and mean wind speed. Both arrays must have equal length.
 * @param method - Wake superposition method. Default `'RSS'`.
 * @returns Directional wake analysis summary including per-sector results,
 *          overall efficiency, overall wake loss, and AEP in GWh
 *
 * @example
 * ```ts
 * const analysis = directionalWakeAnalysis(
 *   turbines,
 *   {
 *     sectorFreq: [0.08, 0.07, 0.06, 0.05, 0.04, 0.04, 0.04, 0.04, 0.05, 0.06, 0.07, 0.08],
 *     meanSpeed:  [8.5, 8.2, 7.8, 7.5, 7.2, 7.0, 7.1, 7.3, 7.6, 8.0, 8.3, 8.6],
 *   },
 *   'RSS',
 * );
 * console.log(`Overall efficiency: ${(analysis.overallEfficiency * 100).toFixed(1)}%`);
 * console.log(`AEP: ${analysis.aep.toFixed(2)} GWh`);
 * ```
 */
export function directionalWakeAnalysis(
  turbines: Turbine[],
  windAtlas: { sectorFreq: number[]; meanSpeed: number[] },
  method: SuperpositionMethod = 'RSS',
): DirectionalWakeAnalysisResult {
  const numSectors = windAtlas.sectorFreq.length;
  const sectorWidth = 360 / numSectors;

  // ── Edge cases ──
  if (numSectors === 0 || turbines.length === 0) {
    return {
      sectorResults: [],
      overallEfficiency: 1,
      overallWakeLoss: 0,
      aep: 0,
    };
  }

  const sectorResults: WindFarmWakeResult[] = [];
  let weightedEfficiencySum = 0;
  let totalFrequencyWeight = 0;
  let totalAEP_kWh = 0;

  for (let i = 0; i < numSectors; i++) {
    const freq = windAtlas.sectorFreq[i] ?? 0;
    const speed = windAtlas.meanSpeed[i] ?? 0;
    const windDirection = i * sectorWidth; // Center angle of sector i

    const result = calculateWindFarmWakes(turbines, speed, windDirection, method);
    sectorResults.push(result);

    // ── Accumulate frequency-weighted metrics ──
    weightedEfficiencySum += freq * result.farmEfficiency;
    totalFrequencyWeight += freq;

    // AEP contribution: frequency × total farm power × hours per year
    const sectorPower = result.results.reduce(
      (sum, r) => sum + r.powerOutput,
      0,
    );
    totalAEP_kWh += freq * sectorPower * HOURS_PER_YEAR;
  }

  const overallEfficiency =
    totalFrequencyWeight > 0
      ? weightedEfficiencySum / totalFrequencyWeight
      : 1;
  const overallWakeLoss = (1 - overallEfficiency) * 100;
  const aep = totalAEP_kWh / 1e6; // Convert kWh → GWh

  return {
    sectorResults,
    overallEfficiency,
    overallWakeLoss,
    aep,
  };
}
