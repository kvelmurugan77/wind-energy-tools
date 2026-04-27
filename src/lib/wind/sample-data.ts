// ============================================================
// Sample Data Generator for Demo & Testing
// Realistic wind farm layout with varied terrain
// ============================================================

import type { MetMast, WTG, WindFarmLayout, RoughnessSector, AnalysisConfig, InputDataBundle } from './types';
import { syntheticElevation } from './geo';

/**
 * Generate a complete sample dataset for demonstration
 * Simulates a realistic onshore wind farm with terrain variations
 */
export function generateSampleData(): InputDataBundle {
  // Project location approximately in southern India (typical wind farm region)
  const baseLat = 13.08;
  const baseLon = 77.58;
  const baseElev = 850;

  // Wind turbines in a staggered grid layout
  const wtgs: WTG[] = [
    { id: 'WTG-01', name: 'WTG-01', location: { latitude: baseLat + 0.005, longitude: baseLon + 0.002, elevation: baseElev + 12 }, rotorDiameter: 126, hubHeight: 100, ratedPower: 3000, isTarget: true, status: 'operational' },
    { id: 'WTG-02', name: 'WTG-02', location: { latitude: baseLat + 0.010, longitude: baseLon - 0.001, elevation: baseElev + 18 }, rotorDiameter: 126, hubHeight: 100, ratedPower: 3000, isTarget: true, status: 'operational' },
    { id: 'WTG-03', name: 'WTG-03', location: { latitude: baseLat + 0.015, longitude: baseLon + 0.003, elevation: baseElev + 25 }, rotorDiameter: 126, hubHeight: 100, ratedPower: 3000, isTarget: true, status: 'operational' },
    { id: 'WTG-04', name: 'WTG-04', location: { latitude: baseLat + 0.020, longitude: baseLon + 0.001, elevation: baseElev + 8 }, rotorDiameter: 126, hubHeight: 100, ratedPower: 3000, isTarget: false, status: 'operational' },
    { id: 'WTG-05', name: 'WTG-05', location: { latitude: baseLat - 0.002, longitude: baseLon + 0.006, elevation: baseElev + 15 }, rotorDiameter: 126, hubHeight: 100, ratedPower: 3000, isTarget: false, status: 'operational' },
    { id: 'WTG-06', name: 'WTG-06', location: { latitude: baseLat + 0.025, longitude: baseLon - 0.002, elevation: baseElev + 30 }, rotorDiameter: 126, hubHeight: 100, ratedPower: 3000, isTarget: false, status: 'operational' },
    { id: 'WTG-07', name: 'WTG-07', location: { latitude: baseLat + 0.008, longitude: baseLon + 0.008, elevation: baseElev + 5 }, rotorDiameter: 126, hubHeight: 100, ratedPower: 3000, isTarget: false, status: 'operational' },
    { id: 'WTG-08', name: 'WTG-08', location: { latitude: baseLat + 0.003, longitude: baseLon - 0.003, elevation: baseElev + 22 }, rotorDiameter: 126, hubHeight: 100, ratedPower: 3000, isTarget: true, status: 'operational' },
  ];

  // Meteorological masts
  const masts: MetMast[] = [
    {
      id: 'MM-01',
      name: 'Met Mast 01',
      location: { latitude: baseLat + 0.002, longitude: baseLon + 0.005, elevation: baseElev + 10 },
      mastHeight: 120,
      type: 'lattice',
      measurementHeights: [40, 60, 80, 100, 120],
    },
    {
      id: 'MM-02',
      name: 'Met Mast 02',
      location: { latitude: baseLat + 0.012, longitude: baseLon + 0.006, elevation: baseElev + 20 },
      mastHeight: 100,
      type: 'lattice',
      measurementHeights: [40, 60, 80, 100],
    },
  ];

  // Roughness sectors (typical onshore terrain)
  const roughnessSectors: RoughnessSector[] = [
    { directionFrom: 0, directionTo: 60, roughnessZ0: 0.03, roughnessClass: 1, description: 'Open agricultural land, low crops' },
    { directionFrom: 60, directionTo: 120, roughnessZ0: 0.05, roughnessClass: 1.5, description: 'Scattered bushes and small trees' },
    { directionFrom: 120, directionTo: 180, roughnessZ0: 0.1, roughnessClass: 2, description: 'Agricultural land with hedgerows' },
    { directionFrom: 180, directionTo: 240, roughnessZ0: 0.03, roughnessClass: 1, description: 'Open grassland' },
    { directionFrom: 240, directionTo: 300, roughnessZ0: 0.08, roughnessClass: 1.5, description: 'Sparse vegetation, some obstacles' },
    { directionFrom: 300, directionTo: 360, roughnessZ0: 0.03, roughnessClass: 1, description: 'Open flat terrain' },
  ];

  // External wind farm (nearby operational wind farm)
  const externalWindFarm: WindFarmLayout = {
    id: 'EXT-WF-01',
    name: 'Neighboring Wind Farm Alpha',
    description: 'Operational wind farm ~3km to the northwest',
    isExternal: true,
    turbines: [
      { id: 'EXT-01', name: 'EXT-Alpha-01', location: { latitude: baseLat + 0.035, longitude: baseLon - 0.015, elevation: baseElev + 35 }, rotorDiameter: 100, hubHeight: 90, ratedPower: 2000, status: 'operational' },
      { id: 'EXT-02', name: 'EXT-Alpha-02', location: { latitude: baseLat + 0.040, longitude: baseLon - 0.010, elevation: baseElev + 40 }, rotorDiameter: 100, hubHeight: 90, ratedPower: 2000, status: 'operational' },
      { id: 'EXT-03', name: 'EXT-Alpha-03', location: { latitude: baseLat + 0.045, longitude: baseLon - 0.015, elevation: baseElev + 42 }, rotorDiameter: 100, hubHeight: 90, ratedPower: 2000, status: 'operational' },
      { id: 'EXT-04', name: 'EXT-Alpha-04', location: { latitude: baseLat + 0.040, longitude: baseLon - 0.020, elevation: baseElev + 38 }, rotorDiameter: 100, hubHeight: 90, ratedPower: 2000, status: 'operational' },
    ],
  };

  // Configuration
  const config: AnalysisConfig = {
    iecVersion: 'IEC-61400-12-1-2017',
    sectorWidth: 10,
    assessmentRadius: 5000,
    minDistanceD: 2,
    maxSlopeSimple: 10,
    maxSlopeComplex: 17,
    wakeAngularThreshold: 30,
    wakeDistanceThresholdD: 20,
    includeExternalLayouts: true,
    project: {
      name: 'Sample Wind Farm - PCV Assessment',
      location: 'Karnataka, India',
      client: 'Demo Client',
      reportNumber: 'RPT-PCV-2026-001',
      analyst: 'Wind Resource Analyst',
    },
  };

  return {
    masts,
    wtgs,
    roughnessSectors,
    externalWindFarms: [externalWindFarm],
    config,
  };
}

