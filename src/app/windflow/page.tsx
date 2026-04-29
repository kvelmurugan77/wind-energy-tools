'use client';

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  Wind, Layers, Eye, EyeOff, Plus, MapPin, Activity, Zap,
  ChevronDown, ChevronRight, Upload, Trash2, Download,
  RotateCcw, RotateCw, Settings, FileText,
  Thermometer, Compass, BarChart3, AlertTriangle,
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

import {
  runPipeline,
  type PipelineConfig,
  type PipelineResult,
  type TurbineInput,
} from '@/lib/windflow/pipeline';
import {
  parseMastCSV,
  createManualMastData,
  generateSampleMastData,
  type MastData,
} from '@/lib/windflow/mast-parser';
import {
  getTurbineList,
  getTurbineSpec,
  getTurbinesByManufacturer,
  type TurbineSpec,
} from '@/lib/windflow/turbine-database';
import {
  uniformRoughnessRose,
  getRoughnessPreset,
  roughnessClass,
} from '@/lib/windflow/wasp-atlas';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const M_PER_DEG_LAT = 111320;
const DEFAULT_CENTER: [number, number] = [45.0, 10.0];
const DEFAULT_ZOOM = 11;
const NUM_SECTORS = 12;
const SECTOR_NAMES = ['N', 'NNE', 'ENE', 'E', 'ESE', 'SSE', 'S', 'SSW', 'WSW', 'W', 'WNW', 'NNW'];

// ═══════════════════════════════════════════════════════════════════════════
// Collapsible Section Component
// ═══════════════════════════════════════════════════════════════════════════

