// ============================================================
// Wind Assessment Library - Main Index
// ============================================================

export type {
  GeoCoordinate,
  WTG,
  MetMast,
  TerrainPoint,
  RoughnessSector,
  SectorAnalysis,
  TerrainAssessmentResult,
  TerrainProfile,
  PCVPairing,
  PCVOptimizationResult,
  MastConfiguration,
  FreestreamResult,
  SectorWakeAnalysis,
  MastProposal,
  MeasurementSectorsResult,
  WindFarmLayout,
  AnalysisConfig,
  ValidationError,
  InputDataBundle,
  TerrainAssessmentReport,
} from './types';

export { DEFAULT_CONFIG, validateInputs, performTerrainAssessment, performAllAssessments } from './terrain';
export { scorePCVPairing, optimizePCV, proposeMastLocations, calculateFinalSectors, runFullAnalysis } from './pcv';
export { analyzeFreestream, analyzeFreestreamAllMasts, generateWakeRoseData } from './freestream';
export { generateSampleData, parseCSV } from './sample-data';
export {
  haversineDistance,
  bearing,
  destinationPoint,
  geoToLocal,
  syntheticElevation,
  generateTerrainProfile,
  roughnessClass,
  normalizeAngle,
  angularDeviation,
} from './geo';
