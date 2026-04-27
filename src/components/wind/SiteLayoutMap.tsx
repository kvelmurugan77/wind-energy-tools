// ============================================================
// Tab 2: Site Layout Map (HTML Canvas)
// ============================================================
'use client'

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useAppState } from './WindContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ZoomIn, ZoomOut, RotateCcw, Info, Crosshair
} from 'lucide-react'
import type { MetMast, WTG } from '@/lib/wind'

interface MapViewState {
  centerX: number
  centerY: number
  scale: number
}

export default function SiteLayoutMap() {
  const { state, dispatch } = useAppState()
  const { masts, wtgs, externalWindFarms, terrainResults, activePairKey } = state
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<MapViewState>({ centerX: 0, centerY: 0, scale: 1 })
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })

  // Compute local coordinates
  const getAllPoints = useCallback(() => {
    const all = [
      ...masts.map(m => ({ type: 'mast' as const, item: m, lat: m.location.latitude, lon: m.location.longitude })),
      ...wtgs.map(w => ({ type: 'wtg' as const, item: w, lat: w.location.latitude, lon: w.location.longitude })),
      ...externalWindFarms.flatMap(f => f.turbines.map(t => ({ type: 'ext' as const, item: t, lat: t.location.latitude, lon: t.location.longitude, farm: f.name }))),
    ]
    if (all.length === 0) return { points: [], originLat: 0, originLon: 0 }
    const originLat = Math.min(...all.map(p => p.lat))
    const originLon = Math.min(...all.map(p => p.lon))
    const toRad = (d: number) => d * Math.PI / 180
    const cosLat = Math.cos(toRad(originLat))
    const mPerDeg = 111320
    const points = all.map(p => ({
      ...p,
      x: (p.lon - originLon) * mPerDeg * cosLat,
      y: -(p.lat - originLat) * mPerDeg, // flip Y so north is up
    }))
    return { points, originLat, originLon }
  }, [masts, wtgs, externalWindFarms])

  // Zoom controls
  const zoomIn = () => setView(v => ({ ...v, scale: v.scale * 1.3 }))
  const zoomOut = () => setView(v => ({ ...v, scale: v.scale / 1.3 }))
  const resetView = () => setView({ centerX: 0, centerY: 0, scale: 1 })

  // Parse active pair key (derived from state, no effect needed)
  const selectedPair = useMemo(() => {
    if (!activePairKey) return null
    const parts = activePairKey.split(':')
    if (parts.length === 2) {
      return { mastId: parts[0], wtgId: parts[1] }
    }
    return null
  }, [activePairKey])

  // Resize observer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setCanvasSize({ width: Math.max(width, 400), height: Math.max(height, 400) })
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasSize.width * dpr
    canvas.height = canvasSize.height * dpr
    canvas.style.width = `${canvasSize.width}px`
    canvas.style.height = `${canvasSize.height}px`
    ctx.scale(dpr, dpr)

    const W = canvasSize.width
    const H = canvasSize.height
    const { points, originLat, originLon } = getAllPoints()

    // Clear
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, 0, W, H)

    if (points.length === 0) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '14px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText('No data loaded. Go to "Project Setup" to load masts and WTGs.', W / 2, H / 2)
      return
    }

    // Compute bounds
    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)
    const dataW = Math.max(...xs) - Math.min(...xs) || 1
    const dataH = Math.max(...ys) - Math.min(...ys) || 1
    const padding = 80
    const baseScale = Math.min((W - padding * 2) / dataW, (H - padding * 2) / dataH)
    const scale = baseScale * view.scale
    const dataCenterX = (Math.min(...xs) + Math.max(...xs)) / 2
    const dataCenterY = (Math.min(...ys) + Math.max(...ys)) / 2

    const toCanvasX = (x: number) => W / 2 + (x - dataCenterX - view.centerX) * scale
    const toCanvasY = (y: number) => H / 2 + (y - dataCenterY - view.centerY) * scale

    // Draw grid
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 0.5
    const gridStep = Math.pow(10, Math.floor(Math.log10(500 / scale))) * 10
    for (let gx = Math.floor(Math.min(...xs) / gridStep) * gridStep; gx <= Math.max(...xs) + gridStep; gx += gridStep) {
      const cx = toCanvasX(gx)
      if (cx >= 0 && cx <= W) {
        ctx.beginPath()
        ctx.moveTo(cx, 0)
        ctx.lineTo(cx, H)
        ctx.stroke()
        ctx.fillStyle = '#94a3b8'
        ctx.font = '9px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText(`${Math.round(gx)}m`, cx, H - 5)
      }
    }
    for (let gy = Math.floor(Math.min(...ys) / gridStep) * gridStep; gy <= Math.max(...ys) + gridStep; gy += gridStep) {
      const cy = toCanvasY(gy)
      if (cy >= 0 && cy <= H) {
        ctx.beginPath()
        ctx.moveTo(0, cy)
        ctx.lineTo(W, cy)
        ctx.stroke()
        ctx.fillStyle = '#94a3b8'
        ctx.font = '9px system-ui'
        ctx.textAlign = 'left'
        ctx.fillText(`${Math.round(-gy)}m N`, 5, cy - 3)
      }
    }

    // Draw distance lines between selected mast and WTG
    if (selectedPair) {
      const mastPt = points.find(p => p.type === 'mast' && p.item.id === selectedPair.mastId)
      const wtgPt = points.find(p => p.type === 'wtg' && p.item.id === selectedPair.wtgId)
      if (mastPt && wtgPt) {
        ctx.strokeStyle = '#059669'
        ctx.lineWidth = 2
        ctx.setLineDash([6, 4])
        ctx.beginPath()
        ctx.moveTo(toCanvasX(mastPt.x), toCanvasY(mastPt.y))
        ctx.lineTo(toCanvasX(wtgPt.x), toCanvasY(wtgPt.y))
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // Draw sector visualization for selected pair
    if (selectedPair) {
      const mastPt = points.find(p => p.type === 'mast' && p.item.id === selectedPair.mastId)
      if (mastPt) {
        const result = terrainResults.find(r =>
          r.metadata.mastId === selectedPair.mastId && r.metadata.targetWtgId === selectedPair.wtgId
        )
        if (result) {
          const cx = toCanvasX(mastPt.x)
          const cy = toCanvasY(mastPt.y)
          const sectorRadius = 50 * view.scale
          const sectorWidthRad = (result.metadata.sectorWidth * Math.PI) / 180

          result.sectors.forEach(sector => {
            const startAngle = (sector.direction - result.metadata.sectorWidth / 2 - 90) * Math.PI / 180
            const endAngle = (sector.direction + result.metadata.sectorWidth / 2 - 90) * Math.PI / 180
            let color: string
            if (sector.isValid && sector.isFreestream) {
              color = 'rgba(5, 150, 105, 0.25)' // green
            } else if (sector.isValid) {
              color = 'rgba(217, 119, 6, 0.25)' // yellow/amber
            } else {
              color = 'rgba(220, 38, 38, 0.20)' // red
            }
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.moveTo(cx, cy)
            ctx.arc(cx, cy, sectorRadius, startAngle, endAngle)
            ctx.closePath()
            ctx.fill()
          })
        }
      }
    }

    // Draw distance lines between all masts and target WTGs
    masts.forEach(mast => {
      const mastPt = points.find(p => p.type === 'mast' && p.item.id === mast.id)
      if (!mastPt) return
      wtgs.filter(w => w.isTarget !== false).forEach(wtg => {
        const wtgPt = points.find(p => p.type === 'wtg' && p.item.id === wtg.id)
        if (!wtgPt) return
        ctx.strokeStyle = '#cbd5e1'
        ctx.lineWidth = 0.8
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(toCanvasX(mastPt.x), toCanvasY(mastPt.y))
        ctx.lineTo(toCanvasX(wtgPt.x), toCanvasY(wtgPt.y))
        ctx.stroke()
        ctx.setLineDash([])
      })
    })

    // Draw external WTGs (orange)
    points.filter(p => p.type === 'ext').forEach(p => {
      const wtg = p.item as WTG
      const cx = toCanvasX(p.x)
      const cy = toCanvasY(p.y)
      const r = Math.max(6, (wtg.rotorDiameter / 2) * scale * 0.3)

      // Diamond shape for external
      ctx.fillStyle = 'rgba(249, 115, 22, 0.2)'
      ctx.strokeStyle = '#f97316'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(cx, cy - r)
      ctx.lineTo(cx + r, cy)
      ctx.lineTo(cx, cy + r)
      ctx.lineTo(cx - r, cy)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#78350f'
      ctx.font = `${Math.max(8, 9 * Math.min(view.scale, 1.5))}px system-ui`
      ctx.textAlign = 'center'
      ctx.fillText(wtg.name, cx, cy - r - 5)
    })

    // Draw non-target WTGs (gray)
    points.filter(p => p.type === 'wtg' && (p.item as WTG).isTarget === false).forEach(p => {
      const wtg = p.item as WTG
      const cx = toCanvasX(p.x)
      const cy = toCanvasY(p.y)
      const r = Math.max(5, (wtg.rotorDiameter / 2) * scale * 0.3)

      ctx.fillStyle = 'rgba(148, 163, 184, 0.15)'
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#64748b'
      ctx.font = `${Math.max(8, 9 * Math.min(view.scale, 1.5))}px system-ui`
      ctx.textAlign = 'center'
      ctx.fillText(wtg.name, cx, cy - r - 5)
    })

    // Draw target WTGs (blue circles with rotor diameter)
    points.filter(p => p.type === 'wtg' && (p.item as WTG).isTarget !== false).forEach(p => {
      const wtg = p.item as WTG
      const cx = toCanvasX(p.x)
      const cy = toCanvasY(p.y)
      const r = Math.max(8, (wtg.rotorDiameter / 2) * scale * 0.3)

      // Rotor circle
      ctx.fillStyle = hoveredItem === wtg.id ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.15)'
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Center dot
      ctx.fillStyle = '#1e40af'
      ctx.beginPath()
      ctx.arc(cx, cy, 3, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#1e3a5f'
      ctx.font = `bold ${Math.max(9, 10 * Math.min(view.scale, 1.5))}px system-ui`
      ctx.textAlign = 'center'
      ctx.fillText(wtg.name, cx, cy - r - 6)
    })

    // Draw masts (red triangles)
    points.filter(p => p.type === 'mast').forEach(p => {
      const mast = p.item as MetMast
      const cx = toCanvasX(p.x)
      const cy = toCanvasY(p.y)
      const s = 10

      ctx.fillStyle = hoveredItem === mast.id ? '#dc2626' : '#ef4444'
      ctx.strokeStyle = '#991b1b'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cx, cy - s)
      ctx.lineTo(cx - s * 0.866, cy + s * 0.5)
      ctx.lineTo(cx + s * 0.866, cy + s * 0.5)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#991b1b'
      ctx.font = `bold ${Math.max(9, 10 * Math.min(view.scale, 1.5))}px system-ui`
      ctx.textAlign = 'center'
      ctx.fillText(mast.name, cx, cy - s - 6)
    })

    // Hover tooltip
    if (hoveredItem) {
      const pt = points.find(p => p.item.id === hoveredItem)
      if (pt) {
        const cx = toCanvasX(pt.x)
        const cy = toCanvasY(pt.y)
        let text = ''
        if (pt.type === 'mast') {
          const m = pt.item as MetMast
          text = `${m.name} | ${m.mastHeight}m | ${m.location.latitude.toFixed(4)}, ${m.location.longitude.toFixed(4)}`
        } else {
          const w = pt.item as WTG
          text = `${w.name} | RD: ${w.rotorDiameter}m | HH: ${w.hubHeight}m`
          if (w.ratedPower) text += ` | ${(w.ratedPower / 1000).toFixed(0)}MW`
        }
        ctx.font = '11px system-ui'
        const tm = ctx.measureText(text)
        const tw = tm.width + 16
        const th = 24
        let tx = cx - tw / 2
        let ty = cy - 35
        if (tx < 5) tx = 5
        if (tx + tw > W - 5) tx = W - tw - 5
        if (ty < 5) ty = cy + 20

        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'
        ctx.beginPath()
        ctx.roundRect(tx, ty, tw, th, 4)
        ctx.fill()
        ctx.fillStyle = 'white'
        ctx.textAlign = 'left'
        ctx.fillText(text, tx + 8, ty + 16)
      }
    }

    // Compass
    const compX = W - 50
    const compY = 50
    const compR = 20
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(compX, compY, compR, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    // N arrow
    ctx.fillStyle = '#dc2626'
    ctx.beginPath()
    ctx.moveTo(compX, compY - compR + 3)
    ctx.lineTo(compX - 4, compY)
    ctx.lineTo(compX + 4, compY)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#475569'
    ctx.font = 'bold 10px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText('N', compX, compY - compR - 4)

    // Scale bar
    const scaleBarDist = gridStep
    const scaleBarPx = scaleBarDist * scale
    const sbx = 20
    const sby = H - 25
    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(sbx, sby)
    ctx.lineTo(sbx + scaleBarPx, sby)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(sbx, sby - 4)
    ctx.lineTo(sbx, sby + 4)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(sbx + scaleBarPx, sby - 4)
    ctx.lineTo(sbx + scaleBarPx, sby + 4)
    ctx.stroke()
    ctx.fillStyle = '#475569'
    ctx.font = '10px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText(`${Math.round(scaleBarDist)}m`, sbx + scaleBarPx / 2, sby - 6)

  }, [view, hoveredItem, selectedPair, canvasSize, masts, wtgs, externalWindFarms, terrainResults, getAllPoints])

  // Mouse move for hover
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const { points, originLat, originLon } = getAllPoints()
    if (points.length === 0) return

    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)
    const dataW = Math.max(...xs) - Math.min(...xs) || 1
    const dataH = Math.max(...ys) - Math.min(...ys) || 1
    const W = canvasSize.width
    const H = canvasSize.height
    const padding = 80
    const baseScale = Math.min((W - padding * 2) / dataW, (H - padding * 2) / dataH)
    const scale = baseScale * view.scale
    const dataCenterX = (Math.min(...xs) + Math.max(...xs)) / 2
    const dataCenterY = (Math.min(...ys) + Math.max(...ys)) / 2

    const toCanvasX = (x: number) => W / 2 + (x - dataCenterX - view.centerX) * scale
    const toCanvasY = (y: number) => H / 2 + (y - dataCenterY - view.centerY) * scale

    let found: string | null = null
    for (const p of points) {
      const cx = toCanvasX(p.x)
      const cy = toCanvasY(p.y)
      if (Math.abs(mx - cx) < 15 && Math.abs(my - cy) < 15) {
        found = p.item.id
        break
      }
    }
    setHoveredItem(found)
    canvas.style.cursor = found ? 'pointer' : 'default'
  }, [view, canvasSize, getAllPoints])

  // Click to select pair
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !hoveredItem) return
    const { points } = getAllPoints()
    const hovered = points.find(p => p.item.id === hoveredItem)
    if (!hovered) return

    if (hovered.type === 'mast') {
      // If clicked a mast, try to pair with first target WTG
      const firstTarget = wtgs.find(w => w.isTarget !== false)
      if (firstTarget) {
        const key = `${hovered.item.id}:${firstTarget.id}`
        dispatch({ type: 'SET_ACTIVE_PAIR', payload: key })
      }
    }
  }, [hoveredItem, masts, wtgs, getAllPoints, dispatch])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Crosshair className="h-4 w-4 text-emerald-600" />
              Site Layout Map
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={zoomIn}><ZoomIn className="h-3.5 w-3.5" /></Button>
              <Button variant="outline" size="sm" onClick={zoomOut}><ZoomOut className="h-3.5 w-3.5" /></Button>
              <Button variant="outline" size="sm" onClick={resetView}><RotateCcw className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div ref={containerRef} className="canvas-container" style={{ height: '500px' }}>
            <canvas
              ref={canvasRef}
              onMouseMove={handleMouseMove}
              onClick={handleClick}
              onMouseLeave={() => setHoveredItem(null)}
            />
          </div>
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-slate-600">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 bg-red-500" style={{ clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }}></span>
              Met Mast
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full bg-blue-500/30 border border-blue-500"></span>
              Target WTG
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full bg-slate-400/30 border border-slate-400"></span>
              Non-target WTG
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 bg-orange-500/30 border border-orange-500" style={{ clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }}></span>
              External WTG
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-1 bg-emerald-500"></span>
              Selected Pair
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full bg-emerald-500/30"></span>
              Valid + Freestream
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full bg-amber-500/30"></span>
              Valid (Wake)
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full bg-red-500/25"></span>
              Invalid
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-1">Click on a mast or WTG to select a pair for analysis. Hover for details.</p>
        </CardContent>
      </Card>
    </div>
  )
}
