// ============================================================
// Tab 1: Project Setup & Data Input
// ============================================================
'use client'

import React, { useState, useRef, useCallback } from 'react'
import { useAppState } from './WindContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Upload, Download, Trash2, Plus, Database, AlertTriangle,
  FileSpreadsheet, MapPin, Settings, Play, Loader2, CheckCircle2,
  Info
} from 'lucide-react'
import type { MetMast, WTG, WindFarmLayout, AnalysisConfig } from '@/lib/wind'

export default function ProjectSetup({ onRunAnalysis }: { onRunAnalysis: () => void }) {
  const { state, dispatch } = useAppState()
  const { config, masts, wtgs, externalWindFarms, isLoading, warnings, error, analysisRun } = state
  const [mastErrors, setMastErrors] = useState<string[]>([])
  const [wtgErrors, setWtgErrors] = useState<string[]>([])
  const [extErrors, setExtErrors] = useState<string[]>([])
  const [showSampleConfirm, setShowSampleConfirm] = useState(false)
  const mastFileRef = useRef<HTMLInputElement>(null)
  const wtgFileRef = useRef<HTMLInputElement>(null)
  const extFileRef = useRef<HTMLInputElement>(null)

  // ---- Config handlers ----
  const updateConfig = useCallback((updates: Partial<AnalysisConfig>) => {
    dispatch({ type: 'SET_CONFIG', payload: updates })
  }, [dispatch])

  const updateProject = useCallback((field: string, value: string) => {
    dispatch({ type: 'SET_CONFIG', payload: { project: { ...config.project, [field]: value } } })
  }, [dispatch, config.project])

  // ---- CSV upload handlers ----
  const handleCSVUpload = useCallback((file: File, type: 'mast' | 'wtg' | 'ext') => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      parseAndLoadCSV(text, type)
    }
    reader.readAsText(file)
  }, [])

  const parseAndLoadCSV = (text: string, type: 'mast' | 'wtg' | 'ext') => {
    const lines = text.trim().split('\n')
    if (lines.length < 2) {
      if (type === 'mast') setMastErrors(['CSV must have header + data rows'])
      if (type === 'wtg') setWtgErrors(['CSV must have header + data rows'])
      if (type === 'ext') setExtErrors(['CSV must have header + data rows'])
      return
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())

    if (type === 'mast') {
      const newMasts: MetMast[] = []
      const errs: string[] = []
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim())
        const get = (h: string) => vals[headers.indexOf(h)] || ''
        const lat = parseFloat(get('latitude'))
        const lon = parseFloat(get('longitude'))
        const mh = parseFloat(get('mastheight'))
        if (isNaN(lat) || isNaN(lon) || isNaN(mh)) {
          errs.push(`Row ${i + 1}: invalid values`)
          continue
        }
        const heightsStr = get('measurementheights')
        newMasts.push({
          id: get('id') || `MM-${String(i).padStart(2, '0')}`,
          name: get('name') || `MM-${String(i).padStart(2, '0')}`,
          location: { latitude: lat, longitude: lon },
          mastHeight: mh,
          type: (get('type') as MetMast['type']) || 'lattice',
          measurementHeights: heightsStr ? heightsStr.split(';').map(Number).filter(n => !isNaN(n)) : undefined,
        })
      }
      dispatch({ type: 'SET_MASTS', payload: [...masts, ...newMasts] })
      setMastErrors(errs)
    } else if (type === 'wtg') {
      const newWtgs: WTG[] = []
      const errs: string[] = []
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim())
        const get = (h: string) => vals[headers.indexOf(h)] || ''
        const lat = parseFloat(get('latitude'))
        const lon = parseFloat(get('longitude'))
        const rd = parseFloat(get('rotordiameter'))
        const hh = parseFloat(get('hubheight'))
        if (isNaN(lat) || isNaN(lon) || isNaN(rd) || isNaN(hh)) {
          errs.push(`Row ${i + 1}: invalid values`)
          continue
        }
        newWtgs.push({
          id: get('id') || `WTG-${String(i).padStart(2, '0')}`,
          name: get('name') || `WTG-${String(i).padStart(2, '0')}`,
          location: { latitude: lat, longitude: lon },
          rotorDiameter: rd,
          hubHeight: hh,
          ratedPower: parseFloat(get('ratedpower')) || undefined,
          isTarget: get('istarget')?.toLowerCase() !== 'false',
          status: 'operational',
        })
      }
      dispatch({ type: 'SET_WTGS', payload: [...wtgs, ...newWtgs] })
      setWtgErrors(errs)
    } else {
      // External WTGs
      const newWtgs: WTG[] = []
      const errs: string[] = []
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim())
        const get = (h: string) => vals[headers.indexOf(h)] || ''
        const lat = parseFloat(get('latitude'))
        const lon = parseFloat(get('longitude'))
        const rd = parseFloat(get('rotordiameter'))
        const hh = parseFloat(get('hubheight'))
        if (isNaN(lat) || isNaN(lon) || isNaN(rd) || isNaN(hh)) {
          errs.push(`Row ${i + 1}: invalid values`)
          continue
        }
        newWtgs.push({
          id: `EXT-${String(i).padStart(2, '0')}`,
          name: get('name') || `EXT-${String(i).padStart(2, '0')}`,
          location: { latitude: lat, longitude: lon },
          rotorDiameter: rd,
          hubHeight: hh,
          status: 'operational',
        })
      }
      if (newWtgs.length > 0) {
        const farm: WindFarmLayout = {
          id: `EXT-WF-${Date.now()}`,
          name: `External Wind Farm ${externalWindFarms.length + 1}`,
          isExternal: true,
          turbines: newWtgs,
        }
        dispatch({ type: 'SET_EXTERNAL_FARMS', payload: [...externalWindFarms, farm] })
      }
      setExtErrors(errs)
    }
  }

  // ---- Sample data ----
  const loadSampleData = async () => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true })
      const res = await fetch('/api/sample-data')
      const json = await res.json()
      if (json.success) {
        dispatch({ type: 'LOAD_SAMPLE_DATA', payload: json.data })
        setShowSampleConfirm(false)
      }
    } catch {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load sample data' })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  // ---- Download CSV template ----
  const downloadTemplate = (type: 'mast' | 'wtg') => {
    const headers = type === 'mast'
      ? 'id,name,latitude,longitude,mastheight,type,measurementheights'
      : 'id,name,latitude,longitude,rotordiameter,hubheight,ratedpower,istarget'
    const example = type === 'mast'
      ? 'MM-01,Met Mast 01,13.082,77.585,120,lattice,40;60;80;100;120'
      : 'WTG-01,WTG-01,13.085,77.582,126,100,3000,true'
    const csv = `${headers}\n${example}\n`
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${type}_template.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const canRun = masts.length > 0 && wtgs.length > 0 && config.project.name.trim() !== ''

  return (
    <div className="space-y-6">
      {/* Project Information */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 text-emerald-600" />
            Project Information
          </CardTitle>
          <CardDescription>Enter project details for the assessment report</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="proj-name">Project Name *</Label>
              <Input id="proj-name" placeholder="e.g. Alpha Wind Farm PCV" value={config.project.name}
                onChange={e => updateProject('name', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-location">Location *</Label>
              <Input id="proj-location" placeholder="e.g. Karnataka, India" value={config.project.location}
                onChange={e => updateProject('location', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-client">Client</Label>
              <Input id="proj-client" placeholder="Client name" value={config.project.client || ''}
                onChange={e => updateProject('client', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-report">Report Number</Label>
              <Input id="proj-report" placeholder="e.g. RPT-PCV-2026-001" value={config.project.reportNumber || ''}
                onChange={e => updateProject('reportNumber', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-analyst">Analyst</Label>
              <Input id="proj-analyst" placeholder="Analyst name" value={config.project.analyst || ''}
                onChange={e => updateProject('analyst', e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* IEC Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4 text-emerald-600" />
            Assessment Configuration
          </CardTitle>
          <CardDescription>IEC 61400-12-1 parameters</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label>IEC Version</Label>
              <Select value={config.iecVersion} onValueChange={v => updateConfig({ iecVersion: v as AnalysisConfig['iecVersion'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IEC-61400-12-1-2017">IEC 61400-12-1:2017</SelectItem>
                  <SelectItem value="IEC-61400-12-1-2005">IEC 61400-12-1:2005</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Sector Width</Label>
              <Select value={String(config.sectorWidth)} onValueChange={v => updateConfig({ sectorWidth: Number(v) as 10 | 20 })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10° (36 sectors)</SelectItem>
                  <SelectItem value="20">20° (18 sectors)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assess-radius">Assessment Radius (m)</Label>
              <Input id="assess-radius" type="number" value={config.assessmentRadius}
                onChange={e => updateConfig({ assessmentRadius: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="min-dist-d">Min Distance (D)</Label>
              <Input id="min-dist-d" type="number" step="0.5" value={config.minDistanceD}
                onChange={e => updateConfig({ minDistanceD: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slope-simple">Max Slope - Simple (°)</Label>
              <Input id="slope-simple" type="number" step="0.5" value={config.maxSlopeSimple}
                onChange={e => updateConfig({ maxSlopeSimple: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slope-complex">Max Slope - Complex (°)</Label>
              <Input id="slope-complex" type="number" step="0.5" value={config.maxSlopeComplex}
                onChange={e => updateConfig({ maxSlopeComplex: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wake-angle">Wake Angle Threshold (°)</Label>
              <Input id="wake-angle" type="number" step="5" value={config.wakeAngularThreshold}
                onChange={e => updateConfig({ wakeAngularThreshold: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wake-dist">Wake Distance (D)</Label>
              <Input id="wake-dist" type="number" step="1" value={config.wakeDistanceThresholdD}
                onChange={e => updateConfig({ wakeDistanceThresholdD: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <Switch checked={config.includeExternalLayouts}
              onCheckedChange={v => updateConfig({ includeExternalLayouts: v })} />
            <Label>Include external wind farm layouts in wake analysis</Label>
          </div>
        </CardContent>
      </Card>

      {/* Data Upload */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Mast Upload */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-4 w-4 text-red-500" />
                Meteorological Masts
              </CardTitle>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => downloadTemplate('mast')}>
                  <Download className="h-3 w-3 mr-1" /> Template
                </Button>
                <Button variant="outline" size="sm" onClick={() => mastFileRef.current?.click()}>
                  <Upload className="h-3 w-3 mr-1" /> Upload
                </Button>
                <input ref={mastFileRef} type="file" accept=".csv" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleCSVUpload(e.target.files[0], 'mast') }} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {mastErrors.length > 0 && (
              <Alert variant="destructive" className="mb-3">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{mastErrors.join('; ')}</AlertDescription>
              </Alert>
            )}
            {masts.length === 0 ? (
              <div className="upload-zone" onClick={() => mastFileRef.current?.click()}>
                <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                <p className="text-sm text-slate-500">Drop CSV file or click to upload mast data</p>
                <p className="text-xs text-slate-400 mt-1">Required: name, latitude, longitude, mastHeight</p>
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto wind-scrollbar rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Lat</TableHead>
                      <TableHead className="text-xs">Lon</TableHead>
                      <TableHead className="text-xs">Height (m)</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {masts.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium text-xs">{m.name}</TableCell>
                        <TableCell className="text-xs">{m.location.latitude.toFixed(4)}</TableCell>
                        <TableCell className="text-xs">{m.location.longitude.toFixed(4)}</TableCell>
                        <TableCell className="text-xs">{m.mastHeight}</TableCell>
                        <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{m.type}</Badge></TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                            onClick={() => dispatch({ type: 'REMOVE_MAST', payload: m.id })}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-2">{masts.length} mast(s) loaded</p>
          </CardContent>
        </Card>

        {/* WTG Upload */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-4 w-4 text-sky-500" />
                Wind Turbines (WTGs)
              </CardTitle>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => downloadTemplate('wtg')}>
                  <Download className="h-3 w-3 mr-1" /> Template
                </Button>
                <Button variant="outline" size="sm" onClick={() => wtgFileRef.current?.click()}>
                  <Upload className="h-3 w-3 mr-1" /> Upload
                </Button>
                <input ref={wtgFileRef} type="file" accept=".csv" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) handleCSVUpload(e.target.files[0], 'wtg') }} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {wtgErrors.length > 0 && (
              <Alert variant="destructive" className="mb-3">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{wtgErrors.join('; ')}</AlertDescription>
              </Alert>
            )}
            {wtgs.length === 0 ? (
              <div className="upload-zone" onClick={() => wtgFileRef.current?.click()}>
                <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                <p className="text-sm text-slate-500">Drop CSV file or click to upload WTG data</p>
                <p className="text-xs text-slate-400 mt-1">Required: name, latitude, longitude, rotorDiameter, hubHeight</p>
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto wind-scrollbar rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">RD (m)</TableHead>
                      <TableHead className="text-xs">HH (m)</TableHead>
                      <TableHead className="text-xs">Target</TableHead>
                      <TableHead className="text-xs">Power</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {wtgs.map(w => (
                      <TableRow key={w.id}>
                        <TableCell className="font-medium text-xs">{w.name}</TableCell>
                        <TableCell className="text-xs">{w.rotorDiameter}</TableCell>
                        <TableCell className="text-xs">{w.hubHeight}</TableCell>
                        <TableCell className="text-xs">
                          <Badge className={w.isTarget !== false ? 'badge-valid text-[10px]' : 'badge-info text-[10px]'}>
                            {w.isTarget !== false ? 'Target' : 'Non-target'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{w.ratedPower ? `${(w.ratedPower / 1000).toFixed(0)} MW` : '-'}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                            onClick={() => dispatch({ type: 'REMOVE_WTG', payload: w.id })}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-2">
              {wtgs.length} WTG(s) loaded &middot; {wtgs.filter(w => w.isTarget !== false).length} target, {wtgs.filter(w => w.isTarget === false).length} non-target
            </p>
          </CardContent>
        </Card>
      </div>

      {/* External Wind Farm */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-4 w-4 text-orange-500" />
                External Wind Farm Layout
              </CardTitle>
              <CardDescription>Optional: nearby wind farms that may cause wake effects</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => extFileRef.current?.click()}>
                <Upload className="h-3 w-3 mr-1" /> Upload External WTGs
              </Button>
              <input ref={extFileRef} type="file" accept=".csv" className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleCSVUpload(e.target.files[0], 'ext') }} />
              {externalWindFarms.length > 0 && (
                <Button variant="outline" size="sm" className="text-red-500" onClick={() => dispatch({ type: 'SET_EXTERNAL_FARMS', payload: [] })}>
                  <Trash2 className="h-3 w-3 mr-1" /> Clear All
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {extErrors.length > 0 && (
            <Alert variant="destructive" className="mb-3">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{extErrors.join('; ')}</AlertDescription>
            </Alert>
          )}
          {externalWindFarms.length === 0 ? (
            <div className="upload-zone" onClick={() => extFileRef.current?.click()}>
              <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 text-slate-400" />
              <p className="text-sm text-slate-500">Upload external wind farm layout (same CSV format as WTGs)</p>
            </div>
          ) : (
            <div className="space-y-3">
              {externalWindFarms.map(farm => (
                <div key={farm.id} className="border rounded-lg p-3">
                  <p className="text-sm font-medium text-slate-700">{farm.name} ({farm.turbines.length} turbines)</p>
                  {farm.description && <p className="text-xs text-slate-500">{farm.description}</p>}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {farm.turbines.map(t => (
                      <Badge key={t.id} variant="outline" className="text-[10px]">{t.name}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Warnings */}
      {warnings.length > 0 && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800">Validation Warnings</AlertTitle>
          <AlertDescription className="text-amber-700">
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              {warnings.map((w, i) => (
                <li key={i} className="text-xs">{w.message} {w.suggestion && <span className="text-amber-600">→ {w.suggestion}</span>}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Analysis Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Action Bar */}
      <Card className="border-slate-300">
        <CardContent className="py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => setShowSampleConfirm(true)} disabled={isLoading}>
                <Database className="h-4 w-4 mr-2" />
                Load Sample Demo Data
              </Button>
              {showSampleConfirm && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Replace current data with sample?</span>
                  <Button size="sm" className="h-7" onClick={loadSampleData}>Yes, Load</Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowSampleConfirm(false)}>Cancel</Button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              {analysisRun && (
                <span className="flex items-center gap-1 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Analysis complete
                </span>
              )}
              <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!canRun || isLoading} onClick={onRunAnalysis}>
                {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                {isLoading ? 'Running Analysis...' : 'Run Terrain Analysis'}
              </Button>
            </div>
          </div>
          {!canRun && (
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
              <Info className="h-3 w-3" /> Requires: project name, at least 1 mast, and at least 1 WTG
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
