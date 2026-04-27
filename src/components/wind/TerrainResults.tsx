// ============================================================
// Tab 3: Terrain Assessment Results
// ============================================================
'use client'

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useAppState } from './WindContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  BarChart3, AlertTriangle, CheckCircle2, XCircle, Info, Compass, Mountain,
  ArrowRight
} from 'lucide-react'
import type { TerrainAssessmentResult, SectorAnalysis, TerrainProfile } from '@/lib/wind'

export default function TerrainResults() {
  const { state, dispatch } = useAppState()
  const { terrainResults, activePairKey } = state

  // Generate pair options
  const pairOptions = useMemo(() => {
    return terrainResults.map(r => ({
      key: `${r.metadata.mastId}:${r.metadata.targetWtgId}`,
      label: `${r.metadata.mastName} → ${r.metadata.targetWtgName}`,
      mastId: r.metadata.mastId,
      wtgId: r.metadata.targetWtgId,
    }))
  }, [terrainResults])

  const activeResult = useMemo(() => {
    if (!activePairKey && pairOptions.length > 0) return terrainResults[0]
    return terrainResults.find(r =>
      `${r.metadata.mastId}:${r.metadata.targetWtgId}` === activePairKey
    ) || terrainResults[0]
  }, [terrainResults, activePairKey, pairOptions])

  const [selectedSector, setSelectedSector] = useState<number>(0)

  // Get the terrain profile for selected sector
  const activeProfile = useMemo(() => {
    if (!activeResult) return null
    return activeResult.terrainProfiles?.find(p => p.direction === selectedSector) || null
  }, [activeResult, selectedSector])

  // Polar plot canvas
  const polarCanvasRef = useRef<HTMLCanvasElement>(null)
  // Terrain profile canvas
  const profileCanvasRef = useRef<HTMLCanvasElement>(null)

  // Draw polar plot
  useEffect(() => {
    const canvas = polarCanvasRef.current
    if (!canvas || !activeResult) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = 400
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const maxR = size / 2 - 50

    // Background
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, size, size)

    // Concentric circles
    for (let i = 1; i <= 4; i++) {
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.arc(cx, cy, maxR * (i / 4), 0, Math.PI * 2)
      ctx.stroke()
    }

    // Radial lines and direction labels
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    for (let i = 0; i < 8; i++) {
      const angle = (i * 45 - 90) * Math.PI / 180
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR)
      ctx.stroke()
      ctx.fillStyle = '#64748b'
      ctx.font = '10px system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const lx = cx + Math.cos(angle) * (maxR + 18)
      const ly = cy + Math.sin(angle) * (maxR + 18)
      ctx.fillText(directions[i], lx, ly)
    }

    // Draw sectors
    const numSectors = activeResult.metadata.numSectors
    const sectorWidthRad = (activeResult.metadata.sectorWidth * Math.PI) / 180

    activeResult.sectors.forEach((sector, idx) => {
      const midAngle = (sector.direction - 90) * Math.PI / 180
      const startAngle = midAngle - sectorWidthRad / 2
      const endAngle = midAngle + sectorWidthRad / 2

      let color: string
      if (sector.isValid && sector.isFreestream) {
        color = '#059669' // green
      } else if (sector.isValid && !sector.isFreestream) {
        color = '#d97706' // amber
      } else {
        color = '#dc2626' // red
      }

      // Find selected pair bearing direction and highlight
      const bearing = activeResult.distance.bearing
      const bearingAngle = (bearing - 90) * Math.PI / 180
      const angDiff = Math.abs(((midAngle - bearingAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      const isSelectedSector = angDiff < sectorWidthRad

      ctx.fillStyle = color
      ctx.globalAlpha = isSelectedSector ? 0.9 : 0.6
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, maxR, startAngle, endAngle)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1

      // Sector border
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(startAngle) * maxR, cy + Math.sin(startAngle) * maxR)
      ctx.stroke()
    })

    // Bearing arrow (mast → WTG)
    const bearingAngle = (activeResult.distance.bearing - 90) * Math.PI / 180
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(bearingAngle) * maxR * 1.05, cy + Math.sin(bearingAngle) * maxR * 1.05)
    ctx.stroke()
    ctx.setLineDash([])

    // Arrow head
    const ax = cx + Math.cos(bearingAngle) * maxR * 1.05
    const ay = cy + Math.sin(bearingAngle) * maxR * 1.05
    ctx.fillStyle = '#0f172a'
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax - 6 * Math.cos(bearingAngle - 0.3), ay - 6 * Math.sin(bearingAngle - 0.3))
    ctx.lineTo(ax - 6 * Math.cos(bearingAngle + 0.3), ay - 6 * Math.sin(bearingAngle + 0.3))
    ctx.closePath()
    ctx.fill()

    // Center dot
    ctx.fillStyle = '#0f172a'
    ctx.beginPath()
    ctx.arc(cx, cy, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'white'
    ctx.beginPath()
    ctx.arc(cx, cy, 2, 0, Math.PI * 2)
    ctx.fill()

  }, [activeResult])

  // Draw terrain profile
  useEffect(() => {
    const canvas = profileCanvasRef.current
    if (!canvas || !activeResult) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = 600
    const H = 200
    const dpr = window.devicePixelRatio || 1
    canvas.width = W * dpr
    canvas.height = H * dpr
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    ctx.scale(dpr, dpr)

    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, W, H)

    if (!activeProfile || activeProfile.distance.length === 0) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText('No terrain profile data for selected sector', W / 2, H / 2)
      return
    }

    const padding = { top: 20, right: 20, bottom: 30, left: 50 }
    const plotW = W - padding.left - padding.right
    const plotH = H - padding.top - padding.bottom

    const dists = activeProfile.distance
    const elevs = activeProfile.elevation
    const maxDist = Math.max(...dists)
    const minElev = Math.min(...elevs)
    const maxElev = Math.max(...elevs)
    const elevRange = maxElev - minElev || 1

    const toX = (d: number) => padding.left + (d / maxDist) * plotW
    const toY = (e: number) => padding.top + (1 - (e - minElev) / elevRange) * plotH

    // Grid
    ctx.strokeStyle = '#f1f5f9'
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (plotH / 5) * i
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(W - padding.right, y)
      ctx.stroke()
    }
    for (let i = 0; i <= 5; i++) {
      const x = padding.left + (plotW / 5) * i
      ctx.beginPath()
      ctx.moveTo(x, padding.top)
      ctx.lineTo(x, H - padding.bottom)
      ctx.stroke()
    }

    // Slope coloring - green for ok, red for steep
    const slopes = activeProfile.slope
    const maxSlopeThreshold = state.config.maxSlopeSimple

    for (let i = 0; i < dists.length - 1; i++) {
      const slope = Math.abs(slopes[i] || 0)
      const slopeDeg = Math.atan(slope / 100) * (180 / Math.PI)
      if (slopeDeg > maxSlopeThreshold) {
        ctx.fillStyle = 'rgba(220, 38, 38, 0.15)'
        ctx.fillRect(toX(dists[i]), padding.top, toX(dists[i + 1]) - toX(dists[i]), plotH)
      }
    }

    // Terrain fill
    ctx.fillStyle = '#e2e8f0'
    ctx.beginPath()
    ctx.moveTo(toX(dists[0]), toY(elevs[0]))
    for (let i = 1; i < dists.length; i++) {
      ctx.lineTo(toX(dists[i]), toY(elevs[i]))
    }
    ctx.lineTo(toX(dists[dists.length - 1]), H - padding.bottom)
    ctx.lineTo(toX(dists[0]), H - padding.bottom)
    ctx.closePath()
    ctx.fill()

    // Terrain line
    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(toX(dists[0]), toY(elevs[0]))
    for (let i = 1; i < dists.length; i++) {
      ctx.lineTo(toX(dists[i]), toY(elevs[i]))
    }
    ctx.stroke()

    // Mast position marker
    ctx.fillStyle = '#ef4444'
    ctx.beginPath()
    ctx.arc(toX(dists[0]) + 8, toY(elevs[0]) - 8, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#991b1b'
    ctx.font = 'bold 9px system-ui'
    ctx.textAlign = 'left'
    ctx.fillText('Mast', toX(dists[0]) + 14, toY(elevs[0]) - 5)

    // Axis labels
    ctx.fillStyle = '#64748b'
    ctx.font = '9px system-ui'
    ctx.textAlign = 'center'
    for (let i = 0; i <= 5; i++) {
      const x = padding.left + (plotW / 5) * i
      ctx.fillText(`${Math.round(maxDist / 5 * i)}m`, x, H - 10)
    }
    ctx.textAlign = 'right'
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (plotH / 5) * i
      const elev = maxElev - (elevRange / 5) * i
      ctx.fillText(`${elev.toFixed(0)}m`, padding.left - 5, y + 3)
    }

    // Title
    ctx.fillStyle = '#334155'
    ctx.font = 'bold 10px system-ui'
    ctx.textAlign = 'left'
    ctx.fillText(`Terrain Profile — Sector ${selectedSector}°`, padding.left, 12)

    // Red zone label
    ctx.fillStyle = '#dc2626'
    ctx.font = '8px system-ui'
    ctx.textAlign = 'right'
    ctx.fillText(`Red zone: slope > ${maxSlopeThreshold}°`, W - padding.right, 12)
  }, [activeResult, activeProfile, selectedSector, state.config.maxSlopeSimple])

  if (terrainResults.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Mountain className="h-12 w-12 text-slate-300 mb-4" />
        <h3 className="text-lg font-semibold text-slate-500">No Terrain Results</h3>
        <p className="text-sm text-slate-400 mt-1">Run the terrain analysis from Project Setup to see results here.</p>
      </div>
    )
  }

  const result = activeResult
  if (!result) return null

  const summary = result.summary

  return (
    <div className="space-y-6">
      {/* Pair selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <Label className="text-sm font-medium">Select Mast → WTG Pair:</Label>
        <Select value={activePairKey || pairOptions[0]?.key || ''} onValueChange={v => {
          dispatch({ type: 'SET_ACTIVE_PAIR', payload: v })
          setSelectedSector(0)
        }}>
          <SelectTrigger className="w-[300px]">
            <SelectValue placeholder="Select pair" />
          </SelectTrigger>
          <SelectContent>
            {pairOptions.map(opt => (
              <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Distance" value={`${summary.minDistance.toFixed(0)}m`} sub={`${summary.minDistanceInD.toFixed(1)}D`} />
        <MetricCard label="Terrain Class" value={summary.terrainClass} sub={summary.terrainClassification} color={summary.terrainClass === 'A' ? 'text-emerald-600' : summary.terrainClass === 'B' ? 'text-amber-600' : 'text-red-600'} />
        <MetricCard label="Max Valid Slope" value={`${summary.maxValidSlopeDeg.toFixed(1)}°`} sub={`${summary.maxValidSlope.toFixed(1)}%`} />
        <MetricCard label="Valid Sectors" value={`${summary.validSectorsCount}/${summary.totalSectors}`} sub={`${summary.validSectorPercentage.toFixed(1)}%`} color={summary.validSectorPercentage >= 50 ? 'text-emerald-600' : 'text-amber-600'} />
        <MetricCard label="Freestream" value={`${summary.freestreamSectorsCount}`} sub={`${((summary.freestreamSectorsCount / summary.totalSectors) * 100).toFixed(1)}%`} />
        <MetricCard label="IEC Compliant" value={summary.isIECCompliant ? 'Yes' : 'No'} color={summary.isIECCompliant ? 'text-emerald-600' : 'text-red-600'} icon={summary.isIECCompliant ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />} />
      </div>

      {/* Valid sector percentage bar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">Sector Coverage</span>
            <span className="text-sm font-bold text-slate-800">{summary.validSectorPercentage.toFixed(1)}% valid</span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
            <div className="bg-emerald-500 transition-all" style={{ width: `${summary.validSectorPercentage}%` }}></div>
            <div className="bg-amber-400 transition-all" style={{ width: `${((summary.totalSectors - summary.invalidSectorsCount - summary.validSectorsCount) / summary.totalSectors) * 100}%` }}></div>
            <div className="bg-red-400 transition-all" style={{ width: `${(summary.invalidSectorsCount / summary.totalSectors) * 100}%` }}></div>
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span> Valid + Freestream</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span> Valid (Wake)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span> Invalid</span>
          </div>
        </CardContent>
      </Card>

      {/* Polar plot and terrain profile */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Compass className="h-4 w-4 text-emerald-600" />
              Sector Classification Polar Plot
            </CardTitle>
            <CardDescription className="text-xs">
              {result.metadata.mastName} → {result.metadata.targetWtgName}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <canvas ref={polarCanvasRef} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Mountain className="h-4 w-4 text-emerald-600" />
                Terrain Profile
              </CardTitle>
              <Select value={String(selectedSector)} onValueChange={v => setSelectedSector(Number(v))}>
                <SelectTrigger className="w-[100px] h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {result.sectors.map(s => (
                    <SelectItem key={s.direction} value={String(s.direction)}>{s.direction}°</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <CardDescription className="text-xs">
              Direction: {selectedSector}° | Max slope: {result.sectors[selectedSector]?.maxSlopeDeg.toFixed(1)}°
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <canvas ref={profileCanvasRef} />
          </CardContent>
        </Card>
      </div>

      {/* Detailed sector table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-600" />
            Detailed Sector Analysis ({result.metadata.numSectors} sectors × {result.metadata.sectorWidth}°)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[400px] overflow-y-auto wind-scrollbar rounded border">
            <Table className="wind-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky top-0 z-10 w-[60px]">Dir°</TableHead>
                  <TableHead className="sticky top-0 z-10">Max Slope (%)</TableHead>
                  <TableHead className="sticky top-0 z-10">Max Slope (°)</TableHead>
                  <TableHead className="sticky top-0 z-10">Avg Slope (%)</TableHead>
                  <TableHead className="sticky top-0 z-10">Δ Elev (m)</TableHead>
                  <TableHead className="sticky top-0 z-10">Roughness z₀</TableHead>
                  <TableHead className="sticky top-0 z-10">Class</TableHead>
                  <TableHead className="sticky top-0 z-10">Valid</TableHead>
                  <TableHead className="sticky top-0 z-10">Freestream</TableHead>
                  <TableHead className="sticky top-0 z-10">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.sectors.map(sector => (
                  <TableRow
                    key={sector.direction}
                    className={`cursor-pointer ${selectedSector === sector.direction ? 'bg-emerald-50' : ''}`}
                    onClick={() => setSelectedSector(sector.direction)}
                  >
                    <TableCell className="font-mono font-medium">{sector.direction}</TableCell>
                    <TableCell>
                      <span className={sector.maxSlopeDeg > state.config.maxSlopeSimple ? 'text-red-600 font-medium' : ''}>
                        {sector.maxSlope.toFixed(1)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={sector.maxSlopeDeg > state.config.maxSlopeSimple ? 'text-red-600 font-medium' : ''}>
                        {sector.maxSlopeDeg.toFixed(1)}
                      </span>
                    </TableCell>
                    <TableCell>{sector.avgSlope.toFixed(2)}</TableCell>
                    <TableCell>{sector.maxElevationChange.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs">{sector.roughness.z0.toFixed(4)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${
                        sector.terrainClass === 'A' ? 'badge-valid' : sector.terrainClass === 'B' ? 'badge-warning' : 'badge-invalid'
                      }`}>
                        {sector.terrainClass}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {sector.isValid ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </TableCell>
                    <TableCell>
                      {sector.isFreestream ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Badge variant="outline" className="text-[10px] badge-warning">Wake</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="text-[10px]">
                        {sector.failureReasons.length > 0 ? (
                          sector.failureReasons.map((r, i) => (
                            <p key={i} className="text-red-500">{r}</p>
                          ))
                        ) : (
                          <span className="text-emerald-600">OK</span>
                        )}
                        {!sector.isFreestream && sector.wakeAffectedTurbines.length > 0 && (
                          <p className="text-amber-600 mt-0.5">
                            Wake: {sector.wakeAffectedTurbines.join(', ')}
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* IEC Compliance Notes */}
      {summary.complianceNotes.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-800">
              <Info className="h-4 w-4" />
              IEC Compliance Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {summary.complianceNotes.map((note, i) => (
                <li key={i} className="text-xs text-amber-700 flex items-start gap-2">
                  <span className="mt-0.5">&#8226;</span>
                  {note}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function MetricCard({ label, value, sub, color = 'text-slate-800', icon }: {
  label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode
}) {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-1">
        <span className="metric-label">{label}</span>
        {icon}
      </div>
      <p className={`metric-value ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}
