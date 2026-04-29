'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  logLawWindProfile,
  powerLawWindProfile,
  frictionVelocity,
  roughnessClassFromZ0,
  jacksonHuntSpeedup,
  stabilityCorrectedProfile,
  flowDeflectionAngle,
  turbulenceIntensity,
  LAND_COVER_ROUGHNESS,
  classifyRoughness,
  type StabilityParams,
} from '@/lib/windflow/engine';
import {
  weibullMean,
  reverseWindAtlas,
} from '@/lib/windflow/wind-atlas';
import {
  calculateWindFarmWakes,
  getDefaultPowerCurve,
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TurbineRow {
  id: string;
  name: string;
  x: number;
  y: number;
  hubHeight: number;
  rotorDiameter: number;
  ratedPower: number;
  ratedSpeed: number;
  cutIn: number;
  cutOut: number;
}

interface FlowResult {
  turbineId: string;
  turbineName: string;
  windSpeed: number;
  speedupFactor: number;
  turbulenceIntensity: number;
  deflectionAngle: number;
}

interface ProjectState {
  projectName: string;
  lat: number;
  lon: number;
  description: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAND_COVER_OPTIONS = Object.keys(LAND_COVER_ROUGHNESS).sort();
const HEIGHT_LEVELS = [10, 25, 50, 80, 100, 120, 150];

const DEMO_PROJECT: ProjectState = {
  projectName: 'North Downs Wind Farm',
  lat: 51.15,
  lon: -0.85,
  description: 'A 27 MW onshore wind farm in the South Downs National Park.',
};

function createDemoTurbines(): TurbineRow[] {
  const turbines: TurbineRow[] = [];
  let id = 1;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      turbines.push({
        id: `T${String(id).padStart(2, '0')}`,
        name: `WTG-${String(id).padStart(2, '0')}`,
        x: col * 800,
        y: row * 800,
        hubHeight: 100,
        rotorDiameter: 100,
        ratedPower: 3000,
        ratedSpeed: 12,
        cutIn: 3,
        cutOut: 25,
      });
      id++;
    }
  }
  return turbines;
}

// ---------------------------------------------------------------------------
// SVG Wind Rose Component
// ---------------------------------------------------------------------------

function WindRose({ frequencies }: { frequencies: number[] }) {
  const numSectors = frequencies.length;
  const maxFreq = Math.max(...frequencies, 0.01);
  const cx = 120;
  const cy = 120;
  const maxR = 90;
  const labels = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW'];

  const sectors = frequencies.map((freq, i) => {
    const angle = (i * 360) / numSectors - 90; // start from N
    const angleRad = (angle * Math.PI) / 180;
    const nextAngleRad = (((i + 1) * 360) / numSectors - 90) * (Math.PI) / 180;
    const r = (freq / maxFreq) * maxR;
    const midAngle = (angleRad + nextAngleRad) / 2;

    return {
      freq,
      r,
      x1: cx + r * Math.cos(angleRad),
      y1: cy + r * Math.sin(angleRad),
      x2: cx + r * Math.cos(nextAngleRad),
      y2: cy + r * Math.sin(nextAngleRad),
      labelX: cx + (maxR + 12) * Math.cos(midAngle),
      labelY: cy + (maxR + 12) * Math.sin(midAngle),
      label: labels[i] || `${i}`,
      color: freq > 0
        ? `rgba(16, 185, 129, ${0.3 + 0.7 * (freq / maxFreq)})`
        : 'rgba(203, 213, 225, 0.3)',
    };
  });

  return (
    <svg viewBox="0 0 240 240" className="mx-auto" width={240} height={240}>
      {/* Grid circles */}
      {[0.25, 0.5, 0.75, 1.0].map((scale) => {
        const r = maxR * scale;
        return (
          <circle
            key={scale}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={0.5}
          />
        );
      })}
      {/* Spokes */}
      {Array.from({ length: numSectors }).map((_, i) => {
        const a = (i * 360) / numSectors - 90;
        const rad = (a * Math.PI) / 180;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + maxR * Math.cos(rad)}
            y2={cy + maxR * Math.sin(rad)}
            stroke="#e2e8f0"
            strokeWidth={0.5}
          />
        );
      })}
      {/* Sectors */}
      {sectors.map((s, i) => (
        <polygon
          key={i}
          points={`${cx},${cy} ${s.x1},${s.y1} ${s.x2},${s.y2}`}
          fill={s.color}
          stroke="#059669"
          strokeWidth={0.5}
        />
      ))}
      {/* Labels */}
      {sectors.map((s, i) => (
        <text
          key={i}
          x={s.labelX}
          y={s.labelY}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={7}
          fill="#64748b"
        >
          {s.label}
        </text>
      ))}
      {/* Center dot */}
      <circle cx={cx} cy={cy} r={2} fill="#059669" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Wake Map SVG Component
// ---------------------------------------------------------------------------

