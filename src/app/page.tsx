'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import {
  Wind, Upload, Play, Loader2, CheckCircle2, AlertTriangle, MapPin,
  BarChart3, Activity, Zap, Globe, Settings, Download, ChevronDown
} from 'lucide-react';

// ============================================================
// Wind Rose Component - SVG-based 12-sector wind rose
// ============================================================
function WindRose({ sectors }: { sectors: { sectorDir: number; frequency: number; meanSpeed: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const maxR = Math.min(W, H) / 2 - 40;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);

    // Concentric circles (grid)
    const circles = 5;
    for (let i = 1; i <= circles; i++) {
      const r = (maxR / circles) * i;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Label
      const pct = Math.round((i / circles) * 100 / 12);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${pct}%`, cx, cy - r + 10);
    }

    // Direction lines and labels
    const dirs = ['N', 'NNE', 'ENE', 'E', 'ESE', 'SSE', 'S', 'SSW', 'WSW', 'W', 'WNW', 'NNW'];
    const maxFreq = Math.max(...sectors.map(s => s.frequency), 0.01);

    for (let i = 0; i < 12; i++) {
      const angle = (i * 30 - 90) * (Math.PI / 180);
      const endX = cx + maxR * Math.cos(angle);
      const endY = cy + maxR * Math.sin(angle);

      // Grid line
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Direction label
      const labelR = maxR + 20;
      const lx = cx + labelR * Math.cos(angle);
      const ly = cy + labelR * Math.sin(angle);
      ctx.fillStyle = '#475569';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dirs[i], lx, ly);
    }

    // Speed color scale
    const speedColors = [
      { max: 4, color: '#22c55e' },
      { max: 7, color: '#84cc16' },
      { max: 10, color: '#eab308' },
      { max: 14, color: '#f97316' },
      { max: 20, color: '#ef4444' },
      { max: 999, color: '#7c3aed' },
    ];

    function getSpeedColor(speed: number): string {
      return speedColors.find(c => speed < c.max)?.color || '#7c3aed';
    }

    // Draw wind rose sectors
    for (let i = 0; i < 12; i++) {
      const sector = sectors[i];
      if (sector.frequency <= 0) continue;

      const angleDeg = i * 30 - 90;
      const angleRad = (angleDeg) * (Math.PI / 180);
      const nextAngleRad = ((i + 1) * 30 - 90) * (Math.PI / 180);
      const midAngleRad = (i * 30 + 15 - 90) * (Math.PI / 180);

      const r = (sector.frequency / maxFreq) * maxR;
      const halfSector = 13 * (Math.PI / 180);

      // Draw filled sector
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angleRad + halfSector, nextAngleRad + halfSector);
      ctx.closePath();
      ctx.fillStyle = getSpeedColor(sector.meanSpeed);
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Frequency label on sector
      if (sector.frequency > 0.02) {
        const labelR = Math.min(r + 15, maxR - 5);
        const lx = cx + labelR * Math.cos(midAngleRad);
        const ly = cy + labelR * Math.sin(midAngleRad);
        ctx.fillStyle = '#1e293b';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${(sector.frequency * 100).toFixed(1)}%`, lx, ly);
      }
    }

    // Calm circle
    const calmFreq = sectors.reduce((sum, s) => sum + s.frequency, 0);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Wind Rose', cx, H - 10);

  }, [sectors]);

  return <canvas ref={canvasRef} width={400} height={400} className="mx-auto" />;
}

