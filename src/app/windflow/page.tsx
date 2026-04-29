'use client';

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  Wind,
  Layers,
  Eye,
  EyeOff,
  Plus,
  RotateCcw,
  RotateCw,
  MapPin,
  Activity,
  Zap,
  ChevronDown,
  ChevronRight,
  Settings,
  FileText,
  HelpCircle,
  Menu,
  X,
} from 'lucide-react';

import dynamic from 'next/dynamic';

const MapView = dynamic(() => import('@/components/windflow/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 bg-[#0a0e1a] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-slate-400">Loading map engine...</span>
      </div>
    </div>
  ),
});
import type { Turbine as MapTurbine } from '@/components/windflow/MapView';
import WindRose from '@/components/windflow/WindRose';
import Toolbar from '@/components/windflow/Toolbar';
import type { ToolType, MapStyle } from '@/components/windflow/Toolbar';
import PropertiesPanel from '@/components/windflow/PropertiesPanel';
import type { ProjectSettings } from '@/components/windflow/PropertiesPanel';

import {
  frictionVelocity,
  stabilityCorrectedProfile,
  jacksonHuntSpeedup,
  turbulenceIntensity,
  LAND_COVER_ROUGHNESS,
  type StabilityParams,
} from '@/lib/windflow/engine';
import {
  weibullMean,
  weibullPDF,
  fitWeibull,
  reverseWindAtlas,
  forwardWindAtlas,
  calculateWindRoseFrequencies,
  energyPatternFactor,
  type SiteClimate,
  type WindAtlas,
} from '@/lib/windflow/wind-atlas';
import {
  calculateWindFarmWakes,
  directionalWakeAnalysis,
  getDefaultPowerCurve,
  estimateCt,
  interpolatePower,
  type Turbine,
  type SuperpositionMethod,
} from '@/lib/windflow/wake';
import {
  calculateAEP,
  calculateUncertainty,
  monthlyEnergyDistribution,
  aepWaterfall,
} from '@/lib/windflow/aep';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface WindRoseDataPoint {
  direction: number;
  frequency: number;
  meanSpeed: number;
  weibullA?: number;
  weibullK?: number;
}

interface AnalysisResults {
  type: 'terrain' | 'wake' | 'aep' | null;
  data: any;
}

interface LayerVisibility {
  turbines: boolean;
  wakes: boolean;
  resource: boolean;
  boundary: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const M_PER_DEG_LAT = 111320;
const DEFAULT_CENTER: [number, number] = [51.0, -0.85];
const DEFAULT_ZOOM = 12;

const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  name: 'Untitled Wind Farm',
  hubHeight: 100,
  weibullA: 9.5,
  weibullK: 2.2,
  roughness: 0.03,
  terrainType: 'flat',
  numSectors: 12,
};

const DEFAULT_WIND_ROSE: WindRoseDataPoint[] = [
  { direction: 0, frequency: 0.09, meanSpeed: 9.2, weibullA: 9.0, weibullK: 2.1 },
  { direction: 30, frequency: 0.07, meanSpeed: 8.8, weibullA: 8.6, weibullK: 2.0 },
  { direction: 60, frequency: 0.06, meanSpeed: 8.4, weibullA: 8.2, weibullK: 2.0 },
  { direction: 90, frequency: 0.05, meanSpeed: 7.8, weibullA: 7.6, weibullK: 1.9 },
  { direction: 120, frequency: 0.04, meanSpeed: 7.2, weibullA: 7.0, weibullK: 1.9 },
  { direction: 150, frequency: 0.04, meanSpeed: 7.0, weibullA: 6.8, weibullK: 1.8 },
  { direction: 180, frequency: 0.04, meanSpeed: 7.1, weibullA: 6.9, weibullK: 1.9 },
  { direction: 210, frequency: 0.04, meanSpeed: 7.6, weibullA: 7.4, weibullK: 1.9 },
  { direction: 240, frequency: 0.05, meanSpeed: 8.2, weibullA: 8.0, weibullK: 2.0 },
  { direction: 270, frequency: 0.10, meanSpeed: 9.8, weibullA: 9.6, weibullK: 2.2 },
  { direction: 300, frequency: 0.08, meanSpeed: 9.5, weibullA: 9.3, weibullK: 2.1 },
  { direction: 330, frequency: 0.10, meanSpeed: 9.6, weibullA: 9.4, weibullK: 2.2 },
];

const DEFAULT_LOSSES = {
  wake: 0,
  electrical: 0.02,
  availability: 0.03,
  environmental: 0.01,
};