/**
 * Parse CSV content into WTG or Mast objects
 */
export function parseCSV(csvContent: string, type: 'wtg' | 'mast'): { data: WTG[] | MetMast[]; errors: string[] } {
  const errors: string[] = [];
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) {
    return { data: [], errors: ['CSV must have at least a header row and one data row.'] };
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());

  if (type === 'wtg') {
    const requiredHeaders = ['name', 'latitude', 'longitude', 'rotordiameter', 'hubheight'];
    for (const rh of requiredHeaders) {
      if (!headers.includes(rh)) {
        errors.push(`Missing required column: ${rh}. Expected columns: ${requiredHeaders.join(', ')}`);
      }
    }
    if (errors.length > 0) return { data: [], errors };

    const wtgs: WTG[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim());
      if (values.length < headers.length) continue;

      const getValue = (header: string) => {
        const idx = headers.indexOf(header);
        return idx >= 0 ? values[idx] : '';
      };

      const lat = parseFloat(getValue('latitude'));
      const lon = parseFloat(getValue('longitude'));
      const rd = parseFloat(getValue('rotordiameter'));
      const hh = parseFloat(getValue('hubheight'));

      if (isNaN(lat) || isNaN(lon) || isNaN(rd) || isNaN(hh)) {
        errors.push(`Row ${i + 1}: Invalid numeric values.`);
        continue;
      }

      wtgs.push({
        id: `WTG-${String(i).padStart(2, '0')}`,
        name: getValue('name') || `WTG-${String(i).padStart(2, '0')}`,
        location: { latitude: lat, longitude: lon },
        rotorDiameter: rd,
        hubHeight: hh,
        ratedPower: parseFloat(getValue('ratedpower')) || undefined,
        isTarget: getValue('istarget')?.toLowerCase() !== 'false',
        status: 'operational',
      });
    }

    return { data: wtgs, errors };
  } else {
    // Mast parsing
    const requiredHeaders = ['name', 'latitude', 'longitude', 'mastheight'];
    for (const rh of requiredHeaders) {
      if (!headers.includes(rh)) {
        errors.push(`Missing required column: ${rh}. Expected columns: ${requiredHeaders.join(', ')}`);
      }
    }
    if (errors.length > 0) return { data: [], errors };

    const masts: MetMast[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim());
      if (values.length < headers.length) continue;

      const getValue = (header: string) => {
        const idx = headers.indexOf(header);
        return idx >= 0 ? values[idx] : '';
      };

      const lat = parseFloat(getValue('latitude'));
      const lon = parseFloat(getValue('longitude'));
      const mh = parseFloat(getValue('mastheight'));

      if (isNaN(lat) || isNaN(lon) || isNaN(mh)) {
        errors.push(`Row ${i + 1}: Invalid numeric values.`);
        continue;
      }

      const heightsStr = getValue('measurementheights');
      const measurementHeights = heightsStr
        ? heightsStr.split(';').map((h) => parseFloat(h)).filter((h) => !isNaN(h))
        : undefined;

      masts.push({
        id: `MM-${String(i).padStart(2, '0')}`,
        name: getValue('name') || `MM-${String(i).padStart(2, '0')}`,
        location: { latitude: lat, longitude: lon },
        mastHeight: mh,
        type: (getValue('type') as any) || 'lattice',
        measurementHeights,
      });
    }

    return { data: masts, errors };
  }
}