function Section({ icon: Icon, title, defaultOpen = true, children, badge }: {
  icon: React.ElementType; title: string; defaultOpen?: boolean;
  children: React.ReactNode; badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#1e293b]">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#162033] transition-colors">
        {open ? <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" /> : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />}
        <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 flex-1">{title}</span>
        {badge && <span className="text-[9px] bg-emerald-600/30 text-emerald-400 px-1.5 py-0.5 rounded font-medium">{badge}</span>}
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Mini Wind Rose SVG Component
// ═══════════════════════════════════════════════════════════════════════════

function MiniWindRose({ data, size = 140 }: { data: { frequency: number; meanSpeed: number }[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 14;
  const maxFreq = Math.max(...data.map(d => d.frequency), 0.01);

  // Sort by direction for polygon
  const sorted = [...data].map((d, i) => ({ ...d, angle: i * 30 })).sort((a, b) => a.angle - b.angle);

  const points = sorted.map(d => {
    const r = (d.frequency / maxFreq) * maxR;
    const rad = ((d.angle - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' Z');

  return (
    <svg width={size} height={size} className="mx-auto">
      {/* Grid circles */}
      {[0.25, 0.5, 0.75, 1.0].map(f => (
        <circle key={f} cx={cx} cy={cy} r={maxR * f} fill="none" stroke="#1e293b" strokeWidth={0.5} />
      ))}
      {/* Direction labels */}
      {['N', 'E', 'S', 'W'].map((label, i) => {
        const angle = ((i * 90 - 90) * Math.PI) / 180;
        return (
          <text key={label} x={cx + (maxR + 10) * Math.cos(angle)} y={cy + (maxR + 10) * Math.sin(angle) + 3}
            textAnchor="middle" fill="#64748b" fontSize={7} fontFamily="sans-serif">{label}</text>
        );
      })}
      {/* Polygon */}
      <path d={pathD} fill="rgba(34,197,94,0.25)" stroke="#22c55e" strokeWidth={1.5} />
      {/* Spokes */}
      {sorted.map((d, i) => {
        const rad = ((d.angle - 90) * Math.PI) / 180;
        return <line key={i} x1={cx} y1={cy} x2={cx + maxR * Math.cos(rad)} y2={cy + maxR * Math.sin(rad)} stroke="#1e293b" strokeWidth={0.5} />;
      })}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Page Component
// ═══════════════════════════════════════════════════════════════════════════

export default function WindFlowPage() {
  // ── Core State ──
  const [turbines, setTurbines] = useState<{
    id: string; name: string; lat: number; lng: number; model: string;
  }[]>([]);
  const [selectedTurbineId, setSelectedTurbineId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<'pointer' | 'turbine' | 'boundary' | 'measure'>('pointer');
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite'>('dark');
  const [calculating, setCalculating] = useState(false);

  // ── Mast Data ──
  const [mastData, setMastData] = useState<MastData | null>(null);
  const [mastHeight, setMastHeight] = useState(80);
  const [mastRoughness, setMastRoughness] = useState(0.03);
  const [mastLatitude, setMastLatitude] = useState(45);
  const [csvError, setCsvError] = useState<string | null>(null);

  // ── Manual Sector Entry ──
  const [manualSectors, setManualSectors] = useState(
    Array.from({ length: 12 }, (_, i) => ({
      direction: i * 30,
      meanSpeed: i <= 2 || i >= 10 ? 9.0 : i <= 8 ? 7.5 : 8.0,
      frequency: [9, 7, 6, 5, 4, 4, 4, 4, 5, 6, 7, 10][i] / 100,
    }))
  );

  // ── Turbine Model ──
  const [selectedModel, setSelectedModel] = useState('Vestas V150-5.6 MW');
  const turbineList = useMemo(() => getTurbineList(), []);
  const turbineByMfg = useMemo(() => getTurbinesByManufacturer(), []);
  const selectedSpec = useMemo(() => getTurbineSpec(selectedModel), [selectedModel]);

  // ── Roughness Rose ──
  const [roughnessRose, setRoughnessRose] = useState<number[]>(new Array(12).fill(0.03));
  const [roughnessPreset, setRoughnessPreset] = useState('farmland');

  // ── Losses ──
  const [losses, setLosses] = useState({ wake: 0, electrical: 0.02, availability: 0.03, environmental: 0.01 });
  const [wakeDecay, setWakeDecay] = useState(0.075);

  // ── Layer Visibility ──
  const [layerVisibility, setLayerVisibility] = useState({ turbines: true, wakes: false, resource: false, boundary: false });

  // ── Analysis Results ──
  const [results, setResults] = useState<PipelineResult | null>(null);
  const [resultTab, setResultTab] = useState<'summary' | 'turbines' | 'windrose' | 'losses'>('summary');

  // ── Map Data ──
  const [resourceGrid, setResourceGrid] = useState<{ lat: number; lng: number; speed: number }[] | undefined>();

  // ── Refs ──
  const turbineCounterRef = useRef(0);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // ── Derived ──
  const selectedTurbine = useMemo(() => turbines.find(t => t.id === selectedTurbineId), [turbines, selectedTurbineId]);
  const totalCapacity = useMemo(() => turbines.reduce((sum) => {
    const spec = selectedSpec;
    return sum + (spec?.ratedPower ?? 3000) / 1000;
  }, 0), [turbines, selectedSpec]);

  // ═══════════════════════════════════════════════════════════════════════
  // Handlers
  // ═══════════════════════════════════════════════════════════════════════

  const handleTurbineAdd = useCallback((lat: number, lng: number) => {
    turbineCounterRef.current += 1;
    const name = `WTG-${String(turbineCounterRef.current).padStart(2, '0')}`;
    setTurbines(prev => [...prev, { id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5), name, lat, lng, model: selectedModel }]);
    setSelectedTurbineId(null);
  }, [selectedModel]);

  const handleTurbineSelect = useCallback((id: string | null) => setSelectedTurbineId(id), []);
  const handleTurbineDelete = useCallback((id: string) => { setTurbines(prev => prev.filter(t => t.id !== id)); setSelectedTurbineId(null); }, []);

  const handleCSVUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseMastCSV(text, mastHeight, mastLatitude, 0, mastRoughness);
      if (parsed) {
        setMastData(parsed);
      } else {
        setCsvError('Failed to parse CSV. Check format (needs: Timestamp, Speed, Direction or Sector, Direction, MeanSpeed, WeibullA, WeibullK, Frequency)');
      }
    };
    reader.readAsText(file);
  }, [mastHeight, mastLatitude, mastRoughness]);

  const handleLoadSampleData = useCallback(() => {
    const sample = generateSampleMastData();
    setMastData(sample);
    setMastLatitude(sample.latitude);
    setMastHeight(sample.measurementHeight);
    setMastRoughness(sample.roughnessLength);
    setMapCenter([sample.latitude, sample.longitude]);
  }, []);

  const handleApplyManualData = useCallback(() => {
    const data = createManualMastData(manualSectors, mastHeight, mastLatitude, 0, mastRoughness);
    setMastData(data);
  }, [manualSectors, mastHeight, mastLatitude, mastRoughness]);

  const handleRoughnessPreset = useCallback((preset: string) => {
    setRoughnessPreset(preset);
    setRoughnessRose(getRoughnessPreset(preset));
  }, []);

  const handleRoughnessChange = useCallback((idx: number, value: number) => {
    setRoughnessRose(prev => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
    setRoughnessPreset('custom');
  }, []);

  const addSampleLayout = useCallback(() => {
    const spacingLat = 800 / M_PER_DEG_LAT;
    const spacingLng = 800 / (M_PER_DEG_LAT * Math.cos((mapCenter[0] * Math.PI) / 180));
    const newTurbines: typeof turbines = [];
    let counter = turbineCounterRef.current;
    for (let row = -1; row <= 1; row++) {
      for (let col = -1; col <= 1; col++) {
        counter += 1;
        newTurbines.push({
          id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          name: `WTG-${String(counter).padStart(2, '0')}`,
          lat: mapCenter[0] + row * spacingLat,
          lng: mapCenter[1] + col * spacingLng,
          model: selectedModel,
        });
      }
    }
    turbineCounterRef.current = counter;
    setTurbines(newTurbines);
    setResults(null);
    setResourceGrid(undefined);
  }, [mapCenter, selectedModel]);

  // ═══════════════════════════════════════════════════════════════════════
  // RUN ANALYSIS (Full WASP Pipeline)
  // ═══════════════════════════════════════════════════════════════════════

  const runAnalysis = useCallback(async () => {
    if (!mastData) {
      alert('Please load mast data first (CSV upload, manual entry, or sample data).');
      return;
    }
    if (turbines.length === 0) {
      alert('Please place at least one turbine on the map.');
      return;
    }

    setCalculating(true);
    await new Promise(r => setTimeout(r, 100));

    try {
      const pipelineInput: TurbineInput[] = turbines.map(t => ({
        id: t.id,
        name: t.name,
        lat: t.lat,
        lng: t.lng,
        model: t.model,
      }));

      const config: PipelineConfig = {
        mastData,
        turbines: pipelineInput,
        roughnessRose,
        terrainModel: 'none',
        latitude: mastLatitude,
        stabilityClass: 'neutral',
        losses: { wake: 0, electrical: losses.electrical, availability: losses.availability, environmental: losses.environmental },
        wakeDecay,
        superposition: 'RSS',
      };

      const result = runPipeline(config);
      setResults(result);
      setResourceGrid(result.resourceGrid);
      setLayerVisibility(prev => ({ ...prev, resource: true, wakes: true }));
      setResultTab('summary');
    } catch (error: any) {
      console.error('Pipeline error:', error);
      alert(`Analysis error: ${error.message}`);
    } finally {
      setCalculating(false);
    }
  }, [mastData, turbines, roughnessRose, mastLatitude, losses, wakeDecay]);

  // ═══════════════════════════════════════════════════════════════════════
  // Map Turbines Conversion
  // ═══════════════════════════════════════════════════════════════════════

  const mapTurbines: MapTurbine[] = useMemo(() => turbines.map(t => {
    const spec = getTurbineSpec(t.model);
    return {
      id: t.id, name: t.name, x: 0, y: 0, lat: t.lat, lng: t.lng,
      hubHeight: spec?.hubHeight ?? 100,
      rotorDiameter: spec?.rotorDiameter ?? 100,
      ratedPower: spec?.ratedPower ?? 3000,
      ratedSpeed: spec?.ratedSpeed ?? 12,
      cutInSpeed: spec?.cutInSpeed ?? 3,
      cutOutSpeed: spec?.cutOutSpeed ?? 25,
    };
  }), [turbines]);

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="h-screen flex flex-col bg-[#0a0e1a] overflow-hidden select-none">
      {/* ── MENU BAR ── */}
      <div className="h-8 bg-[#0c1222] border-b border-[#1e293b] flex items-center px-3 shrink-0 z-50">
        <div className="flex items-center gap-2 mr-4">
          <div className="w-5 h-5 bg-emerald-600 rounded flex items-center justify-center">
            <Wind className="w-3 h-3 text-white" />
          </div>
          <span className="text-xs font-bold text-white tracking-wide">WindFlow</span>
          <span className="text-[10px] text-slate-500 font-medium">v2.0</span>
        </div>
        <div className="ml-4 flex items-center gap-1.5">
          <span className="text-[10px] text-slate-600">WTGs:</span>
          <span className="text-[11px] text-slate-300 font-medium">{turbines.length}</span>
          <span className="text-[10px] text-[#1e293b] mx-1">|</span>
          <span className="text-[10px] text-slate-600">Capacity:</span>
          <span className="text-[11px] text-slate-300 font-medium">{totalCapacity.toFixed(1)} MW</span>
          {mastData && (<>
            <span className="text-[10px] text-[#1e293b] mx-1">|</span>
            <span className="text-[10px] text-slate-600">Mean WS:</span>
            <span className="text-[11px] text-emerald-400 font-medium">{mastData.overall.meanSpeed.toFixed(1)} m/s</span>
          </>)}
        </div>
        <div className="flex-1" />
        {calculating && <span className="text-[10px] text-amber-400 animate-pulse">Calculating...</span>}
      </div>

      {/* ── TOOLBAR ── */}
      <div className="h-10 bg-[#0c1222] border-b border-[#1e293b] flex items-center px-2 gap-1 shrink-0">
        {/* Tool buttons */}
        {[
          { key: 'pointer' as const, icon: MapPin, label: 'Select' },
          { key: 'turbine' as const, icon: Plus, label: 'Place WTG' },
        ].map(tool => (
          <button key={tool.key} type="button" onClick={() => setActiveTool(tool.key)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
              activeTool === tool.key ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-600/50' : 'text-slate-400 hover:text-slate-200 hover:bg-[#162033]'
            }`}>
            <tool.icon className="w-3.5 h-3.5" /> {tool.label}
          </button>
        ))}

        <div className="w-px h-5 bg-[#1e293b] mx-1" />

        {/* Model selector */}
        <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
          className="h-7 px-2 text-[10px] bg-[#162033] text-slate-300 border border-[#1e293b] rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 max-w-[180px]">
          {turbineList.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        {selectedSpec && (
          <span className="text-[9px] text-slate-500">
            {selectedSpec.ratedPower / 1000}MW | D={selectedSpec.rotorDiameter}m | H={selectedSpec.hubHeight}m
          </span>
        )}

        <div className="flex-1" />

        {/* Action buttons */}
        <button type="button" onClick={addSampleLayout}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] text-slate-400 hover:text-slate-200 hover:bg-[#162033] transition-colors">
          <Plus className="w-3.5 h-3.5" /> Sample Layout
        </button>

        <button type="button" onClick={runAnalysis} disabled={calculating}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded text-[11px] font-bold transition-colors ${
            calculating ? 'bg-slate-700 text-slate-500' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}>
          {calculating ? (
            <><RotateCw className="w-3.5 h-3.5 animate-spin" /> Calculating...</>
          ) : (
            <><Zap className="w-3.5 h-3.5" /> Run Analysis</>
          )}
        </button>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 flex min-h-0">
        {/* ── LEFT PANEL ── */}
        <div className="w-[256px] bg-[#0f172a] border-r border-[#1e293b] flex flex-col shrink-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-[#1e293b] flex items-center gap-2 shrink-0">
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Project Explorer</span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">

            {/* ── MAST DATA SECTION ── */}
            <Section icon={Wind} title="Mast Data" badge={mastData ? 'Loaded' : undefined}>
              <div className="space-y-2">
                {/* CSV Upload */}
                <input ref={csvInputRef} type="file" accept=".csv,.txt" onChange={handleCSVUpload} className="hidden" />
                <button type="button" onClick={() => csvInputRef.current?.click()}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] bg-[#162033] text-slate-300 border border-dashed border-[#334155] rounded hover:border-emerald-500 hover:text-emerald-400 transition-colors">
                  <Upload className="w-3 h-3" /> Upload CSV (Time Series or Sector Summary)
                </button>
                {csvError && <p className="text-[10px] text-red-400">{csvError}</p>}

                <button type="button" onClick={handleLoadSampleData}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] bg-[#162033] text-slate-300 border border-[#334155] rounded hover:bg-[#1e293b] transition-colors">
                  <FileText className="w-3 h-3" /> Load Sample Data (12-sector)
                </button>

                {/* Measurement settings */}
                <div className="grid grid-cols-3 gap-1">
                  <div>
                    <label className="text-[9px] text-slate-500 block">Height (m)</label>
                    <input type="number" value={mastHeight} onChange={e => setMastHeight(+e.target.value)}
                      className="w-full h-5 px-1 text-[10px] bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block">z0 (m)</label>
                    <input type="number" value={mastRoughness} onChange={e => setMastRoughness(+e.target.value)} step="0.001"
                      className="w-full h-5 px-1 text-[10px] bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 block">Lat</label>
                    <input type="number" value={mastLatitude} onChange={e => setMastLatitude(+e.target.value)} step="0.1"
                      className="w-full h-5 px-1 text-[10px] bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                  </div>
                </div>

                {/* Loaded data summary */}
                {mastData && (
                  <div className="bg-[#0c1222] rounded border border-[#1e293b] p-2 space-y-1.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-500">Source</span>
                      <span className="text-emerald-400 font-medium">{mastData.source}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-500">Overall Mean Speed</span>
                      <span className="text-cyan-400 font-bold">{mastData.overall.meanSpeed} m/s</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-500">Weibull A/k</span>
                      <span className="text-slate-300">{mastData.overall.weibullA} / {mastData.overall.weibullK}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-500">Power Density</span>
                      <span className="text-amber-400">{mastData.overall.powerDensity} W/m2</span>
                    </div>
                    <MiniWindRose data={mastData.sectors.map(s => ({ frequency: s.frequency, meanSpeed: s.meanSpeed }))} size={130} />
                  </div>
                )}

                {/* Manual entry toggle */}
                <button type="button" onClick={() => { /* toggle manual */ }}
                  className="text-[10px] text-cyan-500 hover:text-cyan-400 flex items-center gap-1">
                  <ChevronRight className="w-3 h-3" /> Manual 12-Sector Entry
                </button>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {manualSectors.map((sec, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-0.5 items-center">
                      <span className="text-[9px] text-slate-500 col-span-2">{SECTOR_NAMES[idx]}</span>
                      <input type="number" value={sec.meanSpeed} step="0.1"
                        onChange={e => {
                          const next = [...manualSectors]; next[idx].meanSpeed = +e.target.value; setManualSectors(next);
                        }}
                        className="col-span-4 h-5 px-1 text-[10px] bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                      <span className="text-[9px] text-slate-600 col-span-1">f=</span>
                      <input type="number" value={sec.frequency} step="0.01"
                        onChange={e => {
                          const next = [...manualSectors]; next[idx].frequency = +e.target.value; setManualSectors(next);
                        }}
                        className="col-span-4 h-5 px-1 text-[10px] bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                    </div>
                  ))}
                  <button type="button" onClick={handleApplyManualData}
                    className="w-full py-1 text-[10px] bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 rounded hover:bg-emerald-600/30 transition-colors">
                    Apply Manual Data
                  </button>
                </div>
              </div>
            </Section>

            {/* ── ROUGHNESS ROSE ── */}
            <Section icon={Compass} title="Roughness Rose">
              <div className="space-y-2">
                {/* Presets */}
                <div className="flex flex-wrap gap-1">
                  {['farmland', 'open_sea', 'forest_edge', 'forest', 'suburban', 'complex'].map(preset => (
                    <button key={preset} type="button" onClick={() => handleRoughnessPreset(preset)}
                      className={`px-2 py-0.5 text-[9px] rounded border transition-colors ${
                        roughnessPreset === preset ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/50' : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                      }`}>
                      {preset}
                    </button>
                  ))}
                </div>
                {/* Per-sector z0 */}
                <div className="grid grid-cols-6 gap-0.5">
                  {roughnessRose.map((z0, idx) => (
                    <div key={idx} className="flex flex-col items-center">
                      <span className="text-[8px] text-slate-500">{SECTOR_NAMES[idx]}</span>
                      <input type="number" value={z0} step="0.01" min="0.0001"
                        onChange={e => handleRoughnessChange(idx, +e.target.value)}
                        className="w-full h-5 px-0.5 text-[9px] bg-slate-800 border border-slate-700 rounded text-center text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                      <span className="text-[7px] text-slate-600">C{roughnessClass(z0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            {/* ── TURBINES LIST ── */}
            <Section icon={Wind} title={`Turbines (${turbines.length})`}>
              {turbines.length === 0 ? (
                <p className="text-[10px] text-slate-500 italic text-center py-2">No turbines placed. Click the map to add.</p>
              ) : (
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {turbines.map(t => {
                    const spec = getTurbineSpec(t.model);
                    return (
                      <div key={t.id} onClick={() => setSelectedTurbineId(t.id)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors ${
                          selectedTurbineId === t.id ? 'bg-emerald-600/20 border border-emerald-600/30' : 'hover:bg-[#162033]'
                        }`}>
                        <span className="text-[10px] text-slate-300 font-medium flex-1">{t.name}</span>
                        <span className="text-[9px] text-slate-500">{spec?.ratedPower ? `${spec.ratedPower / 1000}MW` : ''}</span>
                      </div>
                    );
                  })}
                  <button type="button" onClick={() => setTurbines([])}
                    className="flex items-center gap-1 px-2 py-1 text-[9px] text-red-400 hover:text-red-300">
                    <Trash2 className="w-3 h-3" /> Clear All
                  </button>
                </div>
              )}
            </Section>

            {/* ── LAYERS ── */}
            <Section icon={Layers} title="Layers" defaultOpen={false}>
              {(['turbines', 'wakes', 'resource', 'boundary'] as const).map(layer => (
                <label key={layer} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-[#162033] cursor-pointer">
                  <input type="checkbox" checked={layerVisibility[layer]} onChange={() => setLayerVisibility(prev => ({ ...prev, [layer]: !prev[layer] }))}
                    className="w-3 h-3 rounded accent-emerald-500" />
                  <span className="text-[10px] text-slate-300 capitalize">{layer}</span>
                </label>
              ))}
            </Section>

            {/* ── SETTINGS ── */}
            <Section icon={Settings} title="Settings" defaultOpen={false}>
              <div className="space-y-1.5">
                <div>
                  <label className="text-[9px] text-slate-500 block">Wake Decay Constant</label>
                  <input type="number" value={wakeDecay} onChange={e => setWakeDecay(+e.target.value)} step="0.005" min="0.02" max="0.15"
                    className="w-full h-5 px-1.5 text-[10px] bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                </div>
                <div>
                  <label className="text-[9px] text-slate-500 block">Electrical Losses (%)</label>
                  <input type="number" value={losses.electrical * 100} onChange={e => setLosses(prev => ({ ...prev, electrical: +e.target.value / 100 }))}
                    className="w-full h-5 px-1.5 text-[10px] bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                </div>
                <div>
                  <label className="text-[9px] text-slate-500 block">Availability Losses (%)</label>
                  <input type="number" value={losses.availability * 100} onChange={e => setLosses(prev => ({ ...prev, availability: +e.target.value / 100 }))}
                    className="w-full h-5 px-1.5 text-[10px] bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                </div>
                <div>
                  <label className="text-[9px] text-slate-500 block">Environmental Losses (%)</label>
                  <input type="number" value={losses.environmental * 100} onChange={e => setLosses(prev => ({ ...prev, environmental: +e.target.value / 100 }))}
                    className="w-full h-5 px-1.5 text-[10px] bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                </div>
              </div>
            </Section>
          </div>
        </div>

        {/* ── CENTER: MAP ── */}
        <div className="flex-1 relative">
          <MapView
            turbines={mapTurbines}
            onTurbineAdd={handleTurbineAdd}
            onTurbineMove={(id, lat, lng) => setTurbines(prev => prev.map(t => t.id === id ? { ...t, lat, lng } : t))}
            onTurbineSelect={handleTurbineSelect}
            onTurbineDelete={handleTurbineDelete}
            selectedTurbineId={selectedTurbineId}
            activeTool={activeTool}
            showWakeZones={layerVisibility.wakes}
            showResourceGrid={layerVisibility.resource}
            showBoundary={layerVisibility.boundary}
            windDirection={270}
            windSpeed={mastData?.overall.meanSpeed ?? 8}
            resourceData={resourceGrid}
            center={mapCenter}
            zoom={mapZoom}
          />

          {/* Tool indicator */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-[#0f172a]/90 backdrop-blur border border-[#334155] rounded-lg px-3 py-1 flex items-center gap-2 pointer-events-none">
            <div className={`w-2 h-2 rounded-full ${activeTool === 'turbine' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            <span className="text-[10px] text-slate-300">
              {activeTool === 'pointer' ? 'Select Mode' : 'Click map to place turbine'}
            </span>
          </div>

          {/* Resource legend */}
          {layerVisibility.resource && resourceGrid && (
            <div className="absolute bottom-8 left-3 z-[1000] bg-[#0f172a]/90 backdrop-blur border border-[#334155] rounded-lg p-2 pointer-events-none">
              <div className="text-[9px] text-slate-400 font-semibold uppercase mb-1">Wind Speed (m/s)</div>
              {[
                { color: '#3b82f6', label: '< 5' }, { color: '#06b6d4', label: '5-6.5' },
                { color: '#22c55e', label: '6.5-7.5' }, { color: '#eab308', label: '7.5-8.5' },
                { color: '#f97316', label: '8.5-9.5' }, { color: '#ef4444', label: '> 9.5' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: item.color }} />
                  <span className="text-[9px] text-slate-300">{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL: RESULTS ── */}
        {results && (
          <div className="w-[320px] bg-[#0f172a] border-l border-[#1e293b] flex flex-col shrink-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-[#1e293b] flex items-center gap-2 shrink-0">
              <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Analysis Results</span>
            </div>

            {/* Result tabs */}
            <div className="flex border-b border-[#1e293b] shrink-0">
              {(['summary', 'turbines', 'windrose', 'losses'] as const).map(tab => (
                <button key={tab} type="button" onClick={() => setResultTab(tab)}
                  className={`flex-1 py-1.5 text-[10px] font-medium capitalize transition-colors ${
                    resultTab === tab ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-500 hover:text-slate-300'
                  }`}>{tab}</button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
              {/* ── SUMMARY TAB ── */}
              {resultTab === 'summary' && (
                <div className="space-y-2">
                  <div className="bg-[#0c1222] rounded border border-[#1e293b] p-3 space-y-2">
                    <h3 className="text-[11px] font-bold text-white uppercase">Farm Summary</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <ResultCard label="Gross AEP" value={`${results.farmGrossAEP.toFixed(2)} GWh`} color="text-cyan-400" />
                      <ResultCard label="Net AEP" value={`${results.farmNetAEP.toFixed(2)} GWh`} color="text-emerald-400" />
                      <ResultCard label="Wake Loss" value={`${results.farmWakeLoss.toFixed(1)}%`} color="text-red-400" />
                      <ResultCard label="Capacity" value={`${results.farmCapacity.toFixed(1)} MW`} color="text-blue-400" />
                      <ResultCard label="Net CF" value={`${results.farmNetCF.toFixed(1)}%`} color="text-amber-400" />
                    </div>
                  </div>

                  <div className="bg-[#0c1222] rounded border border-[#1e293b] p-3 space-y-2">
                    <h3 className="text-[11px] font-bold text-white uppercase">Uncertainty</h3>
                    <div className="grid grid-cols-3 gap-2">
                      <ResultCard label="P90" value={`${results.p90AEP.toFixed(1)} GWh`} color="text-red-400" />
                      <ResultCard label="P75" value={`${results.p75AEP.toFixed(1)} GWh`} color="text-amber-400" />
                      <ResultCard label="P50" value={`${results.p50AEP.toFixed(1)} GWh`} color="text-emerald-400" />
                    </div>
                  </div>

                  <div className="bg-[#0c1222] rounded border border-[#1e293b] p-3 space-y-2">
                    <h3 className="text-[11px] font-bold text-white uppercase">Monthly Energy</h3>
                    <div className="grid grid-cols-4 gap-1">
                      {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (
                        <div key={m} className="text-center">
                          <div className="text-[8px] text-slate-500">{m}</div>
                          <div className="text-[10px] text-slate-300 font-medium">{results.monthlyEnergy[i] ? `${(results.monthlyEnergy[i] / 1000).toFixed(1)}` : '-'}</div>
                          <div className="h-1 mt-0.5 bg-slate-800 rounded overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded" style={{ width: `${Math.min(100, (results.monthlyEnergy[i] || 0) / (results.farmNetAEP * 1000 / 12) * 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── TURBINES TAB ── */}
              {resultTab === 'turbines' && (
                <div className="space-y-1">
                  <table className="w-full text-[9px]">
                    <thead>
                      <tr className="text-slate-500 border-b border-[#1e293b]">
                        <th className="text-left py-1">WTG</th>
                        <th className="text-right py-1">Gross WS</th>
                        <th className="text-right py-1">Gross AEP</th>
                        <th className="text-right py-1">Net AEP</th>
                        <th className="text-right py-1">Wake</th>
                        <th className="text-right py-1">CF%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.turbines.map(t => (
                        <tr key={t.id} className="border-b border-[#1e293b]/50 text-slate-300">
                          <td className="py-1 font-medium">{t.name}</td>
                          <td className="text-right">{t.grossMeanSpeed.toFixed(1)}</td>
                          <td className="text-right">{t.grossAEP.toFixed(1)}</td>
                          <td className="text-right text-emerald-400">{t.netAEP.toFixed(1)}</td>
                          <td className="text-right text-red-400">{t.wakeLossPercent.toFixed(1)}%</td>
                          <td className="text-right">{t.capacityFactor.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="text-white font-bold border-t border-[#334155]">
                        <td className="py-1">Total</td>
                        <td />
                        <td className="text-right">{results.farmGrossAEP.toFixed(2)}</td>
                        <td className="text-right text-emerald-400">{results.farmNetAEP.toFixed(2)}</td>
                        <td className="text-right text-red-400">{results.farmWakeLoss.toFixed(1)}%</td>
                        <td className="text-right">{results.farmNetCF.toFixed(1)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* ── WIND ROSE TAB ── */}
              {resultTab === 'windrose' && mastData && (
                <div className="space-y-2">
                  <MiniWindRose data={mastData.sectors.map(s => ({ frequency: s.frequency, meanSpeed: s.meanSpeed }))} size={200} />
                  <table className="w-full text-[9px]">
                    <thead>
                      <tr className="text-slate-500 border-b border-[#1e293b]">
                        <th className="text-left py-1">Dir</th>
                        <th className="text-right py-1">Freq%</th>
                        <th className="text-right py-1">Mean WS</th>
                        <th className="text-right py-1">Weibull A</th>
                        <th className="text-right py-1">Weibull k</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mastData.sectors.map((s, i) => (
                        <tr key={i} className="border-b border-[#1e293b]/50 text-slate-300">
                          <td className="py-0.5 font-medium">{SECTOR_NAMES[i]} ({s.direction})</td>
                          <td className="text-right">{(s.frequency * 100).toFixed(1)}</td>
                          <td className="text-right">{s.meanSpeed.toFixed(1)}</td>
                          <td className="text-right">{s.weibullA.toFixed(2)}</td>
                          <td className="text-right">{s.weibullK.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── LOSSES TAB ── */}
              {resultTab === 'losses' && (
                <div className="space-y-2">
                  <div className="bg-[#0c1222] rounded border border-[#1e293b] p-3">
                    <h3 className="text-[11px] font-bold text-white uppercase mb-2">Energy Loss Waterfall</h3>
                    <LossBar label="Gross AEP" value={results.farmGrossAEP} total={results.farmGrossAEP} color="bg-cyan-500" />
                    <LossBar label="Wake Losses" value={results.farmGrossAEP - results.farmNetAEP - results.farmGrossAEP * (1 - losses.electrical) * (1 - losses.availability) * (1 - losses.environmental)} total={results.farmGrossAEP} color="bg-red-500" />
                    <LossBar label="Electrical" value={results.farmGrossAEP * (results.farmWakeLoss / 100) * losses.electrical} total={results.farmGrossAEP} color="bg-amber-500" />
                    <LossBar label="Availability" value={results.farmNetAEP * losses.availability / (1 - losses.availability)} total={results.farmGrossAEP} color="bg-orange-500" />
                    <LossBar label="Environmental" value={results.farmNetAEP * losses.environmental / (1 - losses.environmental)} total={results.farmGrossAEP} color="bg-yellow-500" />
                    <div className="mt-2 pt-2 border-t border-[#334155]">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-white font-bold">Net AEP</span>
                        <span className="text-emerald-400 font-bold">{results.farmNetAEP.toFixed(2)} GWh</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-[#0c1222] rounded border border-[#1e293b] p-3 space-y-1">
                    <h3 className="text-[11px] font-bold text-white uppercase">Sector Wake Losses</h3>
                    <div className="grid grid-cols-6 gap-1">
                      {results.sectorWakeLoss.map((loss, i) => (
                        <div key={i} className="text-center">
                          <div className="text-[8px] text-slate-500">{SECTOR_NAMES[i]}</div>
                          <div className="text-[10px] text-slate-300">{(loss * 100).toFixed(1)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

function ResultCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0f172a] rounded border border-[#1e293b] p-2">
      <div className="text-[9px] text-slate-500 mb-0.5">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}

function LossBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-slate-400 w-24 text-right">{label}</span>
      <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
        <div className={`h-full ${color} rounded`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="text-[9px] text-slate-300 w-16 text-right">{value.toFixed(2)} GWh</span>
    </div>
  );
}