function WakeMap({
  turbines,
  windDirection,
}: {
  turbines: TurbineRow[];
  windDirection: number;
}) {
  if (turbines.length === 0) return null;

  const minX = Math.min(...turbines.map((t) => t.x)) - 300;
  const maxX = Math.max(...turbines.map((t) => t.x)) + 300;
  const minY = Math.min(...turbines.map((t) => t.y)) - 300;
  const maxY = Math.max(...turbines.map((t) => t.y)) + 300;

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const range = Math.max(rangeX, rangeY);
  const pad = 60;
  const svgW = 500;
  const svgH = 500;
  const scale = (svgW - 2 * pad) / range;
  const offsetX = pad + (range - rangeX) / 2 * scale;
  const offsetY = pad + (range - rangeY) / 2 * scale;

  const toSVGX = (x: number) => (x - minX) * scale + offsetX;
  const toSVGY = (y: number) => (range - (y - minY)) * scale + offsetY; // flip Y

  // Wind direction vector (where wind goes TO)
  const rad = (windDirection * Math.PI) / 180;
  const wDx = -Math.sin(rad);
  const wDy = -Math.cos(rad);

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: 400 }}>
      {/* Background */}
      <rect width={svgW} height={svgH} fill="#f8fafc" rx={8} />
      {/* Grid */}
      {Array.from({ length: 10 }).map((_, i) => (
        <React.Fragment key={i}>
          <line
            x1={pad + i * ((svgW - 2 * pad) / 9)}
            y1={pad}
            x2={pad + i * ((svgW - 2 * pad) / 9)}
            y2={svgH - pad}
            stroke="#e2e8f0"
            strokeWidth={0.3}
          />
          <line
            x1={pad}
            y1={pad + i * ((svgH - 2 * pad) / 9)}
            x2={svgW - pad}
            y2={pad + i * ((svgH - 2 * pad) / 9)}
            stroke="#e2e8f0"
            strokeWidth={0.3}
          />
        </React.Fragment>
      ))}
      {/* Wake cones */}
      {turbines.map((t) => {
        const tx = toSVGX(t.x);
        const ty = toSVGY(t.y);
        const wakeLen = 600 * scale;
        const coneHalfW = t.rotorDiameter * 0.7 * scale;
        // Wake goes in the wind direction (where wind GOES TO)
        const endX = tx + wDx * wakeLen;
        const endY = ty + wDy * wakeLen;
        const perpX = wDy;
        const perpY = -wDx;
        return (
          <polygon
            key={`wake-${t.id}`}
            points={`${tx + perpX * coneHalfW * 0.5},${ty + perpY * coneHalfW * 0.5} ${endX + perpX * coneHalfW * 1.5},${endY + perpY * coneHalfW * 1.5} ${endX - perpX * coneHalfW * 1.5},${endY - perpY * coneHalfW * 1.5} ${tx - perpX * coneHalfW * 0.5},${ty - perpY * coneHalfW * 0.5}`}
            fill="rgba(16, 185, 129, 0.12)"
            stroke="rgba(16, 185, 129, 0.3)"
            strokeWidth={0.5}
          />
        );
      })}
      {/* Turbines */}
      {turbines.map((t) => {
        const tx = toSVGX(t.x);
        const ty = toSVGY(t.y);
        const r = 8;
        return (
          <g key={t.id}>
            <circle cx={tx} cy={ty} r={r + 2} fill="white" stroke="#059669" strokeWidth={2} />
            <circle cx={tx} cy={ty} r={r} fill="#10b981" />
            <text
              x={tx}
              y={ty + r + 14}
              textAnchor="middle"
              fontSize={9}
              fill="#334155"
              fontWeight={600}
            >
              {t.name}
            </text>
          </g>
        );
      })}
      {/* Wind direction arrow */}
      <g transform={`translate(${svgW - 45}, ${svgH - 45})`}>
        <circle cx={0} cy={0} r={20} fill="white" stroke="#cbd5e1" strokeWidth={1} />
        <line
          x1={wDx * 15}
          y1={wDy * 15}
          x2={-wDx * 15}
          y2={-wDy * 15}
          stroke="#059669"
          strokeWidth={2}
          markerEnd="url(#arrowhead)"
        />
        <text x={0} y={-24} textAnchor="middle" fontSize={7} fill="#64748b">Wind</text>
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill="#059669" />
          </marker>
        </defs>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// AEP Waterfall Chart Component
// ---------------------------------------------------------------------------

