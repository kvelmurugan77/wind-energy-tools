// ============================================================
// Wind Flow Model - Statistics & Weibull Fitting
// Frequency distribution, Weibull MLE fitting, gamma function
// ============================================================

import { WindRecord, WindClimate, SectorData, FrequencyTable } from './types';

const NUM_SECTORS = 12;
const SECTOR_WIDTH = 30; // degrees
const SPEED_BINS = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 
                    12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 25.5];
const AIR_DENSITY = 1.225; // kg/m^3 at sea level standard

/**
 * Get sector index (0-11) from direction in degrees
 */
export function getSector(direction: number): number {
  const d = ((direction + SECTOR_WIDTH / 2) % 360);
  return Math.floor(d / SECTOR_WIDTH) % NUM_SECTORS;
}

/**
 * Get center direction for a sector
 */
export function getSectorDirection(sector: number): number {
  return (sector * SECTOR_WIDTH + SECTOR_WIDTH / 2) % 360;
}

/**
 * Calculate wind frequency distribution
 */
export function calculateFrequencyDistribution(
  records: WindRecord[]
): { sectorData: Map<number, WindRecord[]>; frequencyTable: FrequencyTable } {
  const sectorMap = new Map<number, WindRecord[]>();
  for (let i = 0; i < NUM_SECTORS; i++) {
    sectorMap.set(i, []);
  }

  for (const record of records) {
    const sector = getSector(record.direction);
    sectorMap.get(sector)!.push(record);
  }

  // Build frequency table
  const frequency = Array.from({ length: NUM_SECTORS }, () =>
    new Array(SPEED_BINS.length).fill(0)
  );
  const sectorFreq = new Array(NUM_SECTORS).fill(0);
  const binFreq = new Array(SPEED_BINS.length).fill(0);

  for (let s = 0; s < NUM_SECTORS; s++) {
    const sectorRecords = sectorMap.get(s)!;
    sectorFreq[s] = sectorRecords.length;

    for (const record of sectorRecords) {
      // Find bin index
      let binIdx = -1;
      for (let b = 0; b < SPEED_BINS.length; b++) {
        if (record.speed >= SPEED_BINS[b] - 0.5 && record.speed < SPEED_BINS[b] + 0.5) {
          binIdx = b;
          break;
        }
      }
      if (binIdx === -1 && record.speed >= 25.5) {
        binIdx = SPEED_BINS.length - 1;
      }
      if (binIdx >= 0) {
        frequency[s][binIdx]++;
        binFreq[binIdx]++;
      }
    }
  }

  // Convert counts to frequencies (proportions)
  const total = records.length;
  const freqProp = frequency.map(sector => sector.map(count => count / total));
  const sectorFreqProp = sectorFreq.map(count => count / total);
  const binFreqProp = binFreq.map(count => count / total);

  return {
    sectorData: sectorMap,
    frequencyTable: {
      speedBinCenter: SPEED_BINS,
      frequency: freqProp,
      sectorFreq: sectorFreqProp,
      binFreq: binFreqProp,
    },
  };
}

/**
 * Stirling's approximation for ln(Gamma(x))
 * Lanczos approximation - accurate for x > 0
 */