const UNCERTAINTY_SOURCES = [
  { name: 'Wind measurement', value: 0.05 },
  { name: 'Wind variability', value: 0.055 },
  { name: 'Wake modelling', value: 0.02 },
  { name: 'Power curve', value: 0.015 },
  { name: 'Electrical losses', value: 0.005 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

/** Meters per degree of longitude at a given latitude */
function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Convert lat/lng to local x/y meters (relative to origin) */
function latLngToMeters(
  lat: number,
  lng: number,
  originLat: number,
  originLng: number,
): { x: number; y: number } {
  return {
    x: (lng - originLng) * mPerDegLng(originLat),
    y: (lat - originLat) * M_PER_DEG_LAT,
  };
}

/** Convert local x/y meters back to lat/lng */
function metersToLatLng(
  x: number,
  y: number,
  originLat: number,
  originLng: number,
): { lat: number; lng: number } {
  return {
    lat: originLat + y / M_PER_DEG_LAT,
    lng: originLng + x / mPerDegLng(originLat),
  };
}

/** Generate a unique turbine ID */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/** Compute terrain length scale L based on terrain type */
function getTerrainLength(terrainType: string): number {
  switch (terrainType) {
    case 'flat': return 2000;
    case 'rolling': return 1000;
    case 'complex': return 500;
    case 'mountainous': return 200;
    default: return 1000;
  }
}

/** Compute terrain profile (flat with slight variation) */
function buildTerrainProfile(
  x: number,
  y: number,
  terrainType: string,
): { distance: number[]; elevation: number[] } {
  const L = getTerrainLength(terrainType);
  const baseElevation = 150;
  const numPoints = 20;
  const extent = 2 * L;
  const step = extent / (numPoints - 1);
  const distance: number[] = [];
  const elevation: number[] = [];

  for (let i = 0; i < numPoints; i++) {
    distance.push(-L + i * step);
    const distFromCenter = Math.abs(-L + i * step - x);
    // Small speed-up bump for non-flat terrain
    const hillHeight =
      terrainType === 'flat' ? 0 : 20 * Math.exp(-(distFromCenter * distFromCenter) / (L * L));
    elevation.push(baseElevation + hillHeight);
  }

  return { distance, elevation };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Collapsible Section Component (Left Panel)
// ═══════════════════════════════════════════════════════════════════════════════

function LeftPanelSection({
  icon: Icon,
  title,
  defaultOpen = true,
  children,
}: {
  icon: React.ElementType;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b border-[#1e293b]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#162033] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
        )}
        <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 flex-1">
          {title}
        </span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Page Component
// ═══════════════════════════════════════════════════════════════════════════════

export default function WindFlowPage() {
  // ── Core State ──────────────────────────────────────────────────────────────
  const [turbines, setTurbines] = useState<Turbine[]>([]);
  const [selectedTurbineId, setSelectedTurbineId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>('pointer');
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');
  const [calculating, setCalculating] = useState(false);

  // ── Project Settings ────────────────────────────────────────────────────────
  const [projectSettings, setProjectSettings] =
    useState<ProjectSettings>(DEFAULT_PROJECT_SETTINGS);

  // ── Wind Data ──────────────────────────────────────────────────────────────
  const [windDirection, setWindDirection] = useState(270); // prevailing westerly
  const [windSpeed, setWindSpeed] = useState(9.5);
  const [windRoseData, setWindRoseData] =
    useState<WindRoseDataPoint[]>(DEFAULT_WIND_ROSE);

  // ── Layers ─────────────────────────────────────────────────────────────────
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    turbines: true,
    wakes: false,
    resource: false,
    boundary: false,
  });

  // ── Map Data ───────────────────────────────────────────────────────────────
  const [resourceGrid, setResourceGrid] = useState<
    { lat: number; lng: number; speed: number }[] | undefined
  >(undefined);
  const [boundaryPoints, setBoundaryPoints] = useState<
    { lat: number; lng: number }[] | undefined
  >(undefined);

  // ── Analysis Results ──────────────────────────────────────────────────────
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [losses, setLosses] = useState(DEFAULT_LOSSES);

  // ── UI State ──────────────────────────────────────────────────────────────
  const [showMenu, setShowMenu] = useState(false);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const turbineCounterRef = useRef(0);

  // ── Derived Values ────────────────────────────────────────────────────────

  const selectedTurbine = useMemo(
    () => turbines.find((t) => t.id === selectedTurbineId) ?? null,
    [turbines, selectedTurbineId],
  );

  const totalCapacity = useMemo(
    () => turbines.reduce((sum, t) => sum + t.ratedPower, 0),
    [turbines],
  );

  const farmArea = useMemo(() => {
    if (turbines.length < 3) return 0;
    const lats = turbines.map((t) => t.lat ?? 0);
    const lngs = turbines.map((t) => t.lng ?? 0);
    const latRange = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG_LAT;
    const lngRange =
      (Math.max(...lngs) - Math.min(...lngs)) * mPerDegLng(mapCenter[0]);
    return (latRange * lngRange) / 1e6; // km²
  }, [turbines, mapCenter]);

  const meanWS = useMemo(
    () => weibullMean(projectSettings.weibullA, projectSettings.weibullK),
    [projectSettings.weibullA, projectSettings.weibullK],
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Turbine CRUD Handlers
  // ══════════════════════════════════════════════════════════════════════════

  const handleTurbineAdd = useCallback(
    (lat: number, lng: number) => {
      turbineCounterRef.current += 1;
      const name = `WTG-${String(turbineCounterRef.current).padStart(2, '0')}`;
      const { x, y } = latLngToMeters(lat, lng, mapCenter[0], mapCenter[1]);
      const newTurbine: Turbine = {
        id: generateId(),
        name,
        x,
        y,
        lat,
        lng,
        hubHeight: projectSettings.hubHeight,
        rotorDiameter: 100,
        ratedPower: 3000,
        ratedSpeed: 12,
        cutInSpeed: 3,
        cutOutSpeed: 25,
      };
      setTurbines((prev) => [...prev, newTurbine]);
      setSelectedTurbineId(newTurbine.id);
    },
    [mapCenter, projectSettings.hubHeight],
  );

  const handleTurbineMove = useCallback(
    (id: string, lat: number, lng: number) => {
      const { x, y } = latLngToMeters(lat, lng, mapCenter[0], mapCenter[1]);
      setTurbines((prev) =>
        prev.map((t) => (t.id === id ? { ...t, lat, lng, x, y } : t)),
      );
    },
    [mapCenter],
  );

  const handleTurbineSelect = useCallback((id: string | null) => {
    setSelectedTurbineId(id);
  }, []);

  const handleTurbineDelete = useCallback((id: string) => {
    setTurbines((prev) => prev.filter((t) => t.id !== id));
    setSelectedTurbineId(null);
  }, []);

  const handleTurbineUpdate = useCallback(
    (id: string, updates: Partial<Turbine>) => {
      setTurbines((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      );
    },
    [],
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Settings Update
  // ══════════════════════════════════════════════════════════════════════════

  const handleSettingsUpdate = useCallback(
    (updates: Partial<ProjectSettings>) => {
      setProjectSettings((prev) => ({ ...prev, ...updates }));
    },
    [],
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Map Controls
  // ══════════════════════════════════════════════════════════════════════════

  const handleZoomIn = useCallback(() => {
    setMapZoom((z) => Math.min(z + 1, 18));
  }, []);

  const handleZoomOut = useCallback(() => {
    setMapZoom((z) => Math.max(z - 1, 3));
  }, []);

  const handleFitAll = useCallback(() => {
    if (turbines.length === 0) {
      setMapCenter(DEFAULT_CENTER);
      setMapZoom(DEFAULT_ZOOM);
      return;
    }
    const lats = turbines.filter((t) => t.lat != null).map((t) => t.lat!);
    const lngs = turbines.filter((t) => t.lng != null).map((t) => t.lng!);
    if (lats.length === 0) return;
    const avgLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const avgLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
    setMapCenter([avgLat, avgLng]);
    setMapZoom(13);
  }, [turbines]);

  const handleUndo = useCallback(() => {
    // Simple undo: remove last turbine
    setTurbines((prev) => {
      if (prev.length === 0) return prev;
      const removed = prev[prev.length - 1];
      if (removed.id === selectedTurbineId) setSelectedTurbineId(null);
      return prev.slice(0, -1);
    });
  }, [selectedTurbineId]);

  const handleRedo = useCallback(() => {
    // Placeholder — would need history stack for full implementation
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // Layer Toggle
  // ══════════════════════════════════════════════════════════════════════════

  const toggleLayer = useCallback((key: keyof LayerVisibility) => {
    setLayerVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // Add Sample Layout
  // ══════════════════════════════════════════════════════════════════════════

  const addSampleLayout = useCallback(() => {
    const centerLat = mapCenter[0];
    const centerLng = mapCenter[1];
    const spacingLat = 800 / M_PER_DEG_LAT; // degrees for 800m at this latitude
    const spacingLng = 800 / mPerDegLng(centerLat);
    const newTurbines: Turbine[] = [];
    let counter = turbineCounterRef.current;

    for (let row = -1; row <= 1; row++) {
      for (let col = -1; col <= 1; col++) {
        counter += 1;
        const lat = centerLat + row * spacingLat;
        const lng = centerLng + col * spacingLng;
        const { x, y } = latLngToMeters(lat, lng, centerLat, centerLng);
        newTurbines.push({
          id: generateId(),
          name: `WTG-${String(counter).padStart(2, '0')}`,
          x,
          y,
          lat,
          lng,
          hubHeight: 100,
          rotorDiameter: 100,
          ratedPower: 3000,
          ratedSpeed: 12,
          cutInSpeed: 3,
          cutOutSpeed: 25,
        });
      }
    }

    turbineCounterRef.current = counter;
    setTurbines(newTurbines);
    setSelectedTurbineId(null);
    setResults(null);
    setResourceGrid(undefined);
  }, [mapCenter]);

  // ══════════════════════════════════════════════════════════════════════════
  // Wind Rose Sector Click Handler
  // ══════════════════════════════════════════════════════════════════════════

  const handleSectorClick = useCallback((sectorIndex: number) => {
    const sector = DEFAULT_WIND_ROSE[sectorIndex];
    if (sector) {
      setWindDirection(sector.direction);
      setWindSpeed(sector.meanSpeed);
    }
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // Boundary Point Handler
  // ══════════════════════════════════════════════════════════════════════════

  const handleBoundaryPointAdd = useCallback(
    (lat: number, lng: number) => {
      setBoundaryPoints((prev) => [...(prev ?? []), { lat, lng }]);
    },
    [],
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Run Full Analysis
  // ══════════════════════════════════════════════════════════════════════════

  const runAnalysis = useCallback(async () => {
    if (turbines.length === 0) return;
    setCalculating(true);

    // Use setTimeout to let the UI update with the spinner
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      const { weibullA, weibullK, roughness, terrainType, numSectors } =
        projectSettings;
      const z0 = roughness;
      const refHeight = 100;

      // ── STEP 1: Flow Model Calculation ───────────────────────────────────
      const uStar = frictionVelocity(weibullA, refHeight, z0);
      const stability: StabilityParams = {
        z0,
        L: 99999, // neutral
        type: 'neutral',
      };

      const terrainResults: {
        turbineId: string;
        turbineName: string;
        windSpeed: number;
        speedUp: number;
        turbulenceIntensity: number;
        deflection: number;
      }[] = [];

      const turbineWindSpeeds: Record<string, number> = {};

      for (const t of turbines) {
        // Wind speed at hub height using stability-corrected log profile
        const hubSpeed = stabilityCorrectedProfile(
          t.hubHeight,
          z0,
          uStar,
          stability,
        );

        // Terrain speed-up (Jackson-Hunt)
        const terrainProfile = buildTerrainProfile(t.x, t.y, terrainType);
        const L = getTerrainLength(terrainType);
        const speedUp = jacksonHuntSpeedup(terrainProfile, t.x, t.hubHeight, L);

        const effectiveSpeed = hubSpeed * (1 + speedUp);
        const ti = turbulenceIntensity(
          uStar,
          effectiveSpeed,
          t.hubHeight,
          z0,
          'neutral',
        );
        const deflection = flowDeflectionAngle(0.5, speedUp);

        turbineWindSpeeds[t.id] = effectiveSpeed;

        terrainResults.push({
          turbineId: t.id,
          turbineName: t.name,
          windSpeed: Math.round(effectiveSpeed * 100) / 100,
          speedUp: Math.round(speedUp * 1000) / 1000,
          turbulenceIntensity: Math.round(ti * 10000) / 100,
          deflection: Math.round(deflection * 100) / 100,
        });
      }

      setResults({
        type: 'terrain',
        data: { turbines: terrainResults },
      });

      // ── Generate Resource Grid ────────────────────────────────────────────
      if (turbines.length > 0) {
        const gridPoints: { lat: number; lng: number; speed: number }[] = [];
        const lats = turbines
          .filter((t) => t.lat != null)
          .map((t) => t.lat!);
        const lngs = turbines
          .filter((t) => t.lng != null)
          .map((t) => t.lng!);

        if (lats.length > 0) {
          const minLat = Math.min(...lats) - 0.005;
          const maxLat = Math.max(...lats) + 0.005;
          const minLng = Math.min(...lngs) - 0.005;
          const maxLng = Math.max(...lngs) + 0.005;
          const gridSpacingLat = 200 / M_PER_DEG_LAT;
          const gridSpacingLng = 200 / mPerDegLng(mapCenter[0]);

          const numLatSteps = Math.ceil(
            (maxLat - minLat) / gridSpacingLat,
          );
          const numLngSteps = Math.ceil(
            (maxLng - minLng) / gridSpacingLng,
          );

          // Limit grid density for performance
          const maxSteps = 25;
          const latStep = numLatSteps > maxSteps ? numLatSteps / maxSteps : 1;
          const lngStep = numLngSteps > maxSteps ? numLngSteps / maxSteps : 1;

          for (let i = 0; i <= numLatSteps; i += latStep) {
            for (let j = 0; j <= numLngSteps; j += lngStep) {
              const lat = minLat + i * gridSpacingLat;
              const lng = minLng + j * gridSpacingLng;
              // Use base hub speed with slight spatial variation
              const hubSpeed = stabilityCorrectedProfile(
                projectSettings.hubHeight,
                z0,
                uStar,
                stability,
              );
              // Add small spatial variation for visual interest
              const noise =
                0.15 *
                Math.sin(lat * 1000) *
                Math.cos(lng * 1000);
              gridPoints.push({
                lat,
                lng,
                speed: Math.max(
                  0,
                  Math.round((hubSpeed + noise) * 10) / 10,
                ),
              });
            }
          }
        }

        setResourceGrid(gridPoints);
        setLayerVisibility((prev) => ({ ...prev, resource: true }));
      }

      // ── STEP 2: Wake Analysis ─────────────────────────────────────────────
      const sectorFreq = windRoseData.map((d) => d.frequency);
      const sectorMeanSpeed = windRoseData.map((d) => d.meanSpeed);

      const wakeAnalysisResult = directionalWakeAnalysis(
        turbines,
        { sectorFreq, meanSpeed: sectorMeanSpeed },
        'RSS',
      );

      const wakeTurbineData = wakeAnalysisResult.sectorResults.length > 0
        ? wakeAnalysisResult.sectorResults[wakeAnalysisResult.sectorResults.length - 1].results.map(
            (wr) => {
              const t = turbines.find(
                (tb) => tb.id === wr.turbineId,
              );
              return {
                id: wr.turbineId,
                name: t?.name ?? 'Unknown',
                effectiveWindSpeed: Math.round(wr.effectiveSpeed * 100) / 100,
                wakeDeficit: Math.round(wr.totalDeficit * 10000) / 100,
                powerOutput: Math.round(wr.powerOutput),
              };
            },
          )
        : [];

      // Update wake loss
      const actualWakeLoss =
        1 - wakeAnalysisResult.overallEfficiency;

      setResults({
        type: 'wake',
        data: {
          farmEfficiency: Math.round(
            wakeAnalysisResult.overallEfficiency * 10000,
          ) / 100,
          overallWakeLoss: Math.round(
            wakeAnalysisResult.overallWakeLoss * 100,
          ) / 100,
          turbines: wakeTurbineData,
        },
      });

      setLayerVisibility((prev) => ({ ...prev, wakes: true }));

      // ── STEP 3: AEP Calculation ──────────────────────────────────────────
      const powerCurve = getDefaultPowerCurve(3000, 3, 12, 25);
      const totalRatedPower = turbines.reduce(
        (sum, t) => sum + t.ratedPower,
        0,
      );

      const updatedLosses = {
        wake: actualWakeLoss,
        electrical: DEFAULT_LOSSES.electrical,
        availability: DEFAULT_LOSSES.availability,
        environmental: DEFAULT_LOSSES.environmental,
      };
      setLosses(updatedLosses);

      const aepResult = calculateAEP(
        weibullA,
        weibullK,
        powerCurve,
        totalRatedPower,
        updatedLosses,
      );

      // Uncertainty analysis
      const uncertaintyResult = calculateUncertainty(
        aepResult.netAEP,
        UNCERTAINTY_SOURCES,
      );

      // Monthly distribution
      const monthlyData = monthlyEnergyDistribution(aepResult.netAEP);

      // Waterfall
      const waterfallSteps = aepWaterfall(aepResult.grossAEP, updatedLosses);

      // Per-turbine AEP breakdown
      const perTurbineAEP = turbines.map((t) => {
        const tPowerCurve = getDefaultPowerCurve(
          t.ratedPower,
          t.cutInSpeed,
          t.ratedSpeed,
          t.cutOutSpeed,
        );
        const tAEP = calculateAEP(
          weibullA,
          weibullK,
          tPowerCurve,
          t.ratedPower,
          updatedLosses,
        );
        return {
          id: t.id,
          name: t.name,
          grossAEP: tAEP.grossAEP,
          netAEP: tAEP.netAEP,
          capacityFactor: tAEP.capacityFactor,
        };
      });

      setResults({
        type: 'aep',
        data: {
          summary: {
            grossAEP: aepResult.grossAEP,
            netAEP: aepResult.netAEP,
            capacityFactor: aepResult.capacityFactor,
            fullLoadHours: aepResult.fullLoadHours,
            meanPower: aepResult.meanPower,
            p90AEP: uncertaintyResult.p90AEP,
            p75AEP: uncertaintyResult.p75AEP,
            p50AEP: uncertaintyResult.p50AEP,
            totalUncertainty: uncertaintyResult.totalUncertainty,
          },
          turbines: perTurbineAEP,
          losses: aepResult.losses,
          uncertainty: uncertaintyResult,
          monthly: monthlyData,
          waterfall: waterfallSteps,
        },
      });
    } catch (error) {
      console.error('Analysis error:', error);
    } finally {
      setCalculating(false);
    }
  }, [turbines, projectSettings, windRoseData, mapCenter]);

  // ══════════════════════════════════════════════════════════════════════════
  // Convert Turbine[] to MapTurbine[]
  // ══════════════════════════════════════════════════════════════════════════

  const mapTurbines: MapTurbine[] = useMemo(
    () =>
      turbines.map((t) => ({
        id: t.id,
        name: t.name,
        x: t.x,
        y: t.y,
        lat: t.lat,
        lng: t.lng,
        hubHeight: t.hubHeight,
        rotorDiameter: t.rotorDiameter,
        ratedPower: t.ratedPower,
        ratedSpeed: t.ratedSpeed,
        cutInSpeed: t.cutInSpeed,
        cutOutSpeed: t.cutOutSpeed,
      })),
    [turbines],
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="h-screen flex flex-col bg-[#0a0e1a] overflow-hidden select-none">
      {/* ── MENU BAR ─────────────────────────────────────────────────────── */}
      <div className="h-8 bg-[#0c1222] border-b border-[#1e293b] flex items-center px-3 shrink-0 z-50 relative">
        {/* Logo / App Name */}
        <div className="flex items-center gap-2 mr-4">
          <div className="w-5 h-5 bg-emerald-600 rounded flex items-center justify-center">
            <Wind className="w-3 h-3 text-white" />
          </div>
          <span className="text-xs font-bold text-white tracking-wide">
            WindFlow
          </span>
          <span className="text-[10px] text-slate-500 font-medium">
            v1.0
          </span>
        </div>

        {/* Menu items */}
        <div className="hidden sm:flex items-center gap-0.5">
          {['File', 'View', 'Tools', 'Help'].map((item) => (
            <button
              key={item}
              type="button"
              className="px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-[#162033] rounded transition-colors"
            >
              {item}
            </button>
          ))}
        </div>

        {/* Project name */}
        <div className="ml-4 flex items-center gap-1.5">
          <span className="text-[10px] text-slate-600">PROJECT:</span>
          <span className="text-[11px] text-slate-300 font-medium">
            {projectSettings.name}
          </span>
        </div>

        <div className="flex-1" />

        {/* Quick stats in menu bar */}
        <div className="hidden md:flex items-center gap-3 text-[10px] text-slate-500">
          <span>
            WTGs:{' '}
            <span className="text-slate-300 font-medium">
              {turbines.length}
            </span>
          </span>
          <span className="text-[#1e293b]">|</span>
          <span>
            Capacity:{' '}
            <span className="text-slate-300 font-medium">
              {totalCapacity >= 1000
                ? `${(totalCapacity / 1000).toFixed(1)} MW`
                : `${totalCapacity} kW`}
            </span>
          </span>
          <span className="text-[#1e293b]">|</span>
          <span>
            Mean WS:{' '}
            <span className="text-emerald-400 font-medium">
              {meanWS.toFixed(1)} m/s
            </span>
          </span>
        </div>

        {/* Mobile menu toggle */}
        <button
          type="button"
          className="sm:hidden ml-2 text-slate-400 hover:text-white"
          onClick={() => setShowMenu((v) => !v)}
        >
          <Menu className="w-4 h-4" />
        </button>
      </div>

      {/* ── TOOLBAR ──────────────────────────────────────────────────────── */}
      <Toolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitAll={handleFitAll}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCalculate={runAnalysis}
        calculating={calculating}
        mapStyle={mapStyle}
        onMapStyleChange={setMapStyle}
      />

      {/* ── MAIN CONTENT AREA ────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* ── LEFT PANEL (240px) ─────────────────────────────────────────── */}
        <div className="w-[240px] bg-[#0f172a] border-r border-[#1e293b] flex flex-col shrink-0 overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e293b] shrink-0">
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Explorer
            </span>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* ── Section 1: Layers ──────────────────────────────────── */}
            <LeftPanelSection icon={Layers} title="Layers" defaultOpen>
              {[
                {
                  key: 'turbines' as const,
                  label: 'Turbines',
                },
                {
                  key: 'wakes' as const,
                  label: 'Wake Zones',
                },
                {
                  key: 'resource' as const,
                  label: 'Resource Grid',
                },
                {
                  key: 'boundary' as const,
                  label: 'Farm Boundary',
                },
              ].map((layer) => (
                <label
                  key={layer.key}
                  className="flex items-center gap-2 px-1 py-1 rounded hover:bg-[#162033] cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={layerVisibility[layer.key]}
                    onChange={() => toggleLayer(layer.key)}
                    className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 accent-emerald-500"
                  />
                  <span className="text-xs text-slate-300">
                    {layer.label}
                  </span>
                  {layerVisibility[layer.key] ? (
                    <Eye className="w-3 h-3 text-emerald-500 ml-auto" />
                  ) : (
                    <EyeOff className="w-3 h-3 text-slate-600 ml-auto" />
                  )}
                </label>
              ))}

              {/* Wind direction indicator */}
              <div className="mt-2 p-2 bg-[#0c1222] rounded border border-[#1e293b]">
                <div className="text-[10px] text-slate-500 font-medium mb-1.5">
                  WIND DIRECTION
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={359}
                    step={1}
                    value={windDirection}
                    onChange={(e) =>
                      setWindDirection(Number(e.target.value))
                    }
                    className="flex-1 h-1 accent-emerald-500"
                  />
                  <span className="text-xs text-emerald-400 font-mono w-8 text-right">
                    {windDirection}°
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-slate-500">Speed:</span>
                  <input
                    type="number"
                    value={windSpeed}
                    onChange={(e) =>
                      setWindSpeed(Number(e.target.value))
                    }
                    min={0}
                    max={40}
                    step={0.5}
                    className="w-16 h-5 px-1.5 text-[10px] bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] text-slate-500">m/s</span>
                </div>
              </div>
            </LeftPanelSection>

            {/* ── Section 2: Turbine List ─────────────────────────────── */}
            <LeftPanelSection
              icon={Wind}
              title="Turbines"
              defaultOpen
            >
              {turbines.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-[11px] text-slate-500 italic">
                    No turbines placed
                  </p>
                  <p className="text-[10px] text-slate-600 mt-1">
                    Use the turbine tool or click below
                  </p>
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto custom-scrollbar">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="text-left pb-1 pr-1 font-medium">
                          #
                        </th>
                        <th className="text-left pb-1 pr-1 font-medium">
                          Name
                        </th>
                        <th className="text-right pb-1 pr-1 font-medium">
                          Lat
                        </th>
                        <th className="text-right pb-1 font-medium">
                          HH
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {turbines.map((t, idx) => (
                        <tr
                          key={t.id}
                          onClick={() =>
                            handleTurbineSelect(
                              selectedTurbineId === t.id
                                ? null
                                : t.id,
                            )
                          }
                          className={`cursor-pointer transition-colors ${
                            selectedTurbineId === t.id
                              ? 'bg-emerald-600/20 text-emerald-300'
                              : 'text-slate-400 hover:bg-[#162033]'
                          }`}
                        >
                          <td className="py-0.5 pr-1">{idx + 1}</td>
                          <td className="py-0.5 pr-1 font-medium truncate max-w-[80px]">
                            {t.name}
                          </td>
                          <td className="py-0.5 pr-1 text-right font-mono">
                            {t.lat ? t.lat.toFixed(4) : '—'}
                          </td>
                          <td className="py-0.5 text-right font-mono">
                            {t.hubHeight}m
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button
                type="button"
                onClick={addSampleLayout}
                className="w-full mt-2 h-7 text-[11px] font-medium rounded bg-emerald-600/20 border border-emerald-600/30 text-emerald-400 hover:bg-emerald-600/30 hover:text-emerald-300 transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3 h-3" />
                Add Sample Layout (3×3)
              </button>
            </LeftPanelSection>

            {/* ── Section 3: Wind Rose ────────────────────────────────── */}
            <LeftPanelSection
              icon={Activity}
              title="Wind Rose"
              defaultOpen
            >
              <div className="flex justify-center">
                <WindRose
                  data={windRoseData}
                  numSectors={projectSettings.numSectors}
                  size={220}
                  onSectorClick={handleSectorClick}
                />
              </div>
            </LeftPanelSection>

            {/* ── Section 4: Quick Stats ──────────────────────────────── */}
            <LeftPanelSection
              icon={Zap}
              title="Quick Stats"
              defaultOpen
            >
              <div className="space-y-2">
                {[
                  {
                    label: 'Total Capacity',
                    value:
                      totalCapacity >= 1000
                        ? `${(totalCapacity / 1000).toFixed(1)} MW`
                        : `${totalCapacity} kW`,
                    color: 'text-emerald-400',
                  },
                  {
                    label: 'Farm Area',
                    value:
                      farmArea > 0
                        ? `${farmArea.toFixed(2)} km²`
                        : '—',
                    color: 'text-cyan-400',
                  },
                  {
                    label: 'Mean Wind Speed',
                    value: `${meanWS.toFixed(1)} m/s`,
                    color: 'text-amber-400',
                  },
                  {
                    label: 'Turbine Count',
                    value: `${turbines.length}`,
                    color: 'text-slate-200',
                  },
                  {
                    label: 'Roughness z₀',
                    value: `${projectSettings.roughness} m`,
                    color: 'text-slate-300',
                  },
                  {
                    label: 'Terrain Type',
                    value: projectSettings.terrainType,
                    color: 'text-slate-300',
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="flex items-center justify-between px-1"
                  >
                    <span className="text-[10px] text-slate-500">
                      {stat.label}
                    </span>
                    <span
                      className={`text-[11px] font-semibold ${stat.color}`}
                    >
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Weibull info */}
              <div className="mt-2 p-2 bg-[#0c1222] rounded border border-[#1e293b]">
                <div className="text-[10px] text-slate-500 font-medium mb-1">
                  WEIBULL DISTRIBUTION
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <span className="text-[10px] text-slate-600">
                      Scale A:
                    </span>{' '}
                    <span className="text-[11px] text-emerald-400 font-mono">
                      {projectSettings.weibullA} m/s
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-600">
                      Shape k:
                    </span>{' '}
                    <span className="text-[11px] text-emerald-400 font-mono">
                      {projectSettings.weibullK}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-600">
                      EPF (K):
                    </span>{' '}
                    <span className="text-[11px] text-slate-300 font-mono">
                      {energyPatternFactor(
                        projectSettings.weibullA,
                        projectSettings.weibullK,
                      ).toFixed(3)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-600">
                      Sectors:
                    </span>{' '}
                    <span className="text-[11px] text-slate-300 font-mono">
                      {projectSettings.numSectors}
                    </span>
                  </div>
                </div>
              </div>
            </LeftPanelSection>
          </div>
        </div>

        {/* ── MAP VIEW ────────────────────────────────────────────────────── */}
        <div className="flex-1 relative min-w-0">
          <MapView
            turbines={mapTurbines}
            onTurbineAdd={handleTurbineAdd}
            onTurbineMove={handleTurbineMove}
            onTurbineSelect={handleTurbineSelect}
            onTurbineDelete={handleTurbineDelete}
            selectedTurbineId={selectedTurbineId}
            activeTool={activeTool}
            showWakeZones={layerVisibility.wakes}
            showResourceGrid={layerVisibility.resource}
            showBoundary={layerVisibility.boundary}
            windDirection={windDirection}
            windSpeed={windSpeed}
            resourceData={resourceGrid}
            boundaryPoints={boundaryPoints}
            onBoundaryPointAdd={handleBoundaryPointAdd}
            center={mapCenter}
            zoom={mapZoom}
          />

          {/* Map overlay: right panel toggle */}
          <button
            type="button"
            onClick={() => setRightPanelVisible((v) => !v)}
            className="absolute top-3 right-3 z-[1000] w-8 h-8 bg-[#1e293b]/90 backdrop-blur-sm border border-[#334155] rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-[#334155] transition-colors"
            title={rightPanelVisible ? 'Hide Properties' : 'Show Properties'}
          >
            {rightPanelVisible ? (
              <X className="w-4 h-4" />
            ) : (
              <Settings className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* ── RIGHT PANEL (Properties) ───────────────────────────────────── */}
        <PropertiesPanel
          selectedTurbine={selectedTurbine}
          onTurbineUpdate={handleTurbineUpdate}
          projectSettings={projectSettings}
          onSettingsUpdate={handleSettingsUpdate}
          results={results}
          visible={rightPanelVisible}
        />
      </div>

      {/* ── STATUS BAR ────────────────────────────────────────────────────── */}
      <div className="h-7 bg-[#0c1222] border-t border-[#1e293b] flex items-center px-3 shrink-0 z-50">
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-slate-600">
            LAT{' '}
            <span className="text-slate-400">
              {mapCenter[0].toFixed(4)}
            </span>
          </span>
          <span className="text-[#1e293b]">│</span>
          <span className="text-slate-600">
            LON{' '}
            <span className="text-slate-400">
              {mapCenter[1].toFixed(4)}
            </span>
          </span>
          <span className="text-[#1e293b]">│</span>
          <span className="text-slate-600">
            ZOOM{' '}
            <span className="text-slate-400">{mapZoom}</span>
          </span>
          <span className="text-[#1e293b]">│</span>
          <span className="text-slate-600">
            WTGs{' '}
            <span className="text-emerald-400">
              {turbines.length}
            </span>
          </span>
          <span className="text-[#1e293b]">│</span>
          <span className="text-slate-600">
            TOOL{' '}
            <span className="text-cyan-400 uppercase">
              {activeTool}
            </span>
          </span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-3 text-[10px]">
          {calculating && (
            <span className="flex items-center gap-1.5 text-amber-400">
              <span className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
              Calculating...
            </span>
          )}
          {results && (
            <span className="flex items-center gap-1 text-emerald-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Analysis complete
            </span>
          )}
          <span className="text-slate-600">WGS 84</span>
        </div>
      </div>

      {/* ── DARK THEME SCROLLBAR STYLES ───────────────────────────────────── */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #1e293b;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #334155;
        }
        /* Leaflet container fix */
        .leaflet-container {
          background: #0a0e1a !important;
          font-family: inherit;
        }
        /* Cursor styles */
        .cursor-crosshair .leaflet-container {
          cursor: crosshair !important;
        }
        .cursor-grab .leaflet-container {
          cursor: grab !important;
        }
        .cursor-grab .leaflet-container:active {
          cursor: grabbing !important;
        }
        /* Range input dark theme */
        input[type='range'] {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          background: #1e293b;
          border-radius: 2px;
          outline: none;
        }
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #10b981;
          cursor: pointer;
          border: 2px solid #064e3b;
        }
        input[type='range']::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #10b981;
          cursor: pointer;
          border: 2px solid #064e3b;
        }
        /* Checkbox dark theme */
        input[type='checkbox'] {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border: 1.5px solid #475569;
          border-radius: 3px;
          background: #1e293b;
          cursor: pointer;
          position: relative;
          flex-shrink: 0;
        }
        input[type='checkbox']:checked {
          background: #10b981;
          border-color: #10b981;
        }
        input[type='checkbox']:checked::after {
          content: '';
          position: absolute;
          left: 3.5px;
          top: 0.5px;
          width: 5px;
          height: 9px;
          border: solid white;
          border-width: 0 1.5px 1.5px 0;
          transform: rotate(45deg);
        }
        input[type='checkbox']:focus-visible {
          outline: 2px solid #10b981;
          outline-offset: 1px;
        }
        /* Number input spinner dark theme */
        input[type='number']::-webkit-inner-spin-button,
        input[type='number']::-webkit-outer-spin-button {
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
}
