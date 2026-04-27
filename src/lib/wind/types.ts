// ============================================================
// Wind Resource Assessment - Core Type Definitions
// IEC 61400-12-1 Power Curve Verification Tool
// ============================================================

/** Geographic coordinate */
export interface GeoCoordinate {
  latitude: number;
  longitude: number;
  /** Elevation above sea level in meters */
  elevation?: number;
}

/** Wind Turbine Generator */
export interface WTG {
  id: string;
  name: string;
  location: GeoCoordinate;
  /** Rotor diameter in meters */
  rotorDiameter: number;
  /** Hub height in meters */
  hubHeight: number;
  /** Rated power in kW */
  ratedPower?: number;
  /** Whether this WTG is part of the target wind farm for PCV */
  isTarget?: boolean;
  /** Status: operational, under_construction, planned */
  status?: 'operational' | 'under_construction' | 'planned';
}

/** Meteorological Mast */
export interface MetMast {
  id: string;
  name: string;
  location: GeoCoordinate;
  /** Mast height in meters */
  mastHeight: number;
  /** Type of mast */
  type?: 'lattice' | 'tubular' | 'sodar' | 'lidar';
  /** Measurement heights in meters */
  measurementHeights?: number[];
}

/** Terrain data point - digital elevation model */
export interface TerrainPoint {
  easting: number;
  northing: number;
  elevation: number;
  /** Surface roughness length in meters (z0) */
  roughnessLength?: number;
}

/** Roughness sector definition per IEC 61400-12-1 */
export interface RoughnessSector {
  /** Direction range in degrees (e.g., 0-10) */
  directionFrom: number;
  directionTo: number;
  /** Average roughness length z0 in meters */
  roughnessZ0: number;
  /** Roughness class per IEC */
  roughnessClass: number;
  /** Description of terrain cover */
  description?: string;
}

/** Single measurement sector analysis result */
export interface SectorAnalysis {
  /** Sector center direction in degrees */
  direction: number;
  /** Sector start direction */
  directionFrom: number;
  /** Sector end direction */
  directionTo: number;
  /** Maximum terrain slope in percent */
  maxSlope: number;
  /** Maximum terrain slope in degrees */
  maxSlopeDeg: number;
  /** Average terrain slope in percent */
  avgSlope: number;
  /** Maximum elevation change in meters */
  maxElevationChange: number;
  /** Roughness assessment */
  roughness: {
    z0: number;
    roughnessClass: number;
    hasSignificantChange: boolean;
    description: string;
  };
  /** Whether sector passes IEC 61400-12-1 criteria */
  isValid: boolean;
  /** Detailed failure reasons if sector is invalid */
  failureReasons: string[];
  /** Distance to nearest obstacle */
  obstacleDistance?: number;
  /** Whether sector is freestream (no upstream turbines) */
  isFreestream: boolean;
  /** Wake-affected turbines in this sector */
  wakeAffectedTurbines: string[];
  /** Terrain classification */
  terrainClass: 'A' | 'B' | 'S';
  /** Slope criterion pass/fail */
  slopeCriteria: {
    simpleTerrainPass: boolean;   // slope ≤ ~17.6% (10°)
    complexTerrainPass: boolean;  // slope ≤ ~30.6% (17°)
  };
}

/** Complete terrain assessment result */
export interface TerrainAssessmentResult {
  /** Assessment metadata */
  metadata: {
    mastId: string;
    mastName: string;
    targetWtgId: string;
    targetWtgName: string;
    assessmentDate: string;
    iecVersion: string;
    sectorWidth: number;
    assessmentRadius: number;
    numSectors: number;
  };
  /** Distance between mast and WTG */
  distance: {
    meters: number;
    rotorDiameters: number;
    bearing: number;
  };
  /** Sector results for all 36 directions */
  sectors: SectorAnalysis[];
  /** Valid sectors list */
  validSectors: number[];
  /** Overall assessment */
  summary: {
    terrainClassification: 'simple' | 'complex';
    terrainClass: 'A' | 'B' | 'S';
    totalSectors: number;
    validSectorsCount: number;
    invalidSectorsCount: number;
    freestreamSectorsCount: number;
    validSectorPercentage: number;
    maxValidSlope: number;
    maxValidSlopeDeg: number;
    minDistance: number;
    minDistanceInD: number;
    isIECCompliant: boolean;
    complianceNotes: string[];
  };
  /** Detailed terrain profile for each sector */
  terrainProfiles?: TerrainProfile[];
}

/** Terrain profile along a sector direction */
export interface TerrainProfile {
  direction: number;
  distance: number[];
  elevation: number[];
  slope: number[];
  roughness: number[];
}

/** PCV WTG pairing analysis */
export interface PCVPairing {
  mastId: string;
  mastName: string;
  wtgId: string;
  wtgName: string;
  distance: number;
  distanceInD: number;
  bearing: number;
  /** Valid sectors count */
  validSectors: number;
  /** Total sectors analyzed */
  totalSectors: number;
  /** Freestream sectors */
  freestreamSectors: number;
  /** Scoring for optimal selection */
  score: number;
  /** Individual criterion scores */
  criterionScores: {
    distance: number;
    terrainQuality: number;
    sectorCoverage: number;
    freestreamQuality: number;
    slopeCompliance: number;
  };
  /** Recommended for PCV */
  isRecommended: boolean;
  /** Assessment result reference */
  assessmentId?: string;
}

