'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Settings,
  CloudSun,
  Fan,
  BarChart3,
  Percent,
  Trash2,
  Compass,
  AlertTriangle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Turbine {
  id: string;
  name: string;
  x: number;
  y: number;
  lat?: number;
  lng?: number;
  hubHeight: number;
  rotorDiameter: number;
  ratedPower: number;
  ratedSpeed: number;
  cutInSpeed: number;
  cutOutSpeed: number;
}

export interface ProjectSettings {
  name: string;
  hubHeight: number;
  weibullA: number;
  weibullK: number;
  roughness: number;
  terrainType: string;
  numSectors: number;
}

interface AnalysisResult {
  type: 'terrain' | 'wake' | 'aep' | null;
  data: any;
}

interface PropertiesPanelProps {
  selectedTurbine: Turbine | null;
  onTurbineUpdate: (id: string, updates: Partial<Turbine>) => void;
  projectSettings: ProjectSettings;
  onSettingsUpdate: (settings: Partial<ProjectSettings>) => void;
  results: AnalysisResult | null;
  visible: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(v: number | undefined | null, decimals = 2): string {
  if (v === undefined || v === null || isNaN(v)) return '—';
  return v.toFixed(decimals);
}

function fmtPct(v: number | undefined | null, decimals = 1): string {
  if (v === undefined || v === null || isNaN(v)) return '—';
  return `${v.toFixed(decimals)}%`;
}

/** Weibull mean = A * Γ(1 + 1/K). Approximation using gamma function. */
function weibullMean(a: number, k: number): number {
  // Stirling approximation for Gamma(1 + 1/k)
  const t = 1 + 1 / k;
  // Lanczos approximation
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (t + i - 1);
  const tt = t + g + 0.5;
  const gamma =
    Math.sqrt(2 * Math.PI) * Math.pow(tt, t - 0.5) * Math.exp(-tt) * x;
  return a * gamma;
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function Section({
  icon: Icon,
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  icon: React.ElementType;
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-800/50 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        )}
        <Icon className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex-1">
          {title}
        </span>
        {badge && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2.5">{children}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Input field (dark theme)
// ---------------------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-[11px] font-medium text-slate-400">{label}</label>
        {hint && (
          <span className="text-[10px] text-slate-600">{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

const inputCls =
  'w-full h-7 px-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors';

const selectCls =
  'w-full h-7 px-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors appearance-none cursor-pointer';

// ---------------------------------------------------------------------------
// Simple SVG power curve preview
// ---------------------------------------------------------------------------

function PowerCurvePreview({ turbine }: { turbine: Turbine }) {
  const bins = 25;
  const maxSpeed = turbine.cutOutSpeed || 25;
  const step = maxSpeed / bins;
  const ci = turbine.cutInSpeed ?? 3;
  const rs = turbine.ratedSpeed ?? 12;
  const rp = turbine.ratedPower ?? 2000;

  const bars = Array.from({ length: bins }, (_, i) => {
    const ws = (i + 0.5) * step;
    let power = 0;
    if (ws >= ci && ws <= rs) {
      power = rp * Math.pow((ws - ci) / (rs - ci), 3);
    } else if (ws > rs && ws <= maxSpeed) {
      power = rp;
    }
    return { ws, power };
  });

  const maxP = Math.max(...bars.map((b) => b.power), 1);

  const barW = 100 / bins;
  const chartH = 48;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-slate-400">
          Power Curve
        </span>
        <span className="text-[10px] text-slate-600">kW vs m/s</span>
      </div>
      <svg
        viewBox={`0 0 100 ${chartH}`}
        className="w-full bg-slate-800/50 rounded border border-slate-700/50"
        preserveAspectRatio="none"
      >
        {bars.map((b, i) => {
          const h = (b.power / maxP) * (chartH - 4);
          return (
            <rect
              key={i}
              x={i * barW}
              y={chartH - h}
              width={Math.max(barW - 0.5, 0.5)}
              height={h}
              fill={b.power > 0 ? '#10b981' : '#334155'}
              opacity={b.power > 0 ? 0.85 : 0.3}
              rx={0.3}
            />
          );
        })}
      </svg>
      <div className="flex justify-between mt-0.5">
        <span className="text-[9px] text-slate-600">0</span>
        <span className="text-[9px] text-slate-600">{maxSpeed} m/s</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results tables
// ---------------------------------------------------------------------------

function TerrainResults({ data }: { data: any }) {
  const turbines = data?.turbines ?? [];
  if (!turbines.length) {
    return <p className="text-xs text-slate-500 italic">No terrain data available.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 text-left">
            <th className="pb-1 pr-2 font-medium">Turbine</th>
            <th className="pb-1 pr-2 font-medium">WS (m/s)</th>
            <th className="pb-1 pr-2 font-medium">Speed-up</th>
            <th className="pb-1 font-medium">TI (%)</th>
          </tr>
        </thead>
        <tbody>
          {turbines.map((t: any, i: number) => (
            <tr
              key={t.id ?? i}
              className="border-t border-slate-800/50 even:bg-slate-800/30"
            >
              <td className="py-1 pr-2 text-slate-300">{t.name ?? `T${i + 1}`}</td>
              <td className="py-1 pr-2 text-slate-200">{fmt(t.windSpeed)}</td>
              <td className="py-1 pr-2 text-slate-200">{fmt(t.speedUp, 3)}</td>
              <td className="py-1 text-slate-200">{fmt(t.turbulenceIntensity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WakeResults({ data }: { data: any }) {
  const efficiency = data?.farmEfficiency;
  const turbines = data?.turbines ?? [];

  return (
    <div className="space-y-2">
      {efficiency !== undefined && (
        <div className="flex items-center gap-2 p-2 bg-slate-800/60 rounded border border-slate-700/50">
          <span className="text-[11px] text-slate-400">Farm Efficiency</span>
          <span className="text-sm font-bold text-emerald-400">
            {fmtPct(efficiency)}
          </span>
        </div>
      )}
      {turbines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="pb-1 pr-2 font-medium">Turbine</th>
                <th className="pb-1 pr-2 font-medium">Eff. WS</th>
                <th className="pb-1 pr-2 font-medium">Deficit</th>
                <th className="pb-1 font-medium">Power (kW)</th>
              </tr>
            </thead>
            <tbody>
              {turbines.map((t: any, i: number) => (
                <tr
                  key={t.id ?? i}
                  className="border-t border-slate-800/50 even:bg-slate-800/30"
                >
                  <td className="py-1 pr-2 text-slate-300">
                    {t.name ?? `T${i + 1}`}
                  </td>
                  <td className="py-1 pr-2 text-slate-200">
                    {fmt(t.effectiveWindSpeed)}
                  </td>
                  <td className="py-1 pr-2 text-slate-200">
                    {fmtPct(t.wakeDeficit)}
                  </td>
                  <td className="py-1 text-slate-200">{fmt(t.powerOutput, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AEPResults({ data }: { data: any }) {
  const summary = data?.summary;
  const turbines = data?.turbines ?? [];

  if (!summary && !turbines.length) {
    return <p className="text-xs text-slate-500 italic">No AEP data available.</p>;
  }

  return (
    <div className="space-y-2.5">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Gross AEP', value: `${(summary.grossAEP / 1e6).toFixed(2)} GWh` },
            { label: 'Net AEP', value: `${(summary.netAEP / 1e6).toFixed(2)} GWh` },
            { label: 'Capacity Factor', value: fmtPct(summary.capacityFactor) },
            { label: 'P90 AEP', value: `${(summary.p90AEP / 1e6).toFixed(2)} GWh` },
          ].map((card) => (
            <div
              key={card.label}
              className="bg-slate-800/60 rounded p-2 border border-slate-700/50"
            >
              <div className="text-[10px] text-slate-500 mb-0.5">{card.label}</div>
              <div className="text-sm font-semibold text-slate-100">{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Per-turbine table */}
      {turbines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="pb-1 pr-2 font-medium">Turbine</th>
                <th className="pb-1 pr-2 font-medium">Gross (MWh)</th>
                <th className="pb-1 pr-2 font-medium">Net (MWh)</th>
                <th className="pb-1 font-medium">CF (%)</th>
              </tr>
            </thead>
            <tbody>
              {turbines.map((t: any, i: number) => (
                <tr
                  key={t.id ?? i}
                  className="border-t border-slate-800/50 even:bg-slate-800/30"
                >
                  <td className="py-1 pr-2 text-slate-300">
                    {t.name ?? `T${i + 1}`}
                  </td>
                  <td className="py-1 pr-2 text-slate-200">
                    {fmt(t.grossAEP / 1e3, 0)}
                  </td>
                  <td className="py-1 pr-2 text-slate-200">
                    {fmt(t.netAEP / 1e3, 0)}
                  </td>
                  <td className="py-1 text-slate-200">
                    {fmtPct(t.capacityFactor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PropertiesPanel
// ---------------------------------------------------------------------------

export default function PropertiesPanel({
  selectedTurbine,
  onTurbineUpdate,
  projectSettings,
  onSettingsUpdate,
  results,
  visible,
}: PropertiesPanelProps) {
  // Local loss settings state
  const [losses, setLosses] = useState({
    wakeLoss: 0,
    electricalLoss: 2,
    availability: 3,
    curtailment: 1,
  });

  const [uncertaintySources, setUncertaintySources] = useState([
    { name: 'Wind measurement', value: 3.0 },
    { name: 'Wind variability', value: 5.5 },
    { name: 'Wake modelling', value: 2.0 },
    { name: 'Power curve', value: 1.5 },
  ]);

  // Climate data local state (derived from project settings)
  const [climateData, setClimateData] = useState({
    weibullA: projectSettings.weibullA,
    weibullK: projectSettings.weibullK,
    roughnessLength: projectSettings.roughness,
    referenceHeight: 100,
    powerLawAlpha: 0.14,
    stability: 'Neutral' as string,
  });

  // Computed mean wind speed
  const meanWindSpeed = useMemo(
    () => weibullMean(climateData.weibullA, climateData.weibullK),
    [climateData.weibullA, climateData.weibullK],
  );

  // Callbacks
  const updateSettings = useCallback(
    (patch: Partial<ProjectSettings>) => {
      onSettingsUpdate(patch);
    },
    [onSettingsUpdate],
  );

  const updateTurbine = useCallback(
    (updates: Partial<Turbine>) => {
      if (selectedTurbine) {
        onTurbineUpdate(selectedTurbine.id, updates);
      }
    },
    [selectedTurbine, onTurbineUpdate],
  );

  // ---- Render ----
  if (!visible) return null;

  return (
    <aside className="w-[340px] shrink-0 bg-[#0f172a] border-l border-slate-800 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 shrink-0">
        <Settings className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Properties
        </span>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* ── Section 1: Project Settings ────────────────────────── */}
        <Section icon={Settings} title="Project Settings" defaultOpen>
          <Field label="Project Name">
            <input
              type="text"
              className={inputCls}
              value={projectSettings.name}
              onChange={(e) => updateSettings({ name: e.target.value })}
            />
          </Field>

          <Field label="Hub Height" hint="global default">
            <input
              type="number"
              className={inputCls}
              value={projectSettings.hubHeight}
              min={10}
              max={300}
              step={10}
              onChange={(e) =>
                updateSettings({ hubHeight: Number(e.target.value) })
              }
            />
          </Field>

          <Field label="Number of Sectors">
            <select
              className={selectCls}
              value={projectSettings.numSectors}
              onChange={(e) =>
                updateSettings({ numSectors: Number(e.target.value) })
              }
            >
              {[8, 12, 16, 36].map((n) => (
                <option key={n} value={n}>
                  {n} sectors
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-center gap-1.5 pt-1">
            <Compass className="w-3 h-3 text-slate-600" />
            <span className="text-[10px] text-slate-500 font-medium">
              WGS 84 (Lat/Lon)
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              onSettingsUpdate({
                ...projectSettings,
                weibullA: climateData.weibullA,
                weibullK: climateData.weibullK,
                roughness: climateData.roughnessLength,
              });
            }}
            className="w-full h-7 text-xs font-medium rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors mt-1"
          >
            Apply Settings
          </button>
        </Section>

        {/* ── Section 2: Climate Data ───────────────────────────── */}
        <Section icon={CloudSun} title="Climate Data" defaultOpen>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Weibull A" hint="m/s">
              <input
                type="number"
                className={inputCls}
                value={climateData.weibullA}
                min={1}
                max={30}
                step={0.1}
                onChange={(e) =>
                  setClimateData((d) => ({
                    ...d,
                    weibullA: Number(e.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Weibull K">
              <input
                type="number"
                className={inputCls}
                value={climateData.weibullK}
                min={1}
                max={5}
                step={0.01}
                onChange={(e) =>
                  setClimateData((d) => ({
                    ...d,
                    weibullK: Number(e.target.value),
                  }))
                }
              />
            </Field>
          </div>

          <Field label="Mean Wind Speed" hint="auto-calculated">
            <div className="h-7 px-2 flex items-center bg-slate-800/60 border border-slate-700/50 rounded text-xs text-emerald-400 font-medium">
              {fmt(meanWindSpeed)} m/s
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Roughness z₀" hint="m">
              <input
                type="number"
                className={inputCls}
                value={climateData.roughnessLength}
                min={0}
                max={5}
                step={0.001}
                onChange={(e) =>
                  setClimateData((d) => ({
                    ...d,
                    roughnessLength: Number(e.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Reference Height" hint="m">
              <input
                type="number"
                className={inputCls}
                value={climateData.referenceHeight}
                min={10}
                max={300}
                step={10}
                onChange={(e) =>
                  setClimateData((d) => ({
                    ...d,
                    referenceHeight: Number(e.target.value),
                  }))
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Power Law α" hint="shear exponent">
              <input
                type="number"
                className={inputCls}
                value={climateData.powerLawAlpha}
                min={0.05}
                max={0.5}
                step={0.01}
                onChange={(e) =>
                  setClimateData((d) => ({
                    ...d,
                    powerLawAlpha: Number(e.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Stability">
              <select
                className={selectCls}
                value={climateData.stability}
                onChange={(e) =>
                  setClimateData((d) => ({ ...d, stability: e.target.value }))
                }
              >
                <option>Neutral</option>
                <option>Stable</option>
                <option>Unstable</option>
              </select>
            </Field>
          </div>

          <button
            type="button"
            className="w-full h-7 text-xs font-medium rounded bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-colors flex items-center justify-center gap-1.5 mt-1"
          >
            <Compass className="w-3 h-3" />
            Show Wind Rose
          </button>
        </Section>

        {/* ── Section 3: Turbine Properties ──────────────────────── */}
        {selectedTurbine && (
          <Section
            icon={Fan}
            title="Turbine Properties"
            badge={selectedTurbine.name}
            defaultOpen
          >
            <Field label="Name">
              <input
                type="text"
                className={inputCls}
                value={selectedTurbine.name}
                onChange={(e) => updateTurbine({ name: e.target.value })}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Latitude">
                <input
                  type="number"
                  className={inputCls}
                  value={selectedTurbine.lat ?? ''}
                  step={0.000001}
                  onChange={(e) =>
                    updateTurbine({ lat: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Longitude">
                <input
                  type="number"
                  className={inputCls}
                  value={selectedTurbine.lng ?? ''}
                  step={0.000001}
                  onChange={(e) =>
                    updateTurbine({ lng: Number(e.target.value) })
                  }
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Hub Height" hint="m">
                <input
                  type="number"
                  className={inputCls}
                  value={selectedTurbine.hubHeight}
                  min={10}
                  max={300}
                  step={10}
                  onChange={(e) =>
                    updateTurbine({ hubHeight: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Rotor Diameter" hint="m">
                <input
                  type="number"
                  className={inputCls}
                  value={selectedTurbine.rotorDiameter}
                  min={20}
                  max={250}
                  step={1}
                  onChange={(e) =>
                    updateTurbine({ rotorDiameter: Number(e.target.value) })
                  }
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Rated Power" hint="kW">
                <input
                  type="number"
                  className={inputCls}
                  value={selectedTurbine.ratedPower}
                  min={100}
                  max={15000}
                  step={100}
                  onChange={(e) =>
                    updateTurbine({ ratedPower: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Rated Wind Speed" hint="m/s">
                <input
                  type="number"
                  className={inputCls}
                  value={selectedTurbine.ratedSpeed}
                  min={5}
                  max={30}
                  step={0.5}
                  onChange={(e) =>
                    updateTurbine({ ratedSpeed: Number(e.target.value) })
                  }
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Cut-in Speed" hint="m/s">
                <input
                  type="number"
                  className={inputCls}
                  value={selectedTurbine.cutInSpeed}
                  min={2}
                  max={10}
                  step={0.5}
                  onChange={(e) =>
                    updateTurbine({ cutInSpeed: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Cut-out Speed" hint="m/s">
                <input
                  type="number"
                  className={inputCls}
                  value={selectedTurbine.cutOutSpeed}
                  min={20}
                  max={35}
                  step={0.5}
                  onChange={(e) =>
                    updateTurbine({ cutOutSpeed: Number(e.target.value) })
                  }
                />
              </Field>
            </div>

            <PowerCurvePreview turbine={selectedTurbine} />

            <button
              type="button"
              className="w-full h-7 text-xs font-medium rounded bg-red-900/40 border border-red-800/50 text-red-400 hover:bg-red-900/60 hover:text-red-300 transition-colors flex items-center justify-center gap-1.5 mt-1"
              onClick={() => {
                // Note: Delete handling would typically be via a callback;
                // here we just show the button. Parent should wire this.
              }}
            >
              <Trash2 className="w-3 h-3" />
              Delete Turbine
            </button>
          </Section>
        )}

        {/* ── Section 4: Analysis Results ────────────────────────── */}
        {results && (
          <Section
            icon={BarChart3}
            title="Analysis Results"
            badge={results.type ?? undefined}
            defaultOpen
          >
            {results.type === 'terrain' && <TerrainResults data={results.data} />}
            {results.type === 'wake' && <WakeResults data={results.data} />}
            {results.type === 'aep' && <AEPResults data={results.data} />}
          </Section>
        )}

        {/* ── Section 5: Loss Settings ───────────────────────────── */}
        <Section icon={Percent} title="Loss Settings" defaultOpen>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Wake Loss" hint="%">
              <input
                type="number"
                className={inputCls}
                value={losses.wakeLoss}
                min={0}
                max={50}
                step={0.1}
                onChange={(e) =>
                  setLosses((l) => ({ ...l, wakeLoss: Number(e.target.value) }))
                }
              />
            </Field>
            <Field label="Electrical Loss" hint="%, default 2%">
              <input
                type="number"
                className={inputCls}
                value={losses.electricalLoss}
                min={0}
                max={20}
                step={0.1}
                onChange={(e) =>
                  setLosses((l) => ({
                    ...l,
                    electricalLoss: Number(e.target.value),
                  }))
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Availability Loss" hint="%, default 3%">
              <input
                type="number"
                className={inputCls}
                value={losses.availability}
                min={0}
                max={20}
                step={0.1}
                onChange={(e) =>
                  setLosses((l) => ({
                    ...l,
                    availability: Number(e.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Curtailment" hint="%, default 1%">
              <input
                type="number"
                className={inputCls}
                value={losses.curtailment}
                min={0}
                max={20}
                step={0.1}
                onChange={(e) =>
                  setLosses((l) => ({
                    ...l,
                    curtailment: Number(e.target.value),
                  }))
                }
              />
            </Field>
          </div>

          {/* Total loss */}
          <div className="flex items-center justify-between p-2 bg-slate-800/60 rounded border border-slate-700/50">
            <span className="text-[11px] text-slate-400 font-medium">
              Total Losses
            </span>
            <span className="text-xs font-bold text-amber-400">
              {fmtPct(
                losses.wakeLoss +
                  losses.electricalLoss +
                  losses.availability +
                  losses.curtailment,
              )}
            </span>
          </div>

          {/* Uncertainty table */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <AlertTriangle className="w-3 h-3 text-slate-500" />
              <span className="text-[11px] font-medium text-slate-400">
                Uncertainty Sources
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 text-left">
                    <th className="pb-1 pr-2 font-medium">Source</th>
                    <th className="pb-1 font-medium">± %</th>
                  </tr>
                </thead>
                <tbody>
                  {uncertaintySources.map((u, i) => (
                    <tr
                      key={i}
                      className="border-t border-slate-800/50 even:bg-slate-800/30"
                    >
                      <td className="py-1 pr-2 text-slate-300">{u.name}</td>
                      <td className="py-1 text-slate-200">
                        <input
                          type="number"
                          className="w-14 h-5 px-1 text-right bg-slate-800/80 border border-slate-700/50 rounded text-[11px] text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          value={u.value}
                          min={0}
                          max={50}
                          step={0.1}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setUncertaintySources((prev) =>
                              prev.map((s, idx) =>
                                idx === i ? { ...s, value: val } : s,
                              ),
                            );
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-700">
                    <td className="pt-1 pr-2 text-[11px] text-slate-400 font-medium">
                      Combined (RSS)
                    </td>
                    <td className="pt-1 text-[11px] text-amber-400 font-bold">
                      {fmtPct(
                        Math.sqrt(
                          uncertaintySources.reduce(
                            (sum, u) => sum + u.value * u.value,
                            0,
                          ),
                        ),
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </Section>
      </div>
    </aside>
  );
}
