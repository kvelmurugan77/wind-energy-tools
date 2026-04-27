// ============================================================
// Tab 4: PCV WTG Selection
// ============================================================
'use client'

import React, { useRef, useEffect, useState, useMemo } from 'react'
import { useAppState } from './WindContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Trophy, Star, Target, MapPin, Lightbulb, BarChart3,
  CheckCircle2, ArrowRight, Radar
} from 'lucide-react'
import type { PCVPairing, MastConfiguration, MastProposal } from '@/lib/wind'

export default function PCVSelection() {
  const { state, dispatch } = useAppState()
  const { pcvResults, mastProposals } = state

  const [selectedPairIdx, setSelectedPairIdx] = useState(0)

  const selectedPairing = useMemo(() => {
    if (!pcvResults?.bestPairings?.length) return null
    return pcvResults.bestPairings[selectedPairIdx] || pcvResults.bestPairings[0]
  }, [pcvResults, selectedPairIdx])

  // Radar chart canvas
  const radarCanvasRef = useRef<HTMLCanvasElement>(null)

  // Draw radar chart
  useEffect(() => {
    const canvas = radarCanvasRef.current
    if (!canvas || !selectedPairing) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = 300
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const maxR = 110

    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, size, size)

    const criteria = selectedPairing.criterionScores
    const labels = ['Distance', 'Terrain\nQuality', 'Sector\nCoverage', 'Freestream\nQuality', 'Slope\nCompliance']
    const values = [criteria.distance, criteria.terrainQuality, criteria.sectorCoverage, criteria.freestreamQuality, criteria.slopeCompliance]
    const n = labels.length

    // Grid
    for (let level = 1; level <= 5; level++) {
      const r = maxR * (level / 5)
      ctx.strokeStyle = level === 5 ? '#e2e8f0' : '#f1f5f9'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i / n) - Math.PI / 2
        const x = cx + Math.cos(angle) * r
        const y = cy + Math.sin(angle) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.stroke()
    }

    // Radial lines
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i / n) - Math.PI / 2
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR)
      ctx.stroke()
    }

    // Data polygon
    ctx.fillStyle = 'rgba(5, 150, 105, 0.15)'
    ctx.strokeStyle = '#059669'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i / n) - Math.PI / 2
      const val = Math.min(values[i], 100) / 100
      const x = cx + Math.cos(angle) * maxR * val
      const y = cy + Math.sin(angle) * maxR * val
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    // Data points
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i / n) - Math.PI / 2
      const val = Math.min(values[i], 100) / 100
      const x = cx + Math.cos(angle) * maxR * val
      const y = cy + Math.sin(angle) * maxR * val
      ctx.fillStyle = '#059669'
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'white'
      ctx.beginPath()
      ctx.arc(x, y, 2, 0, Math.PI * 2)
      ctx.fill()
    }

    // Labels
    ctx.fillStyle = '#334155'
    ctx.font = '10px system-ui'
    ctx.textAlign = 'center'
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i / n) - Math.PI / 2
      const lx = cx + Math.cos(angle) * (maxR + 25)
      const ly = cy + Math.sin(angle) * (maxR + 25)
      const lines = labels[i].split('\n')
      lines.forEach((line, li) => {
        ctx.fillText(line, lx, ly + li * 11 - (lines.length - 1) * 5.5)
      })
      // Value
      ctx.fillStyle = '#059669'
      ctx.font = 'bold 10px system-ui'
      ctx.fillText(`${Math.round(values[i])}`, lx, ly + lines.length * 11 - (lines.length - 1) * 5.5)
      ctx.fillStyle = '#334155'
      ctx.font = '10px system-ui'
    }

  }, [selectedPairing])

  if (!pcvResults) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Trophy className="h-12 w-12 text-slate-300 mb-4" />
        <h3 className="text-lg font-semibold text-slate-500">No PCV Results</h3>
        <p className="text-sm text-slate-400 mt-1">Run the terrain analysis to see PCV selection results.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Recommendations */}
      <Alert className="border-emerald-200 bg-emerald-50/50">
        <Lightbulb className="h-4 w-4 text-emerald-600" />
        <AlertTitle className="text-emerald-800">PCV Selection Recommendations</AlertTitle>
        <AlertDescription className="text-emerald-700">
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            {pcvResults.recommendations.map((rec, i) => (
              <li key={i} className="text-xs">{rec}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="metric-card">
          <p className="metric-label">Total Combinations</p>
          <p className="metric-value">{pcvResults.totalCombinations}</p>
          <p className="text-xs text-slate-400">Mast × WTG pairings analyzed</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Configurations</p>
          <p className="metric-value">{pcvResults.configurations.length}</p>
          <p className="text-xs text-slate-400">Mast setup options evaluated</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Top Score</p>
          <p className="metric-value text-emerald-600">{pcvResults.bestPairings[0]?.score.toFixed(1) || '-'}/100</p>
          <p className="text-xs text-slate-400">{pcvResults.bestPairings[0]?.mastName} → {pcvResults.bestPairings[0]?.wtgName}</p>
        </div>
      </div>

      {/* Ranking Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Trophy className="h-4 w-4 text-emerald-600" />
            Mast-WTG Pairing Rankings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[300px] overflow-y-auto wind-scrollbar rounded border">
            <Table className="wind-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky top-0 z-10 w-10">#</TableHead>
                  <TableHead className="sticky top-0 z-10">Mast</TableHead>
                  <TableHead className="sticky top-0 z-10">Target WTG</TableHead>
                  <TableHead className="sticky top-0 z-10">Distance</TableHead>
                  <TableHead className="sticky top-0 z-10">Valid Sectors</TableHead>
                  <TableHead className="sticky top-0 z-10">Freestream</TableHead>
                  <TableHead className="sticky top-0 z-10">Score</TableHead>
                  <TableHead className="sticky top-0 z-10">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pcvResults.bestPairings.map((p, idx) => (
                  <TableRow
                    key={`${p.mastId}-${p.wtgId}`}
                    className={`cursor-pointer ${selectedPairIdx === idx ? 'bg-emerald-50' : ''}`}
                    onClick={() => setSelectedPairIdx(idx)}
                  >
                    <TableCell className="font-bold text-xs">
                      {idx === 0 ? <Trophy className="h-4 w-4 text-amber-500" /> : idx + 1}
                    </TableCell>
                    <TableCell className="font-medium text-xs">{p.mastName}</TableCell>
                    <TableCell className="font-medium text-xs">{p.wtgName}</TableCell>
                    <TableCell className="text-xs">
                      {p.distance.toFixed(0)}m ({p.distanceInD.toFixed(1)}D)
                    </TableCell>
                    <TableCell className="text-xs">{p.validSectors}/{p.totalSectors}</TableCell>
                    <TableCell className="text-xs">{p.freestreamSectors}/{p.totalSectors}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${p.score}%` }}></div>
                        </div>
                        <span className="text-xs font-bold text-slate-700">{p.score.toFixed(1)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.isRecommended ? (
                        <Badge className="badge-valid text-[10px]"><CheckCircle2 className="h-3 w-3 mr-0.5" /> Recommended</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-slate-500">Not recommended</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Radar chart and details for selected pairing */}
      {selectedPairing && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Radar className="h-4 w-4 text-emerald-600" />
                Criterion Scores: {selectedPairing.mastName} → {selectedPairing.wtgName}
              </CardTitle>
              <CardDescription className="text-xs">Overall score: {selectedPairing.score.toFixed(1)}/100</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <canvas ref={radarCanvasRef} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Criterion Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Distance', value: selectedPairing.criterionScores.distance, desc: `Optimal range: 2D–10D. Current: ${selectedPairing.distanceInD.toFixed(1)}D` },
                { label: 'Terrain Quality', value: selectedPairing.criterionScores.terrainQuality, desc: 'Based on valid sector percentage' },
                { label: 'Sector Coverage', value: selectedPairing.criterionScores.sectorCoverage, desc: `${selectedPairing.validSectors}/${selectedPairing.totalSectors} valid sectors` },
                { label: 'Freestream Quality', value: selectedPairing.criterionScores.freestreamQuality, desc: `${selectedPairing.freestreamSectors}/${selectedPairing.totalSectors} freestream sectors` },
                { label: 'Slope Compliance', value: selectedPairing.criterionScores.slopeCompliance, desc: 'Based on average maximum slope' },
              ].map(c => (
                <div key={c.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700">{c.label}</span>
                    <span className="font-bold text-slate-800">{c.value.toFixed(1)}/100</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${c.value >= 70 ? 'bg-emerald-500' : c.value >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${c.value}%` }}></div>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">{c.desc}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Mast Configurations (1 mast → N WTGs) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4 text-emerald-600" />
            Mast Configurations
          </CardTitle>
          <CardDescription>Optimal mast setups for testing multiple WTGs simultaneously</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pcvResults.configurations.map((config, idx) => (
              <div key={idx} className={`p-4 rounded-lg border ${config.isRecommended ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-slate-800">{config.mastName}</span>
                  {config.isRecommended ? (
                    <Badge className="badge-valid text-[10px]"><Star className="h-3 w-3 mr-0.5" /> Best</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">Alternative</Badge>
                  )}
                </div>
                <div className="space-y-2">
                  {config.targetWtgs.map(t => (
                    <div key={t.wtgId} className="flex items-center gap-2 text-xs">
                      <ArrowRight className="h-3 w-3 text-slate-400" />
                      <span className="font-medium">{t.wtgName}</span>
                      <span className="text-slate-400">Score: {t.score.toFixed(1)} | Valid: {t.validSectors}</span>
                    </div>
                  ))}
                </div>
                <Separator className="my-2" />
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold text-slate-800">{config.overallScore.toFixed(1)}</p>
                    <p className="text-[10px] text-slate-400">Overall Score</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-emerald-600">{config.combinedValidSectors}</p>
                    <p className="text-[10px] text-slate-400">Valid Sectors</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-sky-600">{config.combinedFreestreamSectors}</p>
                    <p className="text-[10px] text-slate-400">Freestream</p>
                  </div>
                </div>
                {config.notes.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {config.notes.map((note, i) => (
                      <p key={i} className="text-[10px] text-slate-500 flex items-start gap-1">
                        <span>&#8226;</span> {note}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Mast Proposals */}
      {mastProposals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="h-4 w-4 text-emerald-600" />
              Proposed Mast Locations
            </CardTitle>
            <CardDescription className="text-xs">Optimal candidate locations if current masts are insufficient</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[300px] overflow-y-auto wind-scrollbar rounded border">
              <Table className="wind-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10">#</TableHead>
                    <TableHead className="sticky top-0 z-10">Description</TableHead>
                    <TableHead className="sticky top-0 z-10">Quality</TableHead>
                    <TableHead className="sticky top-0 z-10">Valid Sectors</TableHead>
                    <TableHead className="sticky top-0 z-10">Freestream</TableHead>
                    <TableHead className="sticky top-0 z-10">Issues</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mastProposals.slice(0, 10).map((mp, idx) => (
                    <TableRow key={mp.id}>
                      <TableCell className="font-medium text-xs">{idx + 1}</TableCell>
                      <TableCell className="text-xs max-w-[300px]">
                        <p className="font-medium">{mp.justification[0]}</p>
                        <p className="text-slate-400">{mp.proposedLocation.latitude.toFixed(4)}, {mp.proposedLocation.longitude.toFixed(4)}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${mp.qualityScore >= 70 ? 'bg-emerald-500' : mp.qualityScore >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                              style={{ width: `${mp.qualityScore}%` }}></div>
                          </div>
                          <span className="text-xs font-bold">{mp.qualityScore}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{mp.expectedValidSectors}</TableCell>
                      <TableCell className="text-xs">{mp.expectedFreestreamSectors}</TableCell>
                      <TableCell className="text-xs max-w-[200px]">
                        {mp.potentialIssues.length > 0 ? (
                          mp.potentialIssues.slice(0, 2).map((issue, i) => (
                            <p key={i} className="text-amber-600">{issue}</p>
                          ))
                        ) : (
                          <span className="text-emerald-600">None</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