export function lnGamma(z: number): number {
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
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Gamma function
 */
export function gamma(z: number): number {
  return Math.exp(lnGamma(z));
}

/**
 * Weibull PDF: f(v) = (k/A) * (v/A)^(k-1) * exp(-(v/A)^k)
 */
export function weibullPDF(v: number, A: number, k: number): number {
  if (v <= 0 || A <= 0 || k <= 0) return 0;
  return (k / A) * Math.pow(v / A, k - 1) * Math.exp(-Math.pow(v / A, k));
}

/**
 * Weibull CDF: F(v) = 1 - exp(-(v/A)^k)
 */
export function weibullCDF(v: number, A: number, k: number): number {
  return 1 - Math.exp(-Math.pow(v / A, k));
}

/**
 * Weibull mean: E(v) = A * Gamma(1 + 1/k)
 */
export function weibullMean(A: number, k: number): number {
  return A * Math.exp(lnGamma(1 + 1 / k));
}

/**
 * Weibull energy pattern factor (cube mean / mean^3): k_e = Gamma(1+3/k) / Gamma(1+1/k)^3
 */
export function weibullEnergyFactor(k: number): number {
  const g1 = Math.exp(lnGamma(1 + 1 / k));
  const g3 = Math.exp(lnGamma(1 + 3 / k));
  return g3 / (g1 * g1 * g1);
}

/**
 * Fit Weibull distribution using Maximum Likelihood Estimation (MLE)
 * Uses robust iterative method (Cohen, 1965 / Justus et al., 1978)
 */
export function fitWeibull(speeds: number[]): { A: number; k: number } {
  if (speeds.length === 0) return { A: 0, k: 2 };

  const positiveSpeeds = speeds.filter(s => s > 0.3);
  const n = positiveSpeeds.length;

  if (n < 3) {
    const mean = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
    return { A: Math.round(mean * 1.1 * 100) / 100, k: 2 };
  }

  const mean = positiveSpeeds.reduce((a, b) => a + b, 0) / n;
  const stdDev = Math.sqrt(
    positiveSpeeds.reduce((sum, s) => sum + (s - mean) ** 2, 0) / n
  );
  const cv = stdDev / mean;

  // Method of Moments initial estimate for k (Justus approximation)
  let k: number;
  if (cv > 0.01) {
    // Justus et al. (1978) empirical approximation
    const p = Math.pow(stdDev / mean, -1.086);
    k = 0.9 * p + 0.05;
    k = Math.max(1.2, Math.min(k, 10));
  } else {
    k = 8; // Very low variability
  }

  // Precompute log values
  const lnSpeeds = positiveSpeeds.map(s => Math.log(s));
  const lnSum = lnSpeeds.reduce((a, b) => a + b, 0);
  const lnMean = lnSum / n;

  // MLE iteration using the approach of Cohen (1965)
  // The MLE equation for k is:
  //   ln(mean(x^k)) - k * mean(ln(x)) - psi(k+1) - ln(n) + ln(sum(ln(x))) = 0
  // Simplified Newton-Raphson:
  //   f(k) = (1/k) + lnMean - (1/n) * sum(x^k * ln(x)) / ((1/n) * sum(x^k))
  //   f'(k) = -1/k^2 - sum(x^k * (ln(x))^2) / sum(x^k) + (sum(x^k * ln(x)) / sum(x^k))^2

  for (let iter = 0; iter < 100; iter++) {
    // Compute x^k and x^k * ln(x) for current k
    let sumXk = 0;
    let sumXkLnX = 0;
    let sumXkLnX2 = 0;

    for (let i = 0; i < n; i++) {
      const xk = Math.pow(positiveSpeeds[i], k);
      const lnx = lnSpeeds[i];
      sumXk += xk;
      sumXkLnX += xk * lnx;
      sumXkLnX2 += xk * lnx * lnx;
    }

    if (sumXk <= 0 || !isFinite(sumXk)) break;

    const meanXkLnX = sumXkLnX / sumXk;

    // f(k) = 1/k + lnMean - meanXkLnX
    const f = 1.0 / k + lnMean - meanXkLnX;

    // f'(k) = -1/k^2 - meanXkLnX2 + meanXkLnX^2
    const meanXkLnX2 = sumXkLnX2 / sumXk;
    const fp = -1.0 / (k * k) - meanXkLnX2 + meanXkLnX * meanXkLnX;

    if (Math.abs(fp) < 1e-15) break;

    const dk = f / fp;

    // Damped Newton step
    let newK = k - 0.5 * dk;

    // Bounds on k
    if (newK < 0.8) newK = 0.8;
    if (newK > 15) newK = 15;

    // Check convergence
    if (Math.abs(newK - k) < 1e-6) {
      k = newK;
      break;
    }

    k = newK;
  }

  // Compute A from MLE: A = (mean(x^k))^(1/k)
  let sumXk = 0;
  for (let i = 0; i < n; i++) {
    sumXk += Math.pow(positiveSpeeds[i], k);
  }
  const A = Math.pow(sumXk / n, 1 / k);

  // Sanity check: Weibull mean should be close to actual mean
  const fittedMean = A * Math.exp(lnGamma(1 + 1 / k));
  if (fittedMean > 0 && Math.abs(fittedMean / mean - 1) > 0.3) {
    // Fitting diverged, use method of moments fallback
    // k from cv, A = mean / Gamma(1 + 1/k)
    const kMoM = cv > 0.1 ? 1 / Math.pow(cv, 1.086) : 5;
    const kFinal = Math.max(1.5, Math.min(kMoM, 8));
    const aFinal = mean / Math.exp(lnGamma(1 + 1 / kFinal));
    return { A: Math.round(aFinal * 100) / 100, k: Math.round(kFinal * 1000) / 1000 };
  }

  return { A: Math.round(A * 100) / 100, k: Math.round(k * 1000) / 1000 };
}

/**
 * Analyze wind climate from records
 */
export function analyzeWindClimate(records: WindRecord[]): WindClimate {
  const { sectorData, frequencyTable } = calculateFrequencyDistribution(records);
  const totalRecords = records.length;

  const sectors: SectorData[] = [];

  for (let s = 0; s < NUM_SECTORS; s++) {
    const sectorRecords = sectorData.get(s) || [];
    const speeds = sectorRecords.map(r => r.speed);

    const speedSum = speeds.reduce((a, b) => a + b, 0);
    const speedSumSq = speeds.reduce((a, b) => a + b * b, 0);
    const count = speeds.length;
    const frequency = count / totalRecords;
    const meanSpeed = count > 0 ? speedSum / count : 0;

    const { A, k } = fitWeibull(speeds);

    // Power density: P = 0.5 * rho * E[v^3]
    // For Weibull: E[v^3] = A^3 * Gamma(1 + 3/k)
    const cubeMean = A > 0 ? A * A * A * Math.exp(lnGamma(1 + 3 / k)) : 0;
    const powerDensity = 0.5 * AIR_DENSITY * cubeMean; // W/m^2

    sectors.push({
      sector: s,
      sectorDir: getSectorDirection(s),
      speedSum: Math.round(speedSum * 100) / 100,
      speedSumSq: Math.round(speedSumSq * 100) / 100,
      count,
      frequency: Math.round(frequency * 10000) / 10000,
      meanSpeed: Math.round(meanSpeed * 100) / 100,
      weibullA: A,
      weibullK: k,
      powerDensity: Math.round(powerDensity * 100) / 100,
    });
  }

  // Overall statistics
  const allSpeeds = records.map(r => r.speed);
  const overallMeanSpeed = allSpeeds.reduce((a, b) => a + b, 0) / allSpeeds.length;
  const { A: overallA, k: overallK } = fitWeibull(allSpeeds);
  const overallCubeMean = overallA * overallA * overallA * Math.exp(lnGamma(1 + 3 / overallK));
  const overallPowerDensity = 0.5 * AIR_DENSITY * overallCubeMean;

  return {
    overallMeanSpeed: Math.round(overallMeanSpeed * 100) / 100,
    overallWeibullA: overallA,
    overallWeibullK: overallK,
    overallPowerDensity: Math.round(overallPowerDensity * 100) / 100,
    sectors,
    totalRecords,
    dataPeriod: {
      start: records[0]?.timestamp || '',
      end: records[records.length - 1]?.timestamp || '',
    },
  };
}

export { NUM_SECTORS, SECTOR_WIDTH, SPEED_BINS, AIR_DENSITY };
