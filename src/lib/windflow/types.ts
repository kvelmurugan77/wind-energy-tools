// ============================================================
// Wind Flow Model - Type Definitions
// ============================================================

export interface WindRecord {
  timestamp: string;
  speed: number;      // m/s
  direction: number;  // degrees (meteorological, 0=N, 90=E)
}

export interface TurbineLayout {
  id: string;
  x: number;          // UTM Easting (m)
  y: number;          // UTM Northing (m)
  model: string;
  rotorDiameter: number;  // m
  hubHeight: number;      // m
}

export interface MastConfig {
  x: number;              // UTM Easting (m)
  y: number;              // UTM Northing (m)
  measurementHeight: number; // m (anemometer height)
  roughnessLength: number;  // m (z0)
}

export interface SectorData {
  sector: number;         // 0-11 (N, NNE, ..., WNW)
  sectorDir: number;      // center direction in degrees
  speedSum: number;
  speedSumSq: number;
  count: number;
  frequency: number;      // proportion (0-1)
  meanSpeed: number;
  weibullA: number;       // scale parameter (m/s)
  weibullK: number;       // shape parameter
  powerDensity: number;   // W/m^2
}

export interface WindClimate {
  overallMeanSpeed: number;
  overallWeibullA: number;
  overallWeibullK: number;
  overallPowerDensity: number;
  sectors: SectorData[];
  totalRecords: number;
  dataPeriod: { start: string; end: string };
}

export interface TurbineResult {
  id: string;
  x: number;
  y: number;
  model: string;
  hubHeight: number;
  rotorDiameter: number;
  // Flow model results
  grossMeanSpeed: number;
  grossWeibullA: number;
  grossWeibullK: number;
  grossPowerDensity: number;
  // AEP results
  grossAEP: number;        // GWh/yr
  netAEP: number;          // GWh/yr
  wakeLossPercent: number;
  capacityFactor: number;  // net CF
  // Per-direction results
  sectorSpeeds: number[];  // 12 sectors
  sectorFrequencies: number[];  // 12 sectors
}

export interface FarmResult {
  turbines: TurbineResult[];
  totalGrossAEP: number;
  totalNetAEP: number;
  totalWakeLoss: number;
  wakeLossPercent: number;
  farmCapacity: number;
  netCapacityFactor: number;
  windClimate: WindClimate;
}

export interface FrequencyTable {
  speedBinCenter: number[];
  frequency: number[][];   // [sector][bin]
  sectorFreq: number[];    // total frequency per sector
  binFreq: number[];       // total frequency per speed bin
}

export interface PowerCurvePoint {
  speed: number;   // m/s
  power: number;   // kW
}

export interface TurbineModel {
  name: string;
  ratedPower: number;       // kW
  rotorDiameter: number;    // m
  hubHeight: number;        // m
  cutInSpeed: number;       // m/s
  cutOutSpeed: number;      // m/s
  ratedSpeed: number;       // m/s
  powerCurve: PowerCurvePoint[];
}

export interface WindMapGrid {
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  resolution: number;       // grid spacing in meters
  grid: { x: number; y: number; speed: number; powerDensity: number }[];
}
