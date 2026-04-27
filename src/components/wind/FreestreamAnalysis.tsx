// ============================================================
// Tab 5: Freestream Analysis
// ============================================================
'use client'

import React, { useRef, useEffect, useState, useMemo } from 'react'
import { useAppState } from './WindContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Wind, AlertTriangle, CheckCircle2, XCircle, Waves, Info, Compass
} from 'lucide-react'
import type { FreestreamResult, SectorWakeAnalysis } from '@/lib/wind'

export default function FreestreamAnalysis() {
  const { state } = useAppState()
  const { freestreamResults } = state

  const [selectedMastIdx, setSelectedMastIdx] = useState(0)

  const activeFreestream = useMemo(() => {
    if (freestreamResults.length === 0) return null
    return freestreamResults[selectedMastIdx] || freestreamResults[0]
  }, [freestreamResults, selectedMastIdx])

  const polarCanvasRef = useRef<HTMLCanvasElement>(null)
  const wakeRoseCanvasRef = useRef<HTMLCanvasElement>(null)

  // Draw freestream polar plot
  useEffect(() => {
    const canvas = polarCanvasRef.current
    if (!canvas || !activeFreestream) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = 350
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const maxR = size / 2 - 45

    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, size, size)

    // Grid circles
    for (let i = 1; i <= 4; i++) {
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.arc(cx, cy, maxR * (i / 4), 0, Math.PI * 2)
      ctx.stroke()
    }

    // Direction lines and labels
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
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
      ctx.fillText(dirs[i], cx + Math.cos(angle) * (maxR + 15), cy + Math.sin(angle) * (maxR + 15))
    }

    const sectorWidth = activeFreestream.sectorWakeAnalysis.length > 0
      ? (activeFreestream.sectorWakeAnalysis[1]?.direction || 10) - (activeFreestream.sectorWakeAnalysis[0]?.direction || 0) || 10
      : 10

    // Draw sectors
    activeFreestream.sectorWakeAnalysis.forEach(swa => {
      const midAngle = (swa.direction - 90) * Math.PI / 180
      const sectorWidthRad = (sectorWidth * Math.PI) / 180
      const startAngle = midAngle - sectorWidthRad / 2
      const endAngle = midAngle + sectorWidthRad / 2

      let color: string
      if (swa.isFreestream) {
        color = '#059669' // green
      } else if (swa.combinedWakeImpact === 'low') {
        color = '#f59e0b' // amber
      } else if (swa.combinedWakeImpact === 'medium') {
        color = '#f97316' // orange
      } else {
        color = '#dc2626' // red
      }

      ctx.fillStyle = color
      ctx.globalAlpha = 0.6
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

    // Center dot
    ctx.fillStyle = '#0f172a'
    ctx.beginPath()
    ctx.arc(cx, cy, 4, 0, Math.PI * 2)
    ctx.fill()
  }, [activeFreestream])

  // Draw wake rose diagram
  useEffect(() => {
    const canvas = wakeRoseCanvasRef.current
    if (!canvas || !activeFreestream) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = 350
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const maxR = size / 2 - 45

    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, size, size)

    // Grid circles
    for (let i = 1; i <= 4; i++) {
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.arc(cx, cy, maxR * (i / 4), 0, Math.PI * 2)
      ctx.stroke()
    }

    // Direction lines and labels
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
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
      ctx.fillText(dirs[i], cx + Math.cos(angle) * (maxR + 15), cy + Math.sin(angle) * (maxR + 15))
    }

    const sectorWidth = activeFreestream.sectorWakeAnalysis.length > 0
      ? (activeFreestream.sectorWakeAnalysis[1]?.direction || 10) - (activeFreestream.sectorWakeAnalysis[0]?.direction || 0) || 10
      : 10
    const maxSources = Math.max(1, ...activeFreestream.sectorWakeAnalysis.map(s => s.wakeSourceTurbines.length))

    // Draw wake rose bars (number of wake sources per sector)
    activeFreestream.sectorWakeAnalysis.forEach(swa => {
      if (swa.wakeSourceTurbines.length === 0) return
      const midAngle = (swa.direction - 90) * Math.PI / 180
      const sectorWidthRad = (sectorWidth * Math.PI) / 180
      const startAngle = midAngle - sectorWidthRad / 2
      const endAngle = midAngle + sectorWidthRad / 2

      const barR = maxR * (swa.wakeSourceTurbines.length / maxSources)

      let color: string
      if (swa.combinedWakeImpact === 'high') color = '#dc2626'
      else if (swa.combinedWakeImpact === 'medium') color = '#f97316'
      else color = '#f59e0b'

      ctx.fillStyle = color
      ctx.globalAlpha = 0.7
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, barR, startAngle, endAngle)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1

      // Source count label
      if (swa.wakeSourceTurbines.length > 0) {
        const labelR = barR * 0.6
        const lx = cx + Math.cos(midAngle) * labelR
        const ly = cy + Math.sin(midAngle) * labelR
        ctx.fillStyle = 'white'
        ctx.font = 'bold 9px system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(swa.wakeSourceTurbines.length), lx, ly)
      }
    })

    // Center dot
    ctx.fillStyle = '#0f172a'
    ctx.beginPath()
    ctx.arc(cx, cy, 4, 0, Math.PI * 2)
    ctx.fill()

    // Max sources label
    ctx.fillStyle = '#94a3b8'
    ctx.font = '9px system-ui'
    ctx.textAlign = 'left'
    ctx.fillText(`Max sources: ${maxSources}`, 10, size - 10)
  }, [activeFreestream])

  if (freestreamResults.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Waves className="h-12 w-12 text-slate-300 mb-4" />
        <h3 className="text-lg font-semibold text-slate-500">No Freestream Results</h3>
        <p className="text-sm text-slate-400 mt-1">Run the terrain analysis to see freestream analysis results.</p>
      </div>
    )
  }

  const fr = activeFreestream
  if (!fr) return null

  return (
    <div className="space-y-6">
      {/* Mast selector */}
      <div className="flex items-center gap-3">
        <Label className="text-sm font-medium">Select Mast:</Label>
        <Select value={String(selectedMastIdx)} onValueChange={v => setSelectedMastIdx(Number(v))}>
          <SelectTrigger className="w-[250px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {freestreamResults.map((fr, i) => (
              <SelectItem key={fr.mastId} value={String(i)}>{fr.mastName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-3 ml-auto">
          <Badge className={fr.freestreamPercentage >= 50 ? 'badge-valid' : 'badge-warning'}>
            {fr.freestreamPercentage.toFixed(1)}% Freestream
          </Badge>
          <Badge variant="outline">
            {fr.freestreamSectors.length} freestream / {fr.wakeAffectedSectors.length} wake-affected
          </Badge>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="metric-card">
          <p className="metric-label">Total Sectors</p>
          <p className="metric-value">{fr.sectorWakeAnalysis.length}</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Freestream</p>
          <p className="metric-value text-emerald-600">{fr.freestreamSectors.length}</p>
          <p className="text-xs text-slate-400">{fr.freestreamPercentage.toFixed(1)}% of total</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Wake-Affected</p>
          <p className="metric-value text-amber-600">{fr.wakeAffectedSectors.length}</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">External WTGs</p>
          <p className="metric-value text-orange-600">{fr.externalWtgs.length}</p>
          <p className="text-xs text-slate-400">Upstream turbines from external farms</p>
        </div>
      </div>

      {/* Polar plots */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Compass className="h-4 w-4 text-emerald-600" />
              Freestream Sector Map
            </CardTitle>
            <CardDescription className="text-xs">{fr.mastName}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <canvas ref={polarCanvasRef} />
            <div className="flex flex-wrap gap-3 mt-3 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block"></span> Freestream</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block"></span> Low Impact</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-orange-500 inline-block"></span> Medium Impact</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-600 inline-block"></span> High Impact</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Waves className="h-4 w-4 text-emerald-600" />
              Wake Source Rose Diagram
            </CardTitle>
            <CardDescription className="text-xs">Number of upstream turbines per sector</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <canvas ref={wakeRoseCanvasRef} />
          </CardContent>
        </Card>
      </div>

      {/* External WTGs table */}
      {fr.externalWtgs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wind className="h-4 w-4 text-orange-500" />
              External WTG Wake Sources
            </CardTitle>
            <CardDescription className="text-xs">Turbines from external wind farms affecting measurement sectors</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[200px] overflow-y-auto wind-scrollbar rounded border">
              <Table className="wind-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10">Name</TableHead>
                    <TableHead className="sticky top-0 z-10">Direction</TableHead>
                    <TableHead className="sticky top-0 z-10">Distance</TableHead>
                    <TableHead className="sticky top-0 z-10">Distance (D)</TableHead>
                    <TableHead className="sticky top-0 z-10">Affected Sectors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fr.externalWtgs.map(ew => (
                    <TableRow key={ew.id}>
                      <TableCell className="font-medium text-xs text-orange-700">{ew.name}</TableCell>
                      <TableCell className="text-xs font-mono">{ew.direction.toFixed(0)}°</TableCell>
                      <TableCell className="text-xs">{ew.distance.toFixed(0)}m</TableCell>
                      <TableCell className="text-xs">{ew.distanceInD.toFixed(1)}D</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-wrap gap-1">
                          {ew.affectingSectors.map(s => (
                            <Badge key={s} variant="outline" className="text-[9px] px-1 py-0">{s}°</Badge>
                          ))}
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

      {/* Sector-by-sector wake breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Waves className="h-4 w-4 text-emerald-600" />
            Sector Wake Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[300px] overflow-y-auto wind-scrollbar rounded border">
            <Table className="wind-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky top-0 z-10 w-[60px]">Dir°</TableHead>
                  <TableHead className="sticky top-0 z-10">Status</TableHead>
                  <TableHead className="sticky top-0 z-10">Impact</TableHead>
                  <TableHead className="sticky top-0 z-10">Wake Sources</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fr.sectorWakeAnalysis.map(swa => (
                  <TableRow key={swa.direction}>
                    <TableCell className="font-mono font-medium">{swa.direction}</TableCell>
                    <TableCell>
                      {swa.isFreestream ? (
                        <Badge className="badge-valid text-[10px]">Freestream</Badge>
                      ) : (
                        <Badge className="badge-warning text-[10px]">Wake</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${
                        swa.combinedWakeImpact === 'none' ? 'badge-valid' :
                        swa.combinedWakeImpact === 'low' ? 'badge-warning' :
                        swa.combinedWakeImpact === 'medium' ? 'border-orange-300 text-orange-700 bg-orange-50' :
                        'badge-invalid'
                      }`}>
                        {swa.combinedWakeImpact}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs max-w-[300px]">
                      {swa.wakeSourceTurbines.length > 0 ? (
                        <div className="space-y-0.5">
                          {swa.wakeSourceTurbines.map((wt, i) => (
                            <p key={i} className={wt.isExternal ? 'text-orange-600' : 'text-slate-600'}>
                              {wt.wtgName} ({wt.distanceInD.toFixed(1)}D, ±{wt.angularDeviation.toFixed(0)}°)
                              {wt.isExternal && ' [EXT]'}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <span className="text-emerald-600 text-xs">None</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