function AEPWaterfallChart({ steps }: { steps: { name: string; value: number; loss: boolean; cumulative: number }[] }) {
  if (steps.length === 0) return null;
  const maxVal = Math.max(...steps.map((s) => s.cumulative), 1);
  const barH = 28;
  const gap = 8;
  const svgW = 600;
  const labelW = 120;
  const barArea = svgW - labelW - 80;
  const svgH = steps.length * (barH + gap) + 30;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ maxHeight: 350 }}>
      {steps.map((step, i) => {
        const y = 10 + i * (barH + gap);
        const w = step.loss
          ? Math.abs(step.value / maxVal) * barArea
          : Math.abs(step.cumulative / maxVal) * barArea;
        const xStart = step.loss
          ? labelW + (step.cumulative + step.value) / maxVal * barArea
          : labelW;
        const color = step.loss ? '#ef4444' : '#10b981';
        const displayVal = step.loss
          ? `-${Math.abs(step.value).toFixed(0)} MWh`
          : `${step.cumulative.toFixed(0)} MWh`;

        return (
          <g key={i}>
            <text x={labelW - 8} y={y + barH / 2} textAnchor="end" dominantBaseline="central" fontSize={11} fill="#334155">
              {step.name}
            </text>
            {step.loss ? (
              <rect
                x={xStart}
                y={y}
                width={Math.max(w, 2)}
                height={barH}
                fill={color}
                opacity={0.7}
                rx={4}
              />
            ) : (
              <rect
                x={labelW}
                y={y}
                width={Math.max(w, 2)}
                height={barH}
                fill={color}
                opacity={0.7}
                rx={4}
              />
            )}
            <text
              x={step.loss ? xStart + w + 8 : labelW + w + 8}
              y={y + barH / 2}
              dominantBaseline="central"
              fontSize={10}
              fill="#475569"
            >
              {displayVal}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function WindFlowPage() {
  // ── Project State ──
  const [project, setProject] = useState<ProjectState>({
    projectName: '',
    lat: 0,
    lon: 0,
    description: '',
  });
  const [turbines, setTurbines] = useState<TurbineRow[]>([]);
  const [activeTab, setActiveTab] = useState('setup');

  // ── Terrain & Climate State ──
  const [elevation, setElevation] = useState(150);
  const [terrainType, setTerrainType] = useState('flat');
  const [hillLength, setHillLength] = useState(1000);
  const [hillAspect, setHillAspect] = useState(0.5);
  const [z0, setZ0] = useState(0.03);
  const [landCover, setLandCover] = useState('grassland');
  const [weibullA, setWeibullA] = useState(9.5);
  const [weibullK, setWeibullK] = useState(2.2);
  const [refHeight, setRefHeight] = useState(100);
  const [stabilityType, setStabilityType] = useState('neutral');
  const [obukhovLength, setObukhovLength] = useState(10000);
  const [windRoseFreqs, setWindRoseFreqs] = useState<number[]>(
    new Array(12).fill(1 / 12)
  );

  // ── Flow Model State ──
  const [profileLaw, setProfileLaw] = useState<'log' | 'power'>('log');
  const [powerAlpha, setPowerAlpha] = useState(0.14);
  const [flowResults, setFlowResults] = useState<FlowResult[] | null>(null);
  const [flowProfileData, setFlowProfileData] = useState<{
    heights: number[];
    speeds: number[];
  }[] | null>(null);

  // ── Wake Analysis State ──
  const [wakeDir, setWakeDir] = useState(210);
  const [wakeSpeed, setWakeSpeed] = useState(9.0);
  const [superMethod, setSuperMethod] = useState<SuperpositionMethod>('RSS');
  const [wakeDecay, setWakeDecay] = useState(0.075);
  const [wakeResult, setWakeResult] = useState<ReturnType<typeof calculateWindFarmWakes> | null>(null);

  // ── Energy Yield State ──
  const [aepWakeLoss, setAepWakeLoss] = useState(5);
  const [aepElecLoss, setAepElecLoss] = useState(2);
  const [aepAvailLoss, setAepAvailLoss] = useState(3);
  const [aepEnvLoss, setAepEnvLoss] = useState(1);
  const [uncertaintySources, setUncertaintySources] = useState([
    { name: 'Wind measurement', value: 5.0 },
    { name: 'Wind assessment', value: 3.0 },
    { name: 'Power curve', value: 2.0 },
    { name: 'Wake model', value: 3.0 },
    { name: 'Electrical', value: 1.5 },
    { name: 'Future availability', value: 2.5 },
  ]);
  const [aepResult, setAepResult] = useState<ReturnType<typeof calculateAEP> | null>(null);
  const [uncertaintyResult, setUncertaintyResult] = useState<ReturnType<typeof calculateUncertainty> | null>(null);
  const [waterfallSteps, setWaterfallSteps] = useState<ReturnType<typeof aepWaterfall> | null>(null);
  const [monthlyData, setMonthlyData] = useState<ReturnType<typeof monthlyEnergyDistribution> | null>(null);

  // ── Computed values ──
  const meanWindSpeed = useMemo(() => weibullMean(weibullA, weibullK), [weibullA, weibullK]);
  const roughnessInfo = useMemo(() => classifyRoughness(z0), [z0]);

  const totalCapacity = useMemo(
    () => turbines.reduce((sum, t) => sum + t.ratedPower, 0),
    [turbines]
  );

  const layoutArea = useMemo(() => {
    if (turbines.length < 2) return 0;
    const xs = turbines.map((t) => t.x);
    const ys = turbines.map((t) => t.y);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  }, [turbines]);

  // ── Demo data loader ──
  const loadDemoData = useCallback(() => {
    setProject(DEMO_PROJECT);
    setTurbines(createDemoTurbines());
    setElevation(150);
    setTerrainType('flat');
    setHillLength(1000);
    setHillAspect(0.5);
    setZ0(0.03);
    setLandCover('grassland');
    setWeibullA(9.5);
    setWeibullK(2.2);
    setRefHeight(100);
    setStabilityType('neutral');
    setObukhovLength(10000);
    setWindRoseFreqs([0.09, 0.07, 0.06, 0.05, 0.04, 0.04, 0.04, 0.04, 0.05, 0.07, 0.08, 0.10]);
    setProfileLaw('log');
    setPowerAlpha(0.14);
    setFlowResults(null);
    setFlowProfileData(null);
    setWakeDir(210);
    setWakeSpeed(9.0);
    setSuperMethod('RSS');
    setWakeDecay(0.075);
    setWakeResult(null);
    setAepWakeLoss(5);
    setAepElecLoss(2);
    setAepAvailLoss(3);
    setAepEnvLoss(1);
    setAepResult(null);
    setUncertaintyResult(null);
    setWaterfallSteps(null);
    setMonthlyData(null);
  }, []);

  // ── Turbine CRUD helpers ──
  const addTurbine = useCallback(() => {
    const id = `T${String(turbines.length + 1).padStart(2, '0')}`;
    setTurbines((prev) => [
      ...prev,
      {
        id,
        name: `WTG-${id}`,
        x: 0,
        y: 0,
        hubHeight: 100,
        rotorDiameter: 100,
        ratedPower: 3000,
        ratedSpeed: 12,
        cutIn: 3,
        cutOut: 25,
      },
    ]);
  }, [turbines.length]);

  const removeTurbine = useCallback((idx: number) => {
    setTurbines((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateTurbine = useCallback((idx: number, field: keyof TurbineRow, value: string | number) => {
    setTurbines((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t))
    );
  }, []);

  const addSampleLayout = useCallback(() => {
    setTurbines(createDemoTurbines());
  }, []);

  // ── Calculate Wind Atlas (Tab 2) ──
  const calcWindAtlas = useCallback(() => {
    const climate = {
      z: refHeight,
      z0,
      A: weibullA,
      k: weibullK,
      sectors: windRoseFreqs.length,
      freq: windRoseFreqs,
    };
    const atlas = reverseWindAtlas(climate);
    // Extract updated frequencies
    setWindRoseFreqs(atlas.sectors.map((s) => s.sectorFreq));
  }, [refHeight, z0, weibullA, weibullK, windRoseFreqs]);

  // ── Calculate Flow Model (Tab 3) ──
  const calcFlowModel = useCallback(() => {
    if (turbines.length === 0) return;

    const results: FlowResult[] = [];
    const profileData: { heights: number[]; speeds: number[] }[] = [];

    const uStar = frictionVelocity(weibullA, refHeight, z0);
    const stability: StabilityParams = {
      z0,
      L: stabilityType === 'neutral' ? 99999 : obukhovLength,
      type: stabilityType as 'stable' | 'neutral' | 'unstable',
    };

    // Build a flat terrain profile for Jackson-Hunt
    const terrainProfile = {
      distance: [0, 500, 1000, 1500, 2000],
      elevation: [elevation, elevation, elevation, elevation, elevation],
    };

    for (const t of turbines) {
      let windSpeed: number;
      if (profileLaw === 'log') {
        windSpeed = stabilityCorrectedProfile(t.hubHeight, z0, uStar, stability);
      } else {
        windSpeed = powerLawWindProfile(t.hubHeight, refHeight, weibullA, powerAlpha);
      }

      const speedup = jacksonHuntSpeedup(terrainProfile, t.x, t.hubHeight, hillLength);
      const effectiveSpeed = windSpeed * (1 + speedup);
      const ti = turbulenceIntensity(uStar, effectiveSpeed, t.hubHeight, z0, stability.type);
      const deflection = flowDeflectionAngle(hillAspect, speedup);

      results.push({
        turbineId: t.id,
        turbineName: t.name,
        windSpeed: effectiveSpeed,
        speedupFactor: speedup,
        turbulenceIntensity: ti,
        deflectionAngle: deflection,
      });

      // Wind speed profile at this turbine
      const heights = HEIGHT_LEVELS;
      const speeds = heights.map((z) => {
        let s: number;
        if (profileLaw === 'log') {
          s = stabilityCorrectedProfile(z, z0, uStar, stability);
        } else {
          s = powerLawWindProfile(z, refHeight, weibullA, powerAlpha);
        }
        return s * (1 + speedup);
      });

      profileData.push({ heights, speeds });
    }

    setFlowResults(results);
    setFlowProfileData(profileData);
  }, [turbines, profileLaw, powerAlpha, weibullA, weibullK, refHeight, z0, elevation, hillLength, hillAspect, stabilityType, obukhovLength]);

  // ── Calculate Wake Analysis (Tab 4) ──
  const calcWakeAnalysis = useCallback(() => {
    if (turbines.length === 0) return;

    const tDefs: Turbine[] = turbines.map((t) => ({
      id: t.id,
      name: t.name,
      x: t.x,
      y: t.y,
      hubHeight: t.hubHeight,
      rotorDiameter: t.rotorDiameter,
      ratedPower: t.ratedPower,
      ratedSpeed: t.ratedSpeed,
      cutInSpeed: t.cutIn,
      cutOutSpeed: t.cutOut,
    }));

    const result = calculateWindFarmWakes(tDefs, wakeSpeed, wakeDir, superMethod);
    setWakeResult(result);
  }, [turbines, wakeSpeed, wakeDir, superMethod]);

  // ── Calculate AEP (Tab 5) ──
  const calcAEP = useCallback(() => {
    if (turbines.length === 0) return;

    const t = turbines[0];
    const powerCurve = getDefaultPowerCurve(
      t.ratedPower,
      t.cutIn,
      t.ratedSpeed,
      t.cutOut
    );

    const totalRated = turbines.reduce((s, tb) => s + tb.ratedPower, 0);

    const result = calculateAEP(weibullA, weibullK, powerCurve, totalRated, {
      wake: aepWakeLoss / 100,
      electrical: aepElecLoss / 100,
      availability: aepAvailLoss / 100,
      environmental: aepEnvLoss / 100,
    });

    setAepResult(result);

    const uncSources = uncertaintySources.map((s) => ({
      name: s.name,
      value: s.value / 100,
    }));
    const unc = calculateUncertainty(result.netAEP, uncSources);
    setUncertaintyResult(unc);

    const wf = aepWaterfall(result.grossAEP, {
      wake: aepWakeLoss / 100,
      electrical: aepElecLoss / 100,
      availability: aepAvailLoss / 100,
      environmental: aepEnvLoss / 100,
    });
    setWaterfallSteps(wf);

    const md = monthlyEnergyDistribution(result.netAEP);
    setMonthlyData(md);
  }, [turbines, weibullA, weibullK, aepWakeLoss, aepElecLoss, aepAvailLoss, aepEnvLoss, uncertaintySources]);

  // ── Helper ──
  const numFmt = (v: number, decimals: number = 2) => {
    if (!isFinite(v)) return '—';
    return v.toFixed(decimals);
  };

  // ======================================================================
  // RENDER
  // ======================================================================

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-slate-800 text-white px-6 py-4 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-500 rounded-lg flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Wind Flow Model</h1>
              <p className="text-xs text-slate-400">WASP-style wind resource assessment tool</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {project.projectName && (
              <span className="text-sm text-slate-300 hidden sm:inline">
                {project.projectName}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white"
              onClick={loadDemoData}
            >
              Load Demo Data
            </Button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="border-b border-slate-200 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto py-2">
            {[
              { id: 'setup', label: 'Project Setup', icon: '⚙' },
              { id: 'terrain', label: 'Terrain & Climate', icon: '🏔' },
              { id: 'flow', label: 'Flow Model', icon: '💨' },
              { id: 'wake', label: 'Wake Analysis', icon: '🔄' },
              { id: 'energy', label: 'Energy Yield', icon: '⚡' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                <span className="text-base">{tab.icon}</span>
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {/* ============================================================ */}
        {/* TAB 1: Project Setup                                          */}
        {/* ============================================================ */}
        {activeTab === 'setup' && (
          <div className="space-y-6">
            {/* Project Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-slate-800">Project Information</CardTitle>
                <CardDescription>Basic project details and location</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="proj-name" className="text-slate-600">Project Name</Label>
                    <Input
                      id="proj-name"
                      value={project.projectName}
                      onChange={(e) => setProject((p) => ({ ...p, projectName: e.target.value }))}
                      placeholder="Enter project name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="proj-lat" className="text-slate-600">Latitude</Label>
                    <Input
                      id="proj-lat"
                      type="number"
                      value={project.lat}
                      onChange={(e) => setProject((p) => ({ ...p, lat: parseFloat(e.target.value) || 0 }))}
                      placeholder="e.g. 51.15"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="proj-lon" className="text-slate-600">Longitude</Label>
                    <Input
                      id="proj-lon"
                      type="number"
                      value={project.lon}
                      onChange={(e) => setProject((p) => ({ ...p, lon: parseFloat(e.target.value) || 0 }))}
                      placeholder="e.g. -0.85"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="proj-desc" className="text-slate-600">Description</Label>
                    <Input
                      id="proj-desc"
                      value={project.description}
                      onChange={(e) => setProject((p) => ({ ...p, description: e.target.value }))}
                      placeholder="Project description"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Turbine Layout */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-slate-800">Turbine Layout</CardTitle>
                    <CardDescription>Define turbine positions and specifications</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={addSampleLayout}>
                      Add Sample Layout (3×3)
                    </Button>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={addTurbine}>
                      + Add Turbine
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {turbines.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <p className="text-lg mb-2">No turbines defined</p>
                    <p className="text-sm">Click &quot;Add Turbine&quot; or &quot;Add Sample Layout&quot; to get started.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-lg border border-slate-200">
                    <Table>
                      <TableHeader className="bg-slate-50 sticky top-0">
                        <TableRow>
                          <TableHead className="text-slate-600">Name</TableHead>
                          <TableHead className="text-slate-600">X (m)</TableHead>
                          <TableHead className="text-slate-600">Y (m)</TableHead>
                          <TableHead className="text-slate-600">Hub H (m)</TableHead>
                          <TableHead className="text-slate-600">Rotor D (m)</TableHead>
                          <TableHead className="text-slate-600">Power (kW)</TableHead>
                          <TableHead className="text-slate-600">Rated (m/s)</TableHead>
                          <TableHead className="text-slate-600">Cut-in</TableHead>
                          <TableHead className="text-slate-600">Cut-out</TableHead>
                          <TableHead className="text-slate-600 w-16"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {turbines.map((t, idx) => (
                          <TableRow key={t.id}>
                            <TableCell>
                              <Input
                                className="h-8 w-24"
                                value={t.name}
                                onChange={(e) => updateTurbine(idx, 'name', e.target.value)}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 w-20"
                                type="number"
                                value={t.x}
                                onChange={(e) => updateTurbine(idx, 'x', parseFloat(e.target.value) || 0)}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 w-20"
                                type="number"
                                value={t.y}
                                onChange={(e) => updateTurbine(idx, 'y', parseFloat(e.target.value) || 0)}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 w-20"
                                type="number"
                                value={t.hubHeight}
                                onChange={(e) => updateTurbine(idx, 'hubHeight', parseFloat(e.target.value) || 0)}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 w-20"
                                type="number"
                                value={t.rotorDiameter}
                                onChange={(e) => updateTurbine(idx, 'rotorDiameter', parseFloat(e.target.value) || 0)}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 w-24"
                                type="number"
                                value={t.ratedPower}
                                onChange={(e) => updateTurbine(idx, 'ratedPower', parseFloat(e.target.value) || 0)}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 w-16"
                                type="number"
                                value={t.ratedSpeed}
                                onChange={(e) => updateTurbine(idx, 'ratedSpeed', parseFloat(e.target.value) || 0)}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 w-16"
                                type="number"
                                value={t.cutIn}
                                onChange={(e) => updateTurbine(idx, 'cutIn', parseFloat(e.target.value) || 0)}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 w-16"
                                type="number"
                                value={t.cutOut}
                                onChange={(e) => updateTurbine(idx, 'cutOut', parseFloat(e.target.value) || 0)}
                              />
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() => removeTurbine(idx)}
                              >
                                ✕
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Summary Cards */}
            {turbines.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="border-emerald-200">
                  <CardContent className="pt-0">
                    <p className="text-sm text-slate-500 mb-1">Number of Turbines</p>
                    <p className="text-2xl font-bold text-emerald-700">{turbines.length}</p>
                  </CardContent>
                </Card>
                <Card className="border-emerald-200">
                  <CardContent className="pt-0">
                    <p className="text-sm text-slate-500 mb-1">Total Capacity</p>
                    <p className="text-2xl font-bold text-emerald-700">
                      {totalCapacity >= 1000
                        ? `${(totalCapacity / 1000).toFixed(1)} MW`
                        : `${totalCapacity} kW`}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-emerald-200">
                  <CardContent className="pt-0">
                    <p className="text-sm text-slate-500 mb-1">Layout Area</p>
                    <p className="text-2xl font-bold text-emerald-700">
                      {layoutArea > 0 ? `${(layoutArea / 1e6).toFixed(2)} km²` : '—'}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 2: Terrain & Climate                                      */}
        {/* ============================================================ */}
        {activeTab === 'terrain' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Terrain Parameters */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-slate-800">Terrain Parameters</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-slate-600">Elevation (m a.s.l.)</Label>
                        <Input
                          type="number"
                          value={elevation}
                          onChange={(e) => setElevation(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-600">Hill Length L (m)</Label>
                        <Input
                          type="number"
                          value={hillLength}
                          onChange={(e) => setHillLength(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-slate-600">Terrain Type</Label>
                        <Select value={terrainType} onValueChange={(v) => setTerrainType(v)}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="flat">Flat</SelectItem>
                            <SelectItem value="rolling">Rolling</SelectItem>
                            <SelectItem value="complex">Complex</SelectItem>
                            <SelectItem value="mountainous">Mountainous</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-600">Hill Aspect Ratio</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={hillAspect}
                          onChange={(e) => setHillAspect(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Surface Roughness */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-slate-800">Surface Roughness</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-slate-600">z₀ (m)</Label>
                        <Input
                          type="number"
                          step="0.001"
                          value={z0}
                          onChange={(e) => setZ0(parseFloat(e.target.value) || 0.03)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-600">Land Cover</Label>
                        <Select value={landCover} onValueChange={(v) => {
                          setLandCover(v);
                          setZ0(LAND_COVER_ROUGHNESS[v] || 0.03);
                        }}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LAND_COVER_OPTIONS.map((lc) => (
                              <SelectItem key={lc} value={lc}>
                                {lc.replace(/_/g, ' ')} (z₀ = {LAND_COVER_ROUGHNESS[lc]})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-sm">
                      <p className="text-slate-500">Classification: <span className="font-medium text-slate-700">{roughnessInfo.name}</span></p>
                      <p className="text-slate-500">WASP Class: <span className="font-medium text-slate-700">{roughnessInfo.class}</span></p>
                      <p className="text-slate-500">{roughnessInfo.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Climate Data */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-slate-800">Climate Data</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-slate-600">Weibull A (m/s)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={weibullA}
                          onChange={(e) => setWeibullA(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-600">Weibull k</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={weibullK}
                          onChange={(e) => setWeibullK(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-slate-600">Mean Wind Speed (m/s)</Label>
                        <div className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 flex items-center text-sm text-slate-700 font-medium">
                          {numFmt(meanWindSpeed, 2)}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-slate-600">Reference Height (m)</Label>
                        <Input
                          type="number"
                          value={refHeight}
                          onChange={(e) => setRefHeight(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Stability */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-slate-800">Atmospheric Stability</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-slate-600">Stability Class</Label>
                      <Select value={stabilityType} onValueChange={(v) => setStabilityType(v)}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stable">Stable (L &gt; 0)</SelectItem>
                          <SelectItem value="neutral">Neutral (L → ∞)</SelectItem>
                          <SelectItem value="unstable">Unstable (L &lt; 0)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {stabilityType !== 'neutral' && (
                      <div className="space-y-1.5">
                        <Label className="text-slate-600">
                          Obukhov Length L (m) {stabilityType === 'stable' ? '(positive)' : '(negative)'}
                        </Label>
                        <Input
                          type="number"
                          value={obukhovLength}
                          onChange={(e) => setObukhovLength(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    )}
                    <div className="bg-slate-50 rounded-lg p-3 text-sm">
                      <p className="text-slate-500">
                        {stabilityType === 'stable' && 'Stable conditions suppress vertical mixing and reduce turbulence. Common at night with clear skies.'}
                        {stabilityType === 'neutral' && 'Neutral conditions assume well-mixed boundary layer. Standard assumption for energy yield calculations.'}
                        {stabilityType === 'unstable' && 'Unstable (convective) conditions enhance vertical mixing and increase turbulence. Common during sunny daytime.'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Wind Rose */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-slate-800">Wind Rose</CardTitle>
                      <CardDescription>12-sector directional frequency distribution</CardDescription>
                    </div>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={calcWindAtlas}>
                      Calculate Wind Atlas
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col items-center gap-6">
                    <WindRose frequencies={windRoseFreqs} />
                    <div className="grid grid-cols-6 sm:grid-cols-12 gap-2 w-full">
                      {['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW'].map(
                        (label, i) => (
                          <div key={i} className="text-center">
                            <Label className="text-xs text-slate-500 block mb-1">{label}</Label>
                            <Input
                              className="h-8 text-center text-xs"
                              type="number"
                              step="0.01"
                              value={windRoseFreqs[i] || 0}
                              onChange={(e) => {
                                const newFreqs = [...windRoseFreqs];
                                newFreqs[i] = parseFloat(e.target.value) || 0;
                                setWindRoseFreqs(newFreqs);
                              }}
                            />
                          </div>
                        )
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      Total: {windRoseFreqs.reduce((a, b) => a + b, 0).toFixed(3)} (should be 1.000)
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Quick Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-slate-800">Site Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-500">Location</span>
                      <span className="text-slate-800 font-medium">{project.projectName || 'Not set'}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-500">Coordinates</span>
                      <span className="text-slate-800 font-medium">{project.lat.toFixed(2)}°, {project.lon.toFixed(2)}°</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-500">Elevation</span>
                      <span className="text-slate-800 font-medium">{elevation} m a.s.l.</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-500">Terrain</span>
                      <span className="text-slate-800 font-medium capitalize">{terrainType}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-500">Roughness z₀</span>
                      <span className="text-slate-800 font-medium">{z0} m ({roughnessInfo.name})</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-500">Mean Wind Speed</span>
                      <span className="text-slate-800 font-medium">{numFmt(meanWindSpeed)} m/s</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-500">Weibull (A, k)</span>
                      <span className="text-slate-800 font-medium">{weibullA}, {weibullK}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-500">Stability</span>
                      <span className="text-slate-800 font-medium capitalize">{stabilityType}</span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-slate-500">Turbines</span>
                      <span className="text-slate-800 font-medium">{turbines.length} ({(totalCapacity / 1000).toFixed(1)} MW)</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 3: Flow Model                                             */}
        {/* ============================================================ */}
        {activeTab === 'flow' && (
          <div className="space-y-6">
            {/* Configuration */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-slate-800">Project Settings</CardTitle>
                  <CardDescription>Current configuration summary</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Turbines</span>
                      <span className="text-slate-800 font-medium">{turbines.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Roughness z₀</span>
                      <span className="text-slate-800 font-medium">{z0} m</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Weibull (A, k)</span>
                      <span className="text-slate-800 font-medium">{weibullA}, {weibullK}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Mean Wind Speed</span>
                      <span className="text-slate-800 font-medium">{numFmt(meanWindSpeed)} m/s</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Terrain</span>
                      <span className="text-slate-800 font-medium capitalize">{terrainType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Stability</span>
                      <span className="text-slate-800 font-medium capitalize">{stabilityType}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-slate-800">Model Configuration</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-slate-600">Profile Law</Label>
                      <RadioGroup
                        value={profileLaw}
                        onValueChange={(v) => setProfileLaw(v as 'log' | 'power')}
                        className="flex gap-6"
                      >
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="log" id="profile-log" />
                          <Label htmlFor="profile-log" className="font-normal cursor-pointer">Log-law</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="power" id="profile-power" />
                          <Label htmlFor="profile-power" className="font-normal cursor-pointer">Power-law</Label>
                        </div>
                      </RadioGroup>
                    </div>
                    {profileLaw === 'power' && (
                      <div className="space-y-1.5">
                        <Label className="text-slate-600">Power-law exponent α</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={powerAlpha}
                          onChange={(e) => setPowerAlpha(parseFloat(e.target.value) || 0.14)}
                        />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-slate-600">Height Levels</Label>
                      <div className="flex flex-wrap gap-2">
                        {HEIGHT_LEVELS.map((h) => (
                          <span
                            key={h}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
                          >
                            {h}m
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                      onClick={calcFlowModel}
                      disabled={turbines.length === 0}
                    >
                      Calculate Flow Model
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Results */}
            {flowResults && (
              <>
                {/* Wind Speed at Hub Height */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-slate-800">Wind Speed at Hub Height</CardTitle>
                    <CardDescription>Per-turbine flow model results</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <Table>
                        <TableHeader className="bg-slate-50">
                          <TableRow>
                            <TableHead className="text-slate-600">Turbine</TableHead>
                            <TableHead className="text-slate-600">Wind Speed (m/s)</TableHead>
                            <TableHead className="text-slate-600">Speed-up Factor</TableHead>
                            <TableHead className="text-slate-600">Turbulence Intensity (%)</TableHead>
                            <TableHead className="text-slate-600">Deflection (°)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {flowResults.map((r) => (
                            <TableRow key={r.turbineId}>
                              <TableCell className="font-medium text-slate-800">{r.turbineName}</TableCell>
                              <TableCell>{numFmt(r.windSpeed)}</TableCell>
                              <TableCell>{numFmt(r.speedupFactor, 4)}</TableCell>
                              <TableCell>{numFmt(r.turbulenceIntensity * 100, 1)}</TableCell>
                              <TableCell>{numFmt(r.deflectionAngle, 2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Wind Speed Profile Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-slate-800">Wind Speed Profile</CardTitle>
                    <CardDescription>Wind speeds at standard height levels</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-slate-50">
                          <TableRow>
                            <TableHead className="text-slate-600">Height (m)</TableHead>
                            {flowResults.map((r) => (
                              <TableHead key={r.turbineId} className="text-slate-600">{r.turbineName}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {HEIGHT_LEVELS.map((h, hi) => (
                            <TableRow key={h}>
                              <TableCell className="font-medium text-slate-800">{h}m</TableCell>
                              {flowProfileData?.map((p, pi) => (
                                <TableCell key={pi}>{numFmt(p.speeds[hi])}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {/* Simple bar chart visualization */}
                    <div className="mt-6">
                      <p className="text-sm font-medium text-slate-600 mb-3">Wind Speed Profile Visualization</p>
                      <div className="space-y-3">
                        {HEIGHT_LEVELS.map((h, hi) => {
                          const speeds = flowProfileData?.map((p) => p.speeds[hi]) || [];
                          const maxSpeed = Math.max(...speeds, 0.1);
                          return (
                            <div key={h} className="flex items-center gap-3">
                              <span className="w-16 text-xs text-slate-500 text-right">{h}m</span>
                              <div className="flex-1 flex gap-1">
                                {speeds.map((s, si) => (
                                  <div
                                    key={si}
                                    className="h-5 rounded-sm bg-emerald-400 hover:bg-emerald-500 transition-colors"
                                    style={{ width: `${(s / maxSpeed) * 100}%`, minWidth: s > 0 ? 4 : 0 }}
                                    title={`${flowResults[si]?.turbineName}: ${numFmt(s)} m/s`}
                                  />
                                ))}
                              </div>
                              <span className="w-14 text-xs text-slate-500">
                                {speeds.length > 0 ? numFmt(speeds[0]) : '0'} m/s
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex gap-3 mt-3 flex-wrap">
                        {flowResults.map((r, i) => (
                          <div key={i} className="flex items-center gap-1">
                            <div className="w-3 h-3 rounded-sm bg-emerald-400" />
                            <span className="text-xs text-slate-500">{r.turbineName}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 4: Wake Analysis                                          */}
        {/* ============================================================ */}
        {activeTab === 'wake' && (
          <div className="space-y-6">
            {/* Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="text-slate-800">Wake Analysis Configuration</CardTitle>
                <CardDescription>Set wind conditions and model parameters</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-slate-600">Wind Direction (°)</Label>
                    <Input
                      type="number"
                      value={wakeDir}
                      onChange={(e) => setWakeDir(parseFloat(e.target.value) || 0)}
                    />
                    <p className="text-xs text-slate-400">Meteorological convention (from)</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-600">Wind Speed (m/s)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      value={wakeSpeed}
                      onChange={(e) => setWakeSpeed(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-600">Superposition Method</Label>
                    <RadioGroup
                      value={superMethod}
                      onValueChange={(v) => setSuperMethod(v as SuperpositionMethod)}
                      className="flex gap-4 mt-2"
                    >
                      {(['RSS', 'SUM', 'MAX'] as const).map((m) => (
                        <div key={m} className="flex items-center gap-1.5">
                          <RadioGroupItem value={m} id={`method-${m}`} />
                          <Label htmlFor={`method-${m}`} className="text-sm font-normal cursor-pointer">{m}</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-600">Wake Decay Constant</Label>
                    <Input
                      type="number"
                      step="0.005"
                      value={wakeDecay}
                      onChange={(e) => setWakeDecay(parseFloat(e.target.value) || 0.075)}
                    />
                  </div>
                </div>
                <Button
                  className="mt-4 bg-emerald-600 hover:bg-emerald-700"
                  onClick={calcWakeAnalysis}
                  disabled={turbines.length === 0}
                >
                  Analyze Wake Effects
                </Button>
              </CardContent>
            </Card>

            {/* Results */}
            {wakeResult && (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card className="border-emerald-200">
                    <CardContent className="pt-0">
                      <p className="text-sm text-slate-500 mb-1">Farm Efficiency</p>
                      <p className="text-2xl font-bold text-emerald-700">
                        {(wakeResult.farmEfficiency * 100).toFixed(1)}%
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-red-200">
                    <CardContent className="pt-0">
                      <p className="text-sm text-slate-500 mb-1">Total Wake Loss</p>
                      <p className="text-2xl font-bold text-red-600">
                        {wakeResult.wakeLossPercent.toFixed(1)}%
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-blue-200">
                    <CardContent className="pt-0">
                      <p className="text-sm text-slate-500 mb-1">Wind Direction</p>
                      <p className="text-2xl font-bold text-blue-700">
                        {wakeResult.windDirection}° (Sector {wakeResult.sector})
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Results Table */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-slate-800">Per-Turbine Wake Results</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-96 overflow-y-auto">
                      <Table>
                        <TableHeader className="bg-slate-50 sticky top-0">
                          <TableRow>
                            <TableHead className="text-slate-600">Turbine</TableHead>
                            <TableHead className="text-slate-600">Free Stream (m/s)</TableHead>
                            <TableHead className="text-slate-600">Effective (m/s)</TableHead>
                            <TableHead className="text-slate-600">Deficit (%)</TableHead>
                            <TableHead className="text-slate-600">Power (kW)</TableHead>
                            <TableHead className="text-slate-600">Capacity Factor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {wakeResult.results.map((r) => {
                            const t = turbines.find((tb) => tb.id === r.turbineId);
                            return (
                              <TableRow key={r.turbineId}>
                                <TableCell className="font-medium text-slate-800">{t?.name || r.turbineId}</TableCell>
                                <TableCell>{numFmt(r.freeStreamSpeed)}</TableCell>
                                <TableCell>{numFmt(r.effectiveSpeed)}</TableCell>
                                <TableCell>{numFmt(r.totalDeficit * 100, 1)}</TableCell>
                                <TableCell>{numFmt(r.powerOutput, 0)}</TableCell>
                                <TableCell>{numFmt(r.capacityFactor * 100, 1)}%</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Wake Map */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-slate-800">Wake Visualization</CardTitle>
                    <CardDescription>Top-down view of turbine layout with wake cones</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <WakeMap turbines={turbines} windDirection={wakeDir} />
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 5: Energy Yield                                           */}
        {/* ============================================================ */}
        {activeTab === 'energy' && (
          <div className="space-y-6">
            {/* Power Curve & Losses */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-slate-800">Power Curve Settings</CardTitle>
                  <CardDescription>Default power curve parameters (per turbine)</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-slate-600">Rated Power (kW)</Label>
                      <Input
                        type="number"
                        value={turbines.length > 0 ? turbines[0].ratedPower : 3000}
                        disabled
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-600">Cut-in Speed (m/s)</Label>
                      <Input
                        type="number"
                        value={turbines.length > 0 ? turbines[0].cutIn : 3}
                        disabled
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-600">Rated Speed (m/s)</Label>
                      <Input
                        type="number"
                        value={turbines.length > 0 ? turbines[0].ratedSpeed : 12}
                        disabled
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-600">Cut-out Speed (m/s)</Label>
                      <Input
                        type="number"
                        value={turbines.length > 0 ? turbines[0].cutOut : 25}
                        disabled
                    />
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-3">
                    Power curve parameters are derived from the first turbine definition.
                    Edit turbine specs in Project Setup.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-slate-800">Loss Settings</CardTitle>
                  <CardDescription>Percentage losses applied to gross AEP</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-slate-600">Wake Loss (%)</Label>
                      <Input
                        type="number"
                        value={aepWakeLoss}
                        onChange={(e) => setAepWakeLoss(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-600">Electrical Loss (%)</Label>
                      <Input
                        type="number"
                        value={aepElecLoss}
                        onChange={(e) => setAepElecLoss(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-600">Availability Loss (%)</Label>
                      <Input
                        type="number"
                        value={aepAvailLoss}
                        onChange={(e) => setAepAvailLoss(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-slate-600">Environmental / Curtailment (%)</Label>
                      <Input
                        type="number"
                        value={aepEnvLoss}
                        onChange={(e) => setAepEnvLoss(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 mt-4 text-sm">
                    <span className="text-slate-500">Total Combined Loss: </span>
                    <span className="font-medium text-red-600">
                      {(100 * (1 - (1 - aepWakeLoss / 100) * (1 - aepElecLoss / 100) * (1 - aepAvailLoss / 100) * (1 - aepEnvLoss / 100))).toFixed(1)}%
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Uncertainty Sources */}
            <Card>
              <CardHeader>
                <CardTitle className="text-slate-800">Uncertainty Sources</CardTitle>
                <CardDescription>Individual uncertainty contributions (RSS combined)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="text-slate-600">Source</TableHead>
                        <TableHead className="text-slate-600">Uncertainty (%)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {uncertaintySources.map((s, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium text-slate-800">{s.name}</TableCell>
                          <TableCell>
                            <Input
                              className="h-8 w-24"
                              type="number"
                              step="0.5"
                              value={s.value}
                              onChange={(e) => {
                                const newSources = [...uncertaintySources];
                                newSources[i] = { ...newSources[i], value: parseFloat(e.target.value) || 0 };
                                setUncertaintySources(newSources);
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Calculate Button */}
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-base py-3"
              onClick={calcAEP}
              disabled={turbines.length === 0}
            >
              Calculate Annual Energy Production (AEP)
            </Button>

            {/* Results */}
            {aepResult && (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                  <Card className="border-emerald-200">
                    <CardContent className="pt-0">
                      <p className="text-xs text-slate-500 mb-1">Gross AEP</p>
                      <p className="text-lg font-bold text-slate-800">
                        {aepResult.grossAEP >= 1000
                          ? `${(aepResult.grossAEP / 1000).toFixed(2)} GWh`
                          : `${aepResult.grossAEP.toFixed(0)} MWh`}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-emerald-200">
                    <CardContent className="pt-0">
                      <p className="text-xs text-slate-500 mb-1">Net AEP</p>
                      <p className="text-lg font-bold text-emerald-700">
                        {aepResult.netAEP >= 1000
                          ? `${(aepResult.netAEP / 1000).toFixed(2)} GWh`
                          : `${aepResult.netAEP.toFixed(0)} MWh`}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-blue-200">
                    <CardContent className="pt-0">
                      <p className="text-xs text-slate-500 mb-1">Capacity Factor</p>
                      <p className="text-lg font-bold text-blue-700">
                        {(aepResult.capacityFactor * 100).toFixed(1)}%
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-blue-200">
                    <CardContent className="pt-0">
                      <p className="text-xs text-slate-500 mb-1">Full Load Hours</p>
                      <p className="text-lg font-bold text-blue-700">
                        {aepResult.fullLoadHours.toFixed(0)} h
                      </p>
                    </CardContent>
                  </Card>
                  {uncertaintyResult && (
                    <>
                      <Card className="border-amber-200">
                        <CardContent className="pt-0">
                          <p className="text-xs text-slate-500 mb-1">P90 AEP</p>
                          <p className="text-lg font-bold text-amber-700">
                            {uncertaintyResult.p90AEP >= 1000
                              ? `${(uncertaintyResult.p90AEP / 1000).toFixed(2)} GWh`
                              : `${uncertaintyResult.p90AEP.toFixed(0)} MWh`}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="border-amber-200">
                        <CardContent className="pt-0">
                          <p className="text-xs text-slate-500 mb-1">P75 AEP</p>
                          <p className="text-lg font-bold text-amber-700">
                            {uncertaintyResult.p75AEP >= 1000
                              ? `${(uncertaintyResult.p75AEP / 1000).toFixed(2)} GWh`
                              : `${uncertaintyResult.p75AEP.toFixed(0)} MWh`}
                          </p>
                        </CardContent>
                      </Card>
                    </>
                  )}
                </div>

                {/* Uncertainty Breakdown */}
                {uncertaintyResult && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-slate-800">Uncertainty Analysis</CardTitle>
                      <CardDescription>
                        Total combined uncertainty: <span className="font-bold text-slate-700">{uncertaintyResult.totalUncertainty.toFixed(1)}%</span>
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <Table>
                          <TableHeader className="bg-slate-50">
                            <TableRow>
                              <TableHead className="text-slate-600">Source</TableHead>
                              <TableHead className="text-slate-600">Value (%)</TableHead>
                              <TableHead className="text-slate-600">Contribution</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {uncertaintyResult.sources.map((s, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium text-slate-800">{s.name}</TableCell>
                                <TableCell>{(s.value * 100).toFixed(1)}%</TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="h-2 rounded-full bg-amber-400"
                                      style={{ width: `${s.contribution * 100}%`, minWidth: 4 }}
                                    />
                                    <span className="text-xs text-slate-500">{(s.contribution * 100).toFixed(1)}%</span>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* AEP Waterfall */}
                {waterfallSteps && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-slate-800">AEP Waterfall</CardTitle>
                      <CardDescription>Loss breakdown from gross to net AEP</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <AEPWaterfallChart steps={waterfallSteps} />
                    </CardContent>
                  </Card>
                )}

                {/* Monthly Production */}
                {monthlyData && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-slate-800">Monthly Energy Production</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <Table>
                          <TableHeader className="bg-slate-50">
                            <TableRow>
                              <TableHead className="text-slate-600">Month</TableHead>
                              <TableHead className="text-slate-600">Energy (MWh)</TableHead>
                              <TableHead className="text-slate-600">Energy (GWh)</TableHead>
                              <TableHead className="text-slate-600">Share (%)</TableHead>
                              <TableHead className="text-slate-600">Distribution</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {monthlyData.map((m, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium text-slate-800">{m.month}</TableCell>
                                <TableCell>{m.mwh.toFixed(1)}</TableCell>
                                <TableCell>{m.gwh.toFixed(4)}</TableCell>
                                <TableCell>{(m.percentage * 100).toFixed(1)}%</TableCell>
                                <TableCell>
                                  <div
                                    className="h-3 rounded-full bg-emerald-400"
                                    style={{ width: `${Math.max(m.percentage * 100 * 1.5, 2)}%`, minWidth: 4 }}
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Per-Turbine AEP */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-slate-800">Per-Turbine AEP Estimate</CardTitle>
                    <CardDescription>Assumes uniform wind conditions across all turbines</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-96 overflow-y-auto">
                      <Table>
                        <TableHeader className="bg-slate-50 sticky top-0">
                          <TableRow>
                            <TableHead className="text-slate-600">Turbine</TableHead>
                            <TableHead className="text-slate-600">Rated Power (kW)</TableHead>
                            <TableHead className="text-slate-600">Hub Height (m)</TableHead>
                            <TableHead className="text-slate-600">Est. AEP (MWh)</TableHead>
                            <TableHead className="text-slate-600">Capacity Factor</TableHead>
                            <TableHead className="text-slate-600">Full Load Hours</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {turbines.map((t) => {
                            const pc = getDefaultPowerCurve(t.ratedPower, t.cutIn, t.ratedSpeed, t.cutOut);
                            const result = calculateAEP(weibullA, weibullK, pc, t.ratedPower, {
                              wake: aepWakeLoss / 100,
                              electrical: aepElecLoss / 100,
                              availability: aepAvailLoss / 100,
                              environmental: aepEnvLoss / 100,
                            });
                            return (
                              <TableRow key={t.id}>
                                <TableCell className="font-medium text-slate-800">{t.name}</TableCell>
                                <TableCell>{t.ratedPower.toLocaleString()}</TableCell>
                                <TableCell>{t.hubHeight}</TableCell>
                                <TableCell>{result.netAEP.toFixed(0)}</TableCell>
                                <TableCell>{(result.capacityFactor * 100).toFixed(1)}%</TableCell>
                                <TableCell>{result.fullLoadHours.toFixed(0)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between text-xs text-slate-400">
          <span>Wind Flow Model — WASP-style Wind Resource Assessment Tool</span>
          <span>Powered by WindFlow Engine v1.0</span>
        </div>
      </footer>
    </div>
  );
}