// ============================================================
// Frequency Distribution Table
// ============================================================
function FrequencyTable({ table }: { table: { speedBinCenter: number[]; frequency: number[][]; sectorFreq: number[]; binFreq: number[] } }) {
  const dirs = ['N', 'NNE', 'ENE', 'E', 'ESE', 'SSE', 'S', 'SSW', 'WSW', 'W', 'WNW', 'NNW'];
  const bins = table.speedBinCenter;

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="border border-slate-300 bg-slate-100 px-2 py-1 font-semibold">Speed (m/s)</th>
            {dirs.map((d, i) => (
              <th key={i} className="border border-slate-300 bg-slate-100 px-1 py-1 font-semibold text-center">{d}</th>
            ))}
            <th className="border border-slate-300 bg-emerald-100 px-2 py-1 font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {bins.map((bin, bi) => (
            <tr key={bi}>
              <td className="border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium">{bin}</td>
              {table.frequency.map((sector, si) => {
                const val = sector[bi];
                const intensity = Math.min(val * 100 * 5, 100);
                return (
                  <td key={si} className="border border-slate-200 px-1 py-0.5 text-center">
                    {val > 0 ? (
                      <span
                        className="inline-block w-full text-center"
                        style={{
                          backgroundColor: `rgba(34, 197, 94, ${intensity / 100 * 0.5})`,
                          padding: '1px 0',
                        }}
                      >
                        {(val * 100).toFixed(2)}
                      </span>
                    ) : ''}
                  </td>
                );
              })}
              <td className="border border-slate-200 bg-emerald-50 px-2 py-0.5 text-center font-semibold">
                {(table.binFreq[bi] * 100).toFixed(2)}
              </td>
            </tr>
          ))}
          <tr className="bg-slate-100 font-semibold">
            <td className="border border-slate-300 px-2 py-1">Frequency</td>
            {table.sectorFreq.map((f, i) => (
              <td key={i} className="border border-slate-300 px-1 py-1 text-center">{(f * 100).toFixed(2)}</td>
            ))}
            <td className="border border-slate-300 bg-emerald-100 px-2 py-1 text-center">
              {(table.sectorFreq.reduce((a, b) => a + b, 0) * 100).toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Main Application
// ============================================================
export default function WindFlowModel() {
  const [activeTab, setActiveTab] = useState('input');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Input state
  const [windDataFile, setWindDataFile] = useState<File | null>(null);
  const [layoutFile, setLayoutFile] = useState<File | null>(null);
  const [windDataPreview, setWindDataPreview] = useState<string>('');
  const [layoutPreview, setLayoutPreview] = useState<string>('');

  // Configuration
  const [mastHeight, setMastHeight] = useState('100');
  const [measurementHeight, setMeasurementHeight] = useState('100');
  const [roughnessLength, setRoughnessLength] = useState('0.03');
  const [flowModelType, setFlowModelType] = useState('log-law');

  // Results
  const [results, setResults] = useState<any>(null);

  // Handle file upload
  const handleWindDataUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setWindDataFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setWindDataPreview(text.split('\n').slice(0, 6).join('\n'));
      };
      reader.readAsText(file);
    }
  }, []);

  const handleLayoutUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLayoutFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setLayoutPreview(text.split('\n').slice(0, 6).join('\n'));
      };
      reader.readAsText(file);
    }
  }, []);

  // Run analysis
  const runAnalysis = useCallback(async () => {
    if (!windDataFile || !layoutFile) {
      setError('Please upload both wind data and layout CSV files.');
      return;
    }

    setIsRunning(true);
    setError(null);
    setSuccess(false);

    try {
      const [windText, layoutText] = await Promise.all([
        windDataFile.text(),
        layoutFile.text(),
      ]);

      const response = await fetch('/api/windflow/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          windDataCsv: windText,
          layoutCsv: layoutText,
          mastHeight: parseFloat(mastHeight),
          measurementHeight: parseFloat(measurementHeight),
          roughnessLength: parseFloat(roughnessLength),
          flowModel: flowModelType,
        }),
      });

      const data = await response.json();

      if (data.error) {
        setError(data.error);
      } else {
        setResults(data);
        setSuccess(true);
        setActiveTab('climate');
      }
    } catch (err: any) {
      setError(err.message || 'Analysis failed. Please check your input data.');
    } finally {
      setIsRunning(false);
    }
  }, [windDataFile, layoutFile, mastHeight, measurementHeight, roughnessLength, flowModelType]);

  // Export CSV
  const exportResults = useCallback(() => {
    if (!results) return;
    const farm = results.farmResult;
    const headers = ['Turbine', 'UTM_X', 'UTM_Y', 'Model', 'Hub Height (m)', 'Rotor D (m)', 'Gross Speed (m/s)', 'Weibull A', 'Weibull K', 'Power Density (W/m2)', 'Gross AEP (GWh)', 'Wake Loss (%)', 'Net AEP (GWh)', 'Capacity Factor (%)'];
    const rows = farm.turbines.map((t: any) => [t.id, t.x, t.y, t.model, t.hubHeight, t.rotorDiameter, t.grossMeanSpeed, t.grossWeibullA, t.grossWeibullK, t.grossPowerDensity, t.grossAEP, t.wakeLossPercent, t.netAEP, t.capacityFactor]);
    const csv = [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wind_flow_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  const wc = results?.farmResult?.windClimate;
  const farm = results?.farmResult;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-slate-900 text-white border-b border-slate-700">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Wind className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight">Wind Flow Model</h1>
              <p className="text-[10px] text-slate-400">Linear Wind Flow &middot; WASP-type Analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {success && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Analysis Complete
              </span>
            )}
            {results && (
              <Button variant="outline" size="sm" className="text-xs border-slate-600 text-slate-300 hover:bg-slate-800"
                onClick={exportResults}>
                <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-slate-100 h-10 p-0.5">
              <TabsTrigger value="input" className="text-xs data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm rounded px-3 h-8">
                <Upload className="h-3 w-3 mr-1" /> 1. Data Input
              </TabsTrigger>
              <TabsTrigger value="climate" className="text-xs data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm rounded px-3 h-8" disabled={!success}>
                <BarChart3 className="h-3 w-3 mr-1" /> 2. Wind Climate
              </TabsTrigger>
              <TabsTrigger value="results" className="text-xs data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm rounded px-3 h-8" disabled={!success}>
                <Zap className="h-3 w-3 mr-1" /> 3. AEP Results
              </TabsTrigger>
              <TabsTrigger value="summary" className="text-xs data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm rounded px-3 h-8" disabled={!success}>
                <Activity className="h-3 w-3 mr-1" /> 4. Summary
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </nav>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border-b border-red-200">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
            <p className="text-xs text-red-700 flex-1">{error}</p>
            <Button variant="ghost" size="sm" className="h-6 text-red-500" onClick={() => setError(null)}>Clear</Button>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {isRunning && (
        <div className="fixed inset-0 bg-white/60 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 bg-white rounded-xl shadow-xl p-8">
            <Loader2 className="h-10 w-10 text-emerald-600 animate-spin" />
            <p className="text-sm font-semibold text-slate-700">Running Wind Flow Analysis</p>
            <p className="text-xs text-slate-500 text-center max-w-xs">
              Processing wind data, fitting Weibull distributions, extrapolating to {results?.turbineCount || 'WTG'} positions, and calculating AEP with wake effects...
            </p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-4 sm:px-6 py-6">

        {/* Tab 1: Data Input */}
        {activeTab === 'input' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Wind Data Upload */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center">
                    <BarChart3 className="h-3.5 w-3.5 text-emerald-700" />
                  </div>
                  Wind Data (Mast)
                </CardTitle>
                <CardDescription className="text-xs">
                  Upload long-term corrected wind data CSV with timestamp, wind speed (m/s), and direction (degrees)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-emerald-400 transition-colors">
                  <input type="file" accept=".csv,.txt" onChange={handleWindDataUpload} className="hidden" id="windDataInput" />
                  <label htmlFor="windDataInput" className="cursor-pointer">
                    <Upload className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                    <p className="text-xs font-medium text-slate-600">{windDataFile ? windDataFile.name : 'Click to upload CSV'}</p>
                    <p className="text-[10px] text-slate-400 mt-1">Format: timestamp, speed, direction</p>
                  </label>
                </div>
                {windDataPreview && (
                  <div className="bg-slate-50 rounded p-2 max-h-24 overflow-auto">
                    <pre className="text-[9px] text-slate-500 font-mono">{windDataPreview}</pre>
                    <p className="text-[10px] text-slate-400 mt-1">Preview: first 6 rows</p>
                  </div>
                )}
                {windDataFile && (
                  <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Loaded
                  </Badge>
                )}
              </CardContent>
            </Card>

            {/* Layout Upload */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center">
                    <MapPin className="h-3.5 w-3.5 text-blue-700" />
                  </div>
                  WTG Layout
                </CardTitle>
                <CardDescription className="text-xs">
                  Upload turbine layout CSV with ID, X(UTM), Y(UTM), Model, Rotor Diameter, Hub Height
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                  <input type="file" accept=".csv,.txt" onChange={handleLayoutUpload} className="hidden" id="layoutInput" />
                  <label htmlFor="layoutInput" className="cursor-pointer">
                    <Upload className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                    <p className="text-xs font-medium text-slate-600">{layoutFile ? layoutFile.name : 'Click to upload CSV'}</p>
                    <p className="text-[10px] text-slate-400 mt-1">Format: id, x, y, model, RD, HH</p>
                  </label>
                </div>
                {layoutPreview && (
                  <div className="bg-slate-50 rounded p-2 max-h-24 overflow-auto">
                    <pre className="text-[9px] text-slate-500 font-mono">{layoutPreview}</pre>
                    <p className="text-[10px] text-slate-400 mt-1">Preview: first 6 rows</p>
                  </div>
                )}
                {layoutFile && (
                  <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Loaded
                  </Badge>
                )}
              </CardContent>
            </Card>

            {/* Configuration */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-purple-100 flex items-center justify-center">
                    <Settings className="h-3.5 w-3.5 text-purple-700" />
                  </div>
                  Analysis Configuration
                </CardTitle>
                <CardDescription className="text-xs">
                  Configure mast parameters and flow model settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Mast Height (m)</Label>
                    <Input type="number" value={mastHeight} onChange={e => setMastHeight(e.target.value)}
                      className="h-8 text-xs mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Measurement Height (m)</Label>
                    <Input type="number" value={measurementHeight} onChange={e => setMeasurementHeight(e.target.value)}
                      className="h-8 text-xs mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Roughness z0 (m)</Label>
                    <Input type="number" step="0.001" value={roughnessLength} onChange={e => setRoughnessLength(e.target.value)}
                      className="h-8 text-xs mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Flow Model</Label>
                    <Select value={flowModelType} onValueChange={setFlowModelType}>
                      <SelectTrigger className="h-8 text-xs mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="log-law">Log-Law</SelectItem>
                        <SelectItem value="power-law">Power-Law</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded p-2.5">
                  <p className="text-[10px] text-amber-700 leading-relaxed">
                    <strong>Flow Model:</strong> Uses {flowModelType === 'log-law' ? 'Logarithmic' : 'Power'} wind profile for vertical extrapolation
                    from measurement height ({measurementHeight}m) to each WTG hub height.
                    Roughness z0 = {roughnessLength}m ({parseFloat(roughnessLength) <= 0.03 ? 'open terrain' : parseFloat(roughnessLength) <= 0.1 ? 'agricultural' : 'suburban/forest'}).
                  </p>
                </div>
                <Separator />
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={runAnalysis}
                  disabled={isRunning || !windDataFile || !layoutFile}
                >
                  {isRunning ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-2" /> Run Wind Flow Analysis</>
                  )}
                </Button>
                <p className="text-[10px] text-slate-400 text-center">
                  Processes wind data, fits Weibull distribution per sector, extrapolates to each WTG, applies PARK1 wake model, calculates AEP
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab 2: Wind Climate Analysis */}
        {activeTab === 'climate' && results && wc && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Wind Rose */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Wind Rose - Observed Wind Climate at Mast</CardTitle>
                <CardDescription className="text-xs">
                  {wc.totalRecords.toLocaleString()} records | Period: {wc.dataPeriod.start} to {wc.dataPeriod.end}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <WindRose sectors={wc.sectors} />
              </CardContent>
            </Card>

            {/* Wind Climate Summary */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Overall Wind Climate Statistics</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-emerald-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-emerald-700">{wc.overallMeanSpeed}</p>
                      <p className="text-[10px] text-emerald-600 mt-1">Mean Wind Speed (m/s)</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-blue-700">{wc.overallPowerDensity}</p>
                      <p className="text-[10px] text-blue-600 mt-1">Power Density (W/m2)</p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-purple-700">{wc.overallWeibullA}</p>
                      <p className="text-[10px] text-purple-600 mt-1">Weibull A (scale, m/s)</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-orange-700">{wc.overallWeibullK}</p>
                      <p className="text-[10px] text-orange-600 mt-1">Weibull k (shape)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Sector Table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Directional Distribution (12 Sectors)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="text-xs w-full">
                      <thead className="sticky top-0">
                        <tr className="bg-slate-100">
                          <th className="px-2 py-1 text-left font-semibold">Sector</th>
                          <th className="px-2 py-1 text-center font-semibold">Freq (%)</th>
                          <th className="px-2 py-1 text-center font-semibold">Mean WS</th>
                          <th className="px-2 py-1 text-center font-semibold">Weibull A</th>
                          <th className="px-2 py-1 text-center font-semibold">Weibull k</th>
                          <th className="px-2 py-1 text-center font-semibold">P dens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {wc.sectors.map((s: any, i: number) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                            <td className="px-2 py-1 font-medium">{s.sectorDir}° ({['N','NNE','ENE','E','ESE','SSE','S','SSW','WSW','W','WNW','NNW'][i]})</td>
                            <td className="px-2 py-1 text-center">{(s.frequency * 100).toFixed(2)}</td>
                            <td className="px-2 py-1 text-center">{s.meanSpeed.toFixed(1)}</td>
                            <td className="px-2 py-1 text-center">{s.weibullA.toFixed(2)}</td>
                            <td className="px-2 py-1 text-center">{s.weibullK.toFixed(3)}</td>
                            <td className="px-2 py-1 text-center">{s.powerDensity.toFixed(0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Frequency Table */}
            <Card className="xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Wind Speed Frequency Distribution (%)</CardTitle>
                <CardDescription className="text-xs">
                  Joint probability of wind speed and direction at mast measurement height ({measurementHeight}m)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FrequencyTable table={results.frequencyTable} />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab 3: AEP Results */}
        {activeTab === 'results' && results && farm && (
          <div className="space-y-4">
            {/* Farm Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-slate-800">{(farm.farmCapacity / 1000).toFixed(0)}</p>
                  <p className="text-[10px] text-slate-500 mt-1">Total Capacity (MW)</p>
                  <p className="text-[10px] text-slate-400">{farm.turbines.length} x {farm.turbines[0]?.model || 'WTG'}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-emerald-700">{farm.totalGrossAEP.toFixed(1)}</p>
                  <p className="text-[10px] text-slate-500 mt-1">Gross AEP (GWh/yr)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{farm.wakeLossPercent.toFixed(1)}%</p>
                  <p className="text-[10px] text-slate-500 mt-1">Wake Losses ({farm.totalWakeLoss.toFixed(1)} GWh)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-blue-700">{farm.totalNetAEP.toFixed(1)}</p>
                  <p className="text-[10px] text-slate-500 mt-1">Net AEP (GWh/yr)</p>
                  <p className="text-[10px] text-blue-400">CF = {farm.netCapacityFactor.toFixed(1)}%</p>
                </CardContent>
              </Card>
            </div>

            {/* Per-Turbine Results Table */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">Per-Turbine AEP Results</CardTitle>
                    <CardDescription className="text-xs">
                      Wind flow extrapolated from mast ({measurementHeight}m) to each WTG hub height using {flowModelType}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="text-xs w-full">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-100">
                        <th className="px-2 py-1.5 text-left font-semibold border-b border-r border-slate-200">WTG</th>
                        <th className="px-2 py-1.5 text-center font-semibold border-b border-r border-slate-200">UTM X</th>
                        <th className="px-2 py-1.5 text-center font-semibold border-b border-r border-slate-200">UTM Y</th>
                        <th className="px-2 py-1.5 text-center font-semibold border-b border-r border-slate-200">Model</th>
                        <th className="px-2 py-1.5 text-center font-semibold border-b border-r border-slate-200">HH (m)</th>
                        <th className="px-2 py-1.5 text-center font-semibold border-b border-r border-emerald-300 bg-emerald-50">Gross WS</th>
                        <th className="px-2 py-1.5 text-center font-semibold border-b border-r border-emerald-300 bg-emerald-50">Weibull A</th>
                        <th className="px-2 py-1.5 text-center font-semibold border-b border-r border-emerald-300 bg-emerald-50">Weibull k</th>
                        <th className="px-2 py-1.5 text-center font-semibold border-b border-r border-emerald-300 bg-emerald-50">P dens</th>
                        <th className="px-2 py-1.5 text-center font-semibold border-b border-r border-blue-300 bg-blue-50">Gross AEP</th>
                        <th className="px-2 py-1.5 text-center font-semibold border-b border-r border-red-300 bg-red-50">Wake Loss</th>
                        <th className="px-2 py-1.5 text-center font-semibold border-b border-blue-300 bg-blue-50">Net AEP</th>
                        <th className="px-2 py-1.5 text-center font-semibold border-b border-blue-300 bg-blue-50">Net CF%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {farm.turbines.map((t: any, i: number) => {
                        const maxSpeed = Math.max(...farm.turbines.map((tt: any) => tt.grossMeanSpeed));
                        const minSpeed = Math.min(...farm.turbines.filter((tt: any) => tt.grossMeanSpeed > 0).map((tt: any) => tt.grossMeanSpeed));
                        const speedRange = maxSpeed - minSpeed || 1;
                        const intensity = t.grossMeanSpeed > 0 ? (t.grossMeanSpeed - minSpeed) / speedRange : 0;
                        return (
                          <tr key={t.id} className={i % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50 hover:bg-slate-100'}>
                            <td className="px-2 py-1 font-semibold">{t.id}</td>
                            <td className="px-2 py-1 text-center">{t.x.toLocaleString()}</td>
                            <td className="px-2 py-1 text-center">{t.y.toLocaleString()}</td>
                            <td className="px-2 py-1 text-center">{t.model}</td>
                            <td className="px-2 py-1 text-center">{t.hubHeight}</td>
                            <td className="px-2 py-1 text-center font-semibold bg-emerald-50" style={{
                              backgroundColor: `rgba(34, 197, 94, ${0.05 + intensity * 0.25})`
                            }}>
                              {t.grossMeanSpeed.toFixed(2)}
                            </td>
                            <td className="px-2 py-1 text-center bg-emerald-50">{t.grossWeibullA.toFixed(2)}</td>
                            <td className="px-2 py-1 text-center bg-emerald-50">{t.grossWeibullK.toFixed(3)}</td>
                            <td className="px-2 py-1 text-center bg-emerald-50">{t.grossPowerDensity.toFixed(0)}</td>
                            <td className="px-2 py-1 text-center font-semibold bg-blue-50">{t.grossAEP.toFixed(3)}</td>
                            <td className="px-2 py-1 text-center font-semibold bg-red-50">
                              <span className={t.wakeLossPercent > 5 ? 'text-red-600' : t.wakeLossPercent > 2 ? 'text-amber-600' : 'text-green-600'}>
                                {t.wakeLossPercent.toFixed(2)}%
                              </span>
                            </td>
                            <td className="px-2 py-1 text-center font-bold bg-blue-50">{t.netAEP.toFixed(3)}</td>
                            <td className="px-2 py-1 text-center bg-blue-50">{t.capacityFactor.toFixed(1)}</td>
                          </tr>
                        );
                      })}
                      {/* Total Row */}
                      <tr className="bg-slate-200 font-bold">
                        <td className="px-2 py-1.5" colSpan={9}>TOTAL ({farm.turbines.length} turbines, {(farm.farmCapacity / 1000).toFixed(0)} MW)</td>
                        <td className="px-2 py-1.5 text-center bg-blue-100">{farm.totalGrossAEP.toFixed(1)} GWh</td>
                        <td className="px-2 py-1.5 text-center bg-red-100 text-red-700">{farm.wakeLossPercent.toFixed(1)}%</td>
                        <td className="px-2 py-1.5 text-center bg-blue-100 text-blue-700">{farm.totalNetAEP.toFixed(1)} GWh</td>
                        <td className="px-2 py-1.5 text-center bg-blue-100">{farm.netCapacityFactor.toFixed(1)}%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab 4: Summary */}
        {activeTab === 'summary' && results && farm && (
          <div className="space-y-6">
            {/* Executive Summary */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Wind Flow Analysis - Executive Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Wind Resource at Mast</h3>
                    <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Data Period</span>
                        <span className="font-medium">{wc.dataPeriod.start} to {wc.dataPeriod.end}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Total Records</span>
                        <span className="font-medium">{wc.totalRecords.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Mean Wind Speed</span>
                        <span className="font-bold text-emerald-700">{wc.overallMeanSpeed} m/s</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Weibull A / k</span>
                        <span className="font-medium">{wc.overallWeibullA} / {wc.overallWeibullK}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Power Density</span>
                        <span className="font-medium">{wc.overallPowerDensity} W/m2</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Measurement Height</span>
                        <span className="font-medium">{measurementHeight} m</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Roughness z0</span>
                        <span className="font-medium">{roughnessLength} m</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Energy Production</h3>
                    <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Number of Turbines</span>
                        <span className="font-medium">{farm.turbines.length}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Turbine Model</span>
                        <span className="font-medium">{farm.turbines[0]?.model}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Total Capacity</span>
                        <span className="font-bold">{(farm.farmCapacity / 1000).toFixed(0)} MW</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Gross AEP</span>
                        <span className="font-bold text-emerald-700">{farm.totalGrossAEP.toFixed(1)} GWh/yr</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Wake Losses</span>
                        <span className="font-bold text-red-600">{farm.totalWakeLoss.toFixed(1)} GWh ({farm.wakeLossPercent.toFixed(1)}%)</span>
                      </div>
                      <div className="flex justify-between text-xs bg-blue-50 -mx-4 px-4 py-1.5 rounded">
                        <span className="text-slate-700 font-semibold">Net AEP</span>
                        <span className="font-bold text-blue-700 text-sm">{farm.totalNetAEP.toFixed(1)} GWh/yr</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Net Capacity Factor</span>
                        <span className="font-bold text-blue-700">{farm.netCapacityFactor.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
                <Separator />
                <div>
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Analysis Methodology</h3>
                  <div className="text-xs text-slate-600 space-y-1.5 leading-relaxed">
                    <p><strong>Wind Data Processing:</strong> Long-term corrected time-series wind data was analyzed to produce a 12-sector directional frequency distribution. Weibull parameters (A, k) were fitted for each sector using Maximum Likelihood Estimation (MLE).</p>
                    <p><strong>Wind Flow Extrapolation:</strong> Wind speeds were extrapolated from the mast measurement height ({measurementHeight}m) to each WTG hub height using the {flowModelType === 'log-law' ? 'logarithmic (ln(z/z0))' : 'power-law ((z/z_ref)^alpha)'} wind profile with surface roughness length z0 = {roughnessLength}m. The mast location was assumed to be representative of the wind farm area.</p>
                    <p><strong>AEP Calculation:</strong> Gross AEP was calculated by integrating the Weibull probability distribution with the turbine power curve (P(v)) over all wind speeds for each directional sector. Net AEP includes PARK1 wake model losses with k_wake = 0.075 using RSS (Root Sum Square) superposition of wake deficits.</p>
                    <p><strong>Wake Model:</strong> PARK1 model (Katic et al., 1986) with wake decay constant k = 0.075 (onshore). Thrust coefficient (CT) varies with wind speed from 0.82 at partial load to 0.05 at full load. Combined wake effects calculated using RSS superposition method.</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Per-sector AEP breakdown */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Farm AEP by Wind Direction Sector</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="text-xs w-full">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="px-2 py-1 text-left font-semibold">Sector</th>
                        <th className="px-2 py-1 text-center font-semibold">Direction</th>
                        <th className="px-2 py-1 text-center font-semibold">Frequency (%)</th>
                        <th className="px-2 py-1 text-center font-semibold">Mast WS (m/s)</th>
                        <th className="px-2 py-1 text-center font-semibold">Avg Hub WS</th>
                        <th className="px-2 py-1 text-center font-semibold">Sector AEP (GWh)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const dirNames = ['N', 'NNE', 'ENE', 'E', 'ESE', 'SSE', 'S', 'SSW', 'WSW', 'W', 'WNW', 'NNW'];
                        // Calculate per-sector farm AEP
                        const turbineModel = farm.turbines[0]?.model || 'N163-7.0MW';
                        return wc.sectors.map((s: any, si: number) => {
                          const avgHubSpeed = farm.turbines.reduce((sum: number, t: any) => sum + (t.sectorSpeeds?.[si] || 0), 0) / farm.turbines.length;
                          // Rough sector AEP estimate: freq * 8760 * 0.5 * P(avg_speed) / 1000
                          const pct = s.frequency * 100;
                          return (
                            <tr key={si} className={si % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                              <td className="px-2 py-1 font-medium">{dirNames[si]}</td>
                              <td className="px-2 py-1 text-center">{s.sectorDir}°</td>
                              <td className="px-2 py-1 text-center">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${pct > 10 ? 'bg-emerald-100 text-emerald-700' : pct > 5 ? 'bg-yellow-50 text-yellow-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {pct.toFixed(1)}
                                </span>
                              </td>
                              <td className="px-2 py-1 text-center">{s.meanSpeed.toFixed(1)}</td>
                              <td className="px-2 py-1 text-center font-semibold">{avgHubSpeed.toFixed(2)}</td>
                              <td className="px-2 py-1 text-center">
                                {((s.frequency * farm.totalGrossAEP) / (wc.sectors.reduce((a: number, ss: any) => a + ss.frequency, 0) || 1)).toFixed(3)}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-slate-100 border-t border-slate-200 py-2.5 mt-auto">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 flex items-center justify-between">
          <p className="text-[10px] text-slate-400">
            Wind Flow Model &middot; Log/Power Law Extrapolation &middot; PARK1 Wake &middot; Weibull AEP
          </p>
          <p className="text-[10px] text-slate-400">
            {success ? `${results.turbineCount} turbines | P50 Net AEP: ${farm?.totalNetAEP?.toFixed(1)} GWh` : 'Upload data to begin analysis'}
          </p>
        </div>
      </footer>
    </div>
  );
}
