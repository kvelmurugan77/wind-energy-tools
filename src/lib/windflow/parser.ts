// ============================================================
// Wind Flow Model - Data Parser
// Parses wind data CSV and layout CSV
// ============================================================

import { WindRecord, TurbineLayout } from './types';

/**
 * Parse wind data CSV
 * Expected format: timestamp, wind_speed, wind_direction
 * Supports multiple date formats
 */
export function parseWindData(csvText: string): WindRecord[] {
  const lines = csvText.trim().split('\n');
  const records: WindRecord[] = [];

  // Find the header row and data start
  let startLine = 0;
  let speedCol = -1;
  let dirCol = -1;
  let timeCol = -1;

  // Try to detect columns from header
  const headerLines = lines.slice(0, 3);
  for (let i = 0; i < headerLines.length; i++) {
    const cols = headerLines[i].split(',').map(c => c.trim().toLowerCase());
    
    for (let j = 0; j < cols.length; j++) {
      if (speedCol === -1 && (cols[j].includes('speed') || cols[j].includes('ws') || cols[j] === 'meanwindspeeduid')) {
        speedCol = j;
      }
      if (dirCol === -1 && (cols[j].includes('direction') || cols[j].includes('dir') || cols[j] === 'directionuid')) {
        dirCol = j;
      }
      if (timeCol === -1 && (cols[j].includes('time') || cols[j].includes('date') || cols[j] === 'timestamp')) {
        timeCol = j;
      }
    }

    // Check if we found both columns and this looks like a header
    if (speedCol >= 0 && dirCol >= 0) {
      // Check if next line has numeric data
      const nextLine = lines[i + 1];
      if (nextLine) {
        const nextCols = nextLine.split(',').map(c => c.trim());
        if (!isNaN(parseFloat(nextCols[speedCol])) && !isNaN(parseFloat(nextCols[dirCol]))) {
          startLine = i + 1;
          break;
        }
      }
    }
  }

  // Fallback: assume columns are timestamp(0), speed(1), direction(2)
  if (speedCol === -1 || dirCol === -1) {
    speedCol = 1;
    dirCol = 2;
    timeCol = 0;
    startLine = 1; // Skip header
  }

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',').map(c => c.trim());
    if (cols.length < 3) continue;

    const speed = parseFloat(cols[speedCol]);
    const dir = parseFloat(cols[dirCol]);
    const timestamp = timeCol >= 0 ? cols[timeCol] : `record-${i}`;

    if (isNaN(speed) || isNaN(dir)) continue;
    if (speed < 0 || dir < 0 || dir > 360) continue;

    records.push({
      timestamp,
      speed: Math.round(speed * 100) / 100,
      direction: Math.round(dir * 10) / 10,
    });
  }

  return records;
}

/**
 * Parse turbine layout CSV
 * Expected format: id, x, y, model, rotor_diameter, hub_height
 */
export function parseLayout(csvText: string): TurbineLayout[] {
  const lines = csvText.trim().split('\n');
  const turbines: TurbineLayout[] = [];

  // Find header
  let startLine = 0;
  const header = lines[0]?.toLowerCase() || '';
  if (header.includes('id') || header.includes('name') || header.includes('turbine')) {
    startLine = 1;
  }

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',').map(c => c.trim());
    if (cols.length < 3) continue;

    const id = cols[0];
    const x = parseFloat(cols[1]);
    const y = parseFloat(cols[2]);
    const model = cols[3] || 'Unknown';
    const rd = cols[4] ? parseFloat(cols[4]) : 0;
    const hh = cols[5] ? parseFloat(cols[5]) : 0;

    if (isNaN(x) || isNaN(y)) continue;

    turbines.push({
      id,
      x,
      y,
      model,
      rotorDiameter: rd,
      hubHeight: hh,
    });
  }

  return turbines;
}

/**
 * Validate wind data quality
 */
export function validateWindData(records: WindRecord[]): {
  valid: boolean;
  totalRecords: number;
  validRecords: number;
  missingPercent: number;
  meanSpeed: number;
  meanDirection: number;
  dateRange: { start: string; end: string };
} {
  const speeds = records.map(r => r.speed).filter(s => s >= 0);
  const meanSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

  // Circular mean for direction
  const sinSum = records.reduce((sum, r) => sum + Math.sin((r.direction * Math.PI) / 180), 0);
  const cosSum = records.reduce((sum, r) => sum + Math.cos((r.direction * Math.PI) / 180), 0);
  const meanDir = ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360;

  return {
    valid: records.length > 100,
    totalRecords: records.length,
    validRecords: records.length,
    missingPercent: 0,
    meanSpeed: Math.round(meanSpeed * 100) / 100,
    meanDirection: Math.round(meanDir * 10) / 10,
    dateRange: {
      start: records.length > 0 ? records[0].timestamp : '',
      end: records.length > 0 ? records[records.length - 1].timestamp : '',
    },
  };
}
