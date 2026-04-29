/**
 * Mast Data CSV Parser
 *
 * Parses wind measurement data from CSV files in two formats:
 * 1. Time series format (Timestamp, Speed, Direction)
 * 2. Pre-binned 12-sector summary (WASP-compatible format)
 *
 * Also supports manual entry of 12-sector wind data.
 */

import { weibullPDF, defaultSectorDirections, directionToSector, NUM_SECTORS } from './wasp-atlas';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SectorData {
  direction: number;      // Center direction (degrees)
  meanSpeed: number;      // Mean wind speed (m/s)
  weibullA: number;       // Weibull scale parameter (m/s)
  weibullK: number;       // Weibull shape parameter
  frequency: number;      // Sector frequency (0-1)
  powerDensity: number;   // W/m²
  count: number;          // Number of data points
}

export interface MastData {
  source: 'timeseries' | 'sector-summary' | 'manual';
  measurementHeight: number;  // m
  latitude: number;           // degrees
  longitude: number;          // degrees
  roughnessLength: number;    // m (site z0)
  totalRecords: number;
  sectors: SectorData[];
  overall: {
    meanSpeed: number;
    weibullA: number;
    weibullK: number;
    powerDensity: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Weibull MLE Fitting
// ═══════════════════════════════════════════════════════════════════════════

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

/**
 * Fit Weibull distribution using MLE with Newton-Raphson iteration.
 */
function fitWeibull(speeds: number[]): { A: number; k: number } {
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

  // Method of Moments initial estimate
  let k: number;
  if (cv > 0.01) {
    k = Math.pow(cv, -1.086);
    k = Math.max(1.2, Math.min(k, 10));
  } else {
    k = 8;
  }

  const lnSpeeds = positiveSpeeds.map(s => Math.log(s));
  const lnMean = lnSpeeds.reduce((a, b) => a + b, 0) / n;

  for (let iter = 0; iter < 100; iter++) {
    let sumXk = 0, sumXkLnX = 0, sumXkLnX2 = 0;
    for (let i = 0; i < n; i++) {
      const xk = Math.pow(positiveSpeeds[i], k);
      const lnx = lnSpeeds[i];
      sumXk += xk;
      sumXkLnX += xk * lnx;
      sumXkLnX2 += xk * lnx * lnx;
    }
    if (sumXk <= 0) break;

    const meanXkLnX = sumXkLnX / sumXk;
    const f = 1.0 / k + lnMean - meanXkLnX;
    const meanXkLnX2 = sumXkLnX2 / sumXk;
    const fp = -1.0 / (k * k) - meanXkLnX2 + meanXkLnX * meanXkLnX;

    if (Math.abs(fp) < 1e-15) break;
    const dk = f / fp;
    let newK = k - 0.5 * dk;
    if (newK < 0.8) newK = 0.8;
    if (newK > 15) newK = 15;
    if (Math.abs(newK - k) < 1e-6) { k = newK; break; }
    k = newK;
  }

  let sumXk = 0;
  for (let i = 0; i < n; i++) sumXk += Math.pow(positiveSpeeds[i], k);
  let A = Math.pow(sumXk / n, 1 / k);
  if (!isFinite(A) || A <= 0) A = mean;

  // Sanity check
  const fittedMean = A * gammaFunc(1 + 1 / k);
  if (fittedMean > 0 && Math.abs(fittedMean / mean - 1) > 0.3) {
    const kMoM = cv > 0.1 ? 1 / Math.pow(cv, 1.086) : 5;
    const kFinal = Math.max(1.5, Math.min(kMoM, 8));
    A = mean / gammaFunc(1 + 1 / kFinal);
    return { A: Math.round(A * 100) / 100, k: Math.round(kFinal * 1000) / 1000 };
  }

  return { A: Math.round(A * 100) / 100, k: Math.round(k * 1000) / 1000 };
}

// ═══════════════════════════════════════════════════════════════════════════
// Format Detection
// ═══════════════════════════════════════════════════════════════════════════

export type CSVFormat = 'timeseries' | 'sector-summary' | 'unknown';

/**
 * Detect CSV format from header row
 */
export function detectCSVFormat(headers: string[]): CSVFormat {
  const h = headers.map(h => h.toLowerCase().trim());

  if (h.some(c => c.includes('timestamp') || c.includes('date') || c.includes('time')) &&
      h.some(c => c.includes('speed') || c.includes('ws') || c.includes('wind'))) {
    return 'timeseries';
  }

  if (h.some(c => c.includes('sector')) &&
      h.some(c => c.includes('weibull') || c.includes('frequency') || c.includes('freq'))) {
    return 'sector-summary';
  }

  // If we have exactly 12 data rows and columns like direction, speed, etc.
  if (h.some(c => c.includes('direction') || c.includes('dir')) &&
      h.some(c => c.includes('speed') || c.includes('mean'))) {
    return 'sector-summary';
  }

  return 'unknown';
}

// ═══════════════════════════════════════════════════════════════════════════
// Time Series Parser
// ═══════════════════════════════════════════════════════════════════════════

interface TimeSeriesRow {
  speed: number;
  direction: number;
}

/**
 * Parse CSV time series data.
 * Expected columns: Timestamp, Speed(m/s), Direction(deg)
 * Also supports: Date, WS, WD
 */
function parseTimeSeries(
  rows: string[][],
  headers: string[]
): TimeSeriesRow[] {
  // Find speed and direction column indices
  const h = headers.map(h => h.toLowerCase().trim());
  let speedIdx = h.findIndex(c =>
    c.includes('speed') || c.includes('ws') || c === 'wind' || c.includes('spd')
  );
  let dirIdx = h.findIndex(c =>
    c.includes('direction') || c.includes('dir') || c.includes('wd') || c.includes('bearing')
  );

  if (speedIdx < 0) speedIdx = 1; // Assume second column
  if (dirIdx < 0) dirIdx = 2;     // Assume third column

  const results: TimeSeriesRow[] = [];

  for (const row of rows) {
    if (row.length <= Math.max(speedIdx, dirIdx)) continue;

    const speed = parseFloat(row[speedIdx]?.replace(/[^0-9.\-]/g, ''));
    const dir = parseFloat(row[dirIdx]?.replace(/[^0-9.\-]/g, ''));

    if (isFinite(speed) && isFinite(dir) && speed >= 0 && dir >= 0 && dir < 360) {
      results.push({ speed, direction: dir % 360 });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sector Summary Parser
// ═══════════════════════════════════════════════════════════════════════════

interface SectorSummaryRow {
  direction: number;
  meanSpeed: number;
  weibullA: number;
  weibullK: number;
  frequency: number;
}

/**
 * Parse pre-binned 12-sector summary CSV.
 * Expected columns: Sector, Direction, MeanSpeed, WeibullA, WeibullK, Frequency
 */
function parseSectorSummary(
  rows: string[][],
  headers: string[]
): SectorSummaryRow[] {
  const h = headers.map(h => h.toLowerCase().trim());

  let dirIdx = h.findIndex(c => c.includes('direction') || c.includes('dir'));
  let speedIdx = h.findIndex(c => c.includes('speed') || c.includes('mean') || c.includes('ws'));
  let aIdx = h.findIndex(c => c.includes('weibulla') || c.includes('a_param') || c === 'a');
  let kIdx = h.findIndex(c => c.includes('weibullk') || c.includes('k_param') || c === 'k');
  let freqIdx = h.findIndex(c => c.includes('freq') || c.includes('probability') || c.includes('pct'));

  // Fallbacks
  if (dirIdx < 0) dirIdx = 0;
  if (speedIdx < 0) speedIdx = 1;
  if (aIdx < 0) aIdx = 2;
  if (kIdx < 0) kIdx = 3;
  if (freqIdx < 0) freqIdx = 4;

  const results: SectorSummaryRow[] = [];

  for (const row of rows) {
    if (row.length <= Math.max(dirIdx, speedIdx, aIdx, kIdx, freqIdx)) continue;

    const direction = parseFloat(row[dirIdx]?.replace(/[^0-9.\-]/g, ''));
    const meanSpeed = parseFloat(row[speedIdx]?.replace(/[^0-9.\-]/g, ''));
    const A = parseFloat(row[aIdx]?.replace(/[^0-9.\-]/g, ''));
    const K = parseFloat(row[kIdx]?.replace(/[^0-9.\-]/g, ''));
    let freq = parseFloat(row[freqIdx]?.replace(/[^0-9.\-]/g, ''));

    // If frequency is given as percentage, convert to fraction
    if (freq > 1) freq /= 100;

    if (isFinite(direction) && isFinite(meanSpeed) && isFinite(A) && isFinite(K) && isFinite(freq)) {
      results.push({ direction, meanSpeed, weibullA: A, weibullK: K, frequency: freq });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Parser
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse CSV string into structured MastData
 *
 * @param csvText        - Raw CSV text
 * @param measurementHeight - Anemometer height in meters
 * @param latitude       - Site latitude (degrees)
 * @param longitude      - Site longitude (degrees)
 * @param roughnessLength - Site roughness length (m)
 * @returns Parsed MastData or null if parsing fails
 */
export function parseMastCSV(
  csvText: string,
  measurementHeight: number = 80,
  latitude: number = 45,
  longitude: number = 0,
  roughnessLength: number = 0.03
): MastData | null {
  // Split into lines and parse
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return null;

  // Parse CSV (handle commas, semicolons, tabs)
  const delimiter = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') ? ';' : ',');
  const allRows = lines.map(line => line.split(delimiter).map(cell => cell.trim().replace(/^["']|["']$/g, '')));
  const headers = allRows[0];
  const dataRows = allRows.slice(1);

  const format = detectCSVFormat(headers);

  let sectors: SectorData[];
  let source: MastData['source'];
  let totalRecords: number;

  if (format === 'timeseries') {
    source = 'timeseries';
    const timeSeries = parseTimeSeries(dataRows, headers);
    totalRecords = timeSeries.length;

    if (totalRecords === 0) return null;

    // Bin into 12 sectors
    const sectorSpeeds: number[][] = Array.from({ length: NUM_SECTORS }, () => []);
    for (const { speed, direction } of timeSeries) {
      const idx = directionToSector(direction);
      sectorSpeeds[idx].push(speed);
    }

    sectors = sectorSpeeds.map((speeds, idx) => {
      const count = speeds.length;
      const freq = count / totalRecords;
      const mean = count > 0 ? speeds.reduce((a, b) => a + b, 0) / count : 0;
      const { A, k } = fitWeibull(speeds);
      const powerDensity = 0.5 * 1.225 * Math.pow(A, 3) * gammaFunc(1 + 3 / k);

      return {
        direction: idx * 30,
        meanSpeed: Math.round(mean * 100) / 100,
        weibullA: A,
        weibullK: k,
        frequency: Math.round(freq * 10000) / 10000,
        powerDensity: Math.round(powerDensity * 100) / 100,
        count,
      };
    });
  } else if (format === 'sector-summary') {
    source = 'sector-summary';
    const summaryRows = parseSectorSummary(dataRows, headers);
    totalRecords = summaryRows.reduce((sum, r) => sum + Math.round(r.frequency * 8760), 0);

    if (summaryRows.length === 0) return null;

    sectors = summaryRows.map(row => {
      const powerDensity = 0.5 * 1.225 * Math.pow(row.weibullA, 3) * gammaFunc(1 + 3 / row.weibullK);
      return {
        direction: row.direction,
        meanSpeed: row.meanSpeed,
        weibullA: row.weibullA,
        weibullK: row.weibullK,
        frequency: row.frequency,
        powerDensity: Math.round(powerDensity * 100) / 100,
        count: Math.round(row.frequency * 8760),
      };
    });

    // Ensure we have exactly 12 sectors, filling missing ones
    while (sectors.length < NUM_SECTORS) {
      sectors.push({
        direction: sectors.length * 30,
        meanSpeed: 0,
        weibullA: 0,
        weibullK: 2,
        frequency: 0,
        powerDensity: 0,
        count: 0,
      });
    }
  } else {
    // Try as time series as fallback
    source = 'timeseries';
    const timeSeries = parseTimeSeries(dataRows, headers);
    totalRecords = timeSeries.length;
    if (totalRecords === 0) return null;

    const sectorSpeeds: number[][] = Array.from({ length: NUM_SECTORS }, () => []);
    for (const { speed, direction } of timeSeries) {
      const idx = directionToSector(direction);
      sectorSpeeds[idx].push(speed);
    }

    sectors = sectorSpeeds.map((speeds, idx) => {
      const count = speeds.length;
      const freq = count / totalRecords;
      const mean = count > 0 ? speeds.reduce((a, b) => a + b, 0) / count : 0;
      const { A, k } = fitWeibull(speeds);
      const powerDensity = 0.5 * 1.225 * Math.pow(A, 3) * gammaFunc(1 + 3 / k);
      return {
        direction: idx * 30,
        meanSpeed: Math.round(mean * 100) / 100,
        weibullA: A,
        weibullK: k,
        frequency: Math.round(freq * 10000) / 10000,
        powerDensity: Math.round(powerDensity * 100) / 100,
        count,
      };
    });
  }

  // Normalize frequencies
  const freqSum = sectors.reduce((s, sec) => s + sec.frequency, 0);
  if (freqSum > 0) {
    for (const sec of sectors) {
      sec.frequency = Math.round((sec.frequency / freqSum) * 10000) / 10000;
    }
  }

  // Compute overall statistics
  const allSpeeds: number[] = [];
  const totalN = sectors.reduce((s, sec) => s + sec.count, 0);
  for (const sec of sectors) {
    for (let i = 0; i < sec.count; i++) {
      allSpeeds.push(sec.meanSpeed);
    }
  }

  const overallMean = totalN > 0
    ? sectors.reduce((s, sec) => s + sec.meanSpeed * sec.count, 0) / totalN
    : 0;
  const overallFreqWeighted = sectors.reduce((s, sec) => s + sec.weibullA * sec.frequency, 0);
  const overallA = Math.round(overallFreqWeighted * 100) / 100;
  const overallK = sectors.reduce((s, sec) => s + sec.weibullK * sec.frequency, 0);
  const overallPD = 0.5 * 1.225 * Math.pow(overallA, 3) * gammaFunc(1 + 3 / overallK);

  return {
    source,
    measurementHeight,
    latitude,
    longitude,
    roughnessLength,
    totalRecords,
    sectors,
    overall: {
      meanSpeed: Math.round(overallMean * 100) / 100,
      weibullA: overallA,
      weibullK: Math.round(overallK * 1000) / 1000,
      powerDensity: Math.round(overallPD * 100) / 100,
    },
  };
}

/**
 * Create MastData from manual 12-sector entry
 */
export function createManualMastData(
  sectorData: { direction: number; meanSpeed: number; frequency: number }[],
  measurementHeight: number = 80,
  latitude: number = 45,
  longitude: number = 0,
  roughnessLength: number = 0.03
): MastData {
  const freqSum = sectorData.reduce((s, d) => s + d.frequency, 0);
  const normalizedFreq = freqSum > 0
    ? sectorData.map(d => d.frequency / freqSum)
    : sectorData.map(() => 1 / 12);

  const sectors: SectorData[] = sectorData.map((d, idx) => {
    // Estimate Weibull from mean speed (default k=2 for manual entry)
    const k = 2.0;
    // A = mean / Gamma(1 + 1/k) ≈ mean / 0.8862 for k=2
    const A = d.meanSpeed / gammaFunc(1 + 1 / k);
    const powerDensity = 0.5 * 1.225 * Math.pow(A, 3) * gammaFunc(1 + 3 / k);

    return {
      direction: d.direction,
      meanSpeed: Math.round(d.meanSpeed * 100) / 100,
      weibullA: Math.round(A * 100) / 100,
      weibullK: k,
      frequency: Math.round(normalizedFreq[idx] * 10000) / 10000,
      powerDensity: Math.round(powerDensity * 100) / 100,
      count: Math.round(normalizedFreq[idx] * 8760),
    };
  });

  const totalN = sectors.reduce((s, sec) => s + sec.count, 0);
  const overallMean = sectors.reduce((s, sec) => s + sec.meanSpeed * sec.count, 0) / totalN;
  const overallA = sectors.reduce((s, sec) => s + sec.weibullA * sec.frequency, 0);
  const overallK = sectors.reduce((s, sec) => s + sec.weibullK * sec.frequency, 0);
  const overallPD = 0.5 * 1.225 * Math.pow(overallA, 3) * gammaFunc(1 + 3 / overallK);

  return {
    source: 'manual',
    measurementHeight,
    latitude,
    longitude,
    roughnessLength,
    totalRecords: totalN,
    sectors,
    overall: {
      meanSpeed: Math.round(overallMean * 100) / 100,
      weibullA: Math.round(overallA * 100) / 100,
      weibullK: Math.round(overallK * 1000) / 1000,
      powerDensity: Math.round(overallPD * 100) / 100,
    },
  };
}

/**
 * Generate sample mast data for testing
 */
export function generateSampleMastData(): MastData {
  const sectorData = [
    { direction: 0, meanSpeed: 9.2, frequency: 0.09 },
    { direction: 30, meanSpeed: 8.8, frequency: 0.07 },
    { direction: 60, meanSpeed: 8.4, frequency: 0.06 },
    { direction: 90, meanSpeed: 7.8, frequency: 0.05 },
    { direction: 120, meanSpeed: 7.2, frequency: 0.04 },
    { direction: 150, meanSpeed: 7.0, frequency: 0.04 },
    { direction: 180, meanSpeed: 7.1, frequency: 0.04 },
    { direction: 210, meanSpeed: 7.6, frequency: 0.04 },
    { direction: 240, meanSpeed: 8.2, frequency: 0.05 },
    { direction: 270, meanSpeed: 9.8, frequency: 0.10 },
    { direction: 300, meanSpeed: 9.5, frequency: 0.08 },
    { direction: 330, meanSpeed: 9.6, frequency: 0.10 },
  ];

  return createManualMastData(sectorData, 80, 45, 0, 0.03);
}