/** PCV optimization result - for single mast testing multiple WTGs */
export interface PCVOptimizationResult {
  /** Best pairing overall */
  bestPairings: PCVPairing[];
  /** Mast-WTG combinations analyzed */
  totalCombinations: number;
  /** Configuration: 1 mast testing N WTGs */
  configurations: MastConfiguration[];
  /** Recommendations */
  recommendations: string[];
}

/** Single mast testing multiple WTGs configuration */
export interface MastConfiguration {
  mastId: string;
  mastName: string;
  targetWtgs: {
    wtgId: string;
    wtgName: string;
    score: number;
    validSectors: number;
  }[];
  combinedValidSectors: number;
  combinedFreestreamSectors: number;
  overallScore: number;
  isRecommended: boolean;
  notes: string[];
}

/** Freestream analysis result */
export interface FreestreamResult {
  mastId: string;
  mastName: string;
  /** Sectors that are freestream */
  freestreamSectors: number[];
  /** Sectors affected by wakes */
  wakeAffectedSectors: number[];
  /** Detailed wake analysis per sector */
  sectorWakeAnalysis: SectorWakeAnalysis[];
  /** External WTGs considered */
  externalWtgs: {
    id: string;
    name: string;
    direction: number;
    distance: number;
    distanceInD: number;
    affectingSectors: number[];
  }[];
  /** Overall freestream percentage */
  freestreamPercentage: number;
}

/** Wake analysis for a single sector */
export interface SectorWakeAnalysis {
  direction: number;
  isFreestream: boolean;
  wakeSourceTurbines: {
    wtgId: string;
    wtgName: string;
    distance: number;
    distanceInD: number;
    angularDeviation: number;
    wakeWidthAtMast: number;
    isExternal: boolean;
  }[];
  combinedWakeImpact: 'none' | 'low' | 'medium' | 'high';
}

/** Proposed mast location for PCV */
export interface MastProposal {
  id: string;
  proposedLocation: GeoCoordinate;
  targetWtgs: string[];
  /** Expected valid sector coverage */
  expectedValidSectors: number;
  /** Expected freestream coverage */
  expectedFreestreamSectors: number;
  /** Quality score */
  qualityScore: number;
  /** Justification */
  justification: string[];
  /** Potential issues */
  potentialIssues: string[];
}

/** Final measurement sector result */
export interface MeasurementSectorsResult {
  mastId: string;
  mastName: string;
  targetWtgs: { id: string; name: string }[];
  /** Final valid measurement sectors */
  validSectors: SectorAnalysis[];
  /** Final freestream sectors */
  freestreamSectors: number[];
  /** Final combined valid+freestream sectors */
  finalSectors: number[];
  /** Sector width */
  sectorWidth: number;
  /** Total measurement coverage */
  totalCoverage: number;
  /** IEc compliance summary */
  complianceSummary: {
    terrainClass: 'A' | 'B' | 'S';
    allCriteriaMet: boolean;
    notes: string[];
  };
}

/** Wind farm layout */
export interface WindFarmLayout {
  id: string;
  name: string;
  description?: string;
  isExternal: boolean;
  turbines: WTG[];
}

/** Input configuration for the entire analysis */
export interface AnalysisConfig {
  /** IEC standard version */
  iecVersion: 'IEC-61400-12-1-2005' | 'IEC-61400-12-1-2017';
  /** Sector width in degrees (10 or 20) */
  sectorWidth: 10 | 20;
  /** Assessment radius in meters */
  assessmentRadius: number;
  /** Minimum mast-to-WTG distance in rotor diameters */
  minDistanceD: number;
  /** Maximum slope for simple terrain (degrees) */
  maxSlopeSimple: number;
  /** Maximum slope for complex terrain (degrees) */
  maxSlopeComplex: number;
  /** Wake influence angular threshold (degrees) */
  wakeAngularThreshold: number;
  /** Wake influence distance threshold (rotor diameters) */
  wakeDistanceThresholdD: number;
  /** Whether to include external wind farms */
  includeExternalLayouts: boolean;
  /** Project details */
  project: {
    name: string;
    location: string;
    client?: string;
    reportNumber?: string;
    analyst?: string;
  };
}

/** Report data structure */
export interface TerrainAssessmentReport {
  projectInfo: {
    name: string;
    location: string;
    client?: string;
    reportNumber?: string;
    analyst?: string;
    date: string;
    iecVersion: string;
  };
  executiveSummary: string;
  mastDetails: MetMast[];
  wtgDetails: WTG[];
  assessmentResults: TerrainAssessmentResult[];
  pcvResults: PCVOptimizationResult;
  freestreamResults: FreestreamResult[];
  finalSectors: MeasurementSectorsResult[];
  recommendations: string[];
  appendices: {
    terrainProfiles: TerrainProfile[];
    rawSectorData: SectorAnalysis[];
  };
}

/** Validation error */
export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
  suggestion?: string;
}

/** Input data bundle */
export interface InputDataBundle {
  masts: MetMast[];
  wtgs: WTG[];
  terrainPoints?: TerrainPoint[];
  roughnessSectors?: RoughnessSector[];
  externalWindFarms?: WindFarmLayout[];
  config: AnalysisConfig;
}
