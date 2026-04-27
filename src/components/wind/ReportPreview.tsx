// ============================================================
// Tab 6: Final Measurement Sectors & Report
// ============================================================
'use client'

import React, { useRef, useEffect, useMemo, useCallback } from 'react'
import { useAppState } from './WindContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  FileText, Download, Printer, CheckCircle2, XCircle, AlertTriangle,
  Info, Shield, BookOpen
} from 'lucide-react'
import type { MeasurementSectorsResult, SectorAnalysis } from '@/lib/wind'

export default function ReportPreview() {
  const { state } = useAppState()
  const { finalSectors, terrainResults, pcvResults, freestreamResults, config } = state

  const activeFinal = useMemo(() => finalSectors[0] || null, [finalSectors])

  const handleExportCSV = useCallback(() => {
    if (!activeFinal) return
    const headers = ['Direction', 'MaxSlope_%', 'MaxSlope_Deg', 'AvgSlope_%', 'ElevChange_m', 'TerrainClass', 'Roughness_z0', 'IsValid', 'IsFreestream', 'FailureReasons']
    const rows = activeFinal.validSectors.map(s => [
      s.direction, s.maxSlope.toFixed(2), s.maxSlopeDeg.toFixed(2), s.avgSlope.toFixed(2),
      s.maxElevationChange.toFixed(1), s.terrainClass, s.roughness.z0.toFixed(4),
      s.isValid, s.isFreestream, `"${s.failureReasons.join('; ')}"`
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${config.project.name || 'wind-assessment'}_sectors.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [activeFinal, config.project.name])

  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  if (finalSectors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FileText className="h-12 w-12 text-slate-300 mb-4" />
        <h3 className="text-lg font-semibold text-slate-500">No Final Sectors</h3>
        <p className="text-sm text-slate-400 mt-1">Complete the analysis to view final measurement sectors and generate the report.</p>
      </div>
    )
  }

  const fs = activeFinal
  if (!fs) return null

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="space-y-6">
      {/* Export controls */}
      <div className="flex items-center gap-3 no-print">
        <Button variant="outline" onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-2" />
          Export to PDF (Print)
        </Button>
        <Button variant="outline" onClick={handleExportCSV}>
          <Download className="h-4 w-4 mr-2" />
          Export Sector CSV
        </Button>
      </div>

      {/* ===== REPORT CONTENT (Print-friendly) ===== */}
      <div id="report-content">
        {/* Title Page */}
        <div className="print-page report-title-page bg-slate-900 text-white rounded-xl p-12 mb-8">
          <div className="print-only text-[10pt] text-slate-400 mb-8">{config.project.reportNumber}</div>
          <h1 className="text-3xl font-bold mb-2">Wind Resource Assessment</h1>
          <h2 className="text-xl font-light text-slate-300 mb-1">Power Curve Verification (PCV)</h2>
          <h3 className="text-base text-slate-400">Terrain Assessment &amp; Measurement Sector Selection</h3>
          <Separator className="my-6 bg-slate-700" />
          <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
            <div className="text-slate-400">Project:</div>
            <div className="font-medium">{config.project.name}</div>
            <div className="text-slate-400">Location:</div>
            <div className="font-medium">{config.project.location}</div>
            {config.project.client && (
              <>
                <div className="text-slate-400">Client:</div>
                <div className="font-medium">{config.project.client}</div>
              </>
            )}
            {config.project.analyst && (
              <>
                <div className="text-slate-400">Analyst:</div>
                <div className="font-medium">{config.project.analyst}</div>
              </>
            )}
            <div className="text-slate-400">Standard:</div>
            <div className="font-medium">{config.iecVersion.replace('IEC-', 'IEC ').replace(/-/g, ':')}</div>
            <div className="text-slate-400">Date:</div>
            <div className="font-medium">{today}</div>
          </div>
        </div>

        {/* Executive Summary */}
        <Card className="print-card avoid-break mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-emerald-600" />
              Executive Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-700 space-y-3">
            <p>
              This report presents the terrain assessment and measurement sector selection for Power Curve Verification
              at the <strong>{config.project.name}</strong> project located in <strong>{config.project.location}</strong>.
              The assessment was performed in accordance with <strong>{config.iecVersion.replace('IEC-', 'IEC ').replace(/-/g, ':')}</strong>.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
              <div className="bg-slate-50 rounded-lg p-4">
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Site Characteristics</h4>
                <ul className="text-xs space-y-1 text-slate-700">
                  <li><strong>Meteorological Masts:</strong> {state.masts.length} ({state.masts.map(m => m.name).join(', ')})</li>
                  <li><strong>Target WTGs:</strong> {state.wtgs.filter(w => w.isTarget !== false).length}</li>
                  <li><strong>Total WTGs:</strong> {state.wtgs.length}</li>
                  <li><strong>Sector Width:</strong> {config.sectorWidth}° ({360 / config.sectorWidth} sectors)</li>
                  <li><strong>Assessment Radius:</strong> {config.assessmentRadius}m</li>
                </ul>
              </div>
              <div className="bg-slate-50 rounded-lg p-4">
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Key Findings</h4>
                <ul className="text-xs space-y-1 text-slate-700">
                  <li><strong>Terrain Class:</strong> {fs.complianceSummary.terrainClass}</li>
                  <li><strong>Valid Sectors:</strong> {fs.finalSectors.length} of {360 / config.sectorWidth}</li>
                  <li><strong>Sector Coverage:</strong> {fs.totalCoverage.toFixed(1)}%</li>
                  <li><strong>IEC Compliant:</strong> {fs.complianceSummary.allCriteriaMet ? 'Yes' : 'No'}</li>
                </ul>
              </div>
            </div>

            {pcvResults && pcvResults.recommendations.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Recommendations</h4>
                <ul className="text-xs space-y-1">
                  {pcvResults.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="mt-0.5 text-emerald-600">&#8226;</span> {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assessment Configuration */}
        <Card className="print-card avoid-break mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Assessment Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <Table className="wind-table">
              <TableBody>
                {[
                  ['IEC Standard', config.iecVersion.replace('IEC-', 'IEC ').replace(/-/g, ':')],
                  ['Sector Width', `${config.sectorWidth}°`],
                  ['Assessment Radius', `${config.assessmentRadius}m`],
                  ['Min Mast-WTG Distance', `${config.minDistanceD}D`],
                  ['Max Slope (Simple Terrain)', `${config.maxSlopeSimple}°`],
                  ['Max Slope (Complex Terrain)', `${config.maxSlopeComplex}°`],
                  ['Wake Angular Threshold', `${config.wakeAngularThreshold}°`],
                  ['Wake Distance Threshold', `${config.wakeDistanceThresholdD}D`],
                  ['External Farms Included', config.includeExternalLayouts ? 'Yes' : 'No'],
                ].map(([label, value]) => (
                  <TableRow key={label}>
                    <TableCell className="font-medium text-xs w-1/3">{label}</TableCell>
                    <TableCell className="text-xs">{value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Mast Details */}
        <Card className="print-card avoid-break mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Meteorological Mast Details</CardTitle>
          </CardHeader>
          <CardContent>
            <Table className="wind-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Latitude</TableHead>
                  <TableHead>Longitude</TableHead>
                  <TableHead>Height (m)</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Measurement Heights</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.masts.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium text-xs">{m.name}</TableCell>
                    <TableCell className="text-xs">{m.location.latitude.toFixed(5)}</TableCell>
                    <TableCell className="text-xs">{m.location.longitude.toFixed(5)}</TableCell>
                    <TableCell className="text-xs">{m.mastHeight}</TableCell>
                    <TableCell className="text-xs">{m.type}</TableCell>
                    <TableCell className="text-xs">{m.measurementHeights?.join(', ') || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* WTG Details */}
        <Card className="print-card avoid-break mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Wind Turbine Details</CardTitle>
          </CardHeader>
          <CardContent>
            <Table className="wind-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Latitude</TableHead>
                  <TableHead>Longitude</TableHead>
                  <TableHead>Rotor Diameter (m)</TableHead>
                  <TableHead>Hub Height (m)</TableHead>
                  <TableHead>Rated Power</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.wtgs.map(w => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium text-xs">{w.name}</TableCell>
                    <TableCell className="text-xs">{w.location.latitude.toFixed(5)}</TableCell>
                    <TableCell className="text-xs">{w.location.longitude.toFixed(5)}</TableCell>
                    <TableCell className="text-xs">{w.rotorDiameter}</TableCell>
                    <TableCell className="text-xs">{w.hubHeight}</TableCell>
                    <TableCell className="text-xs">{w.ratedPower ? `${w.ratedPower} kW` : '-'}</TableCell>
                    <TableCell className="text-xs">
                      <Badge className={w.isTarget !== false ? 'badge-valid text-[10px]' : 'badge-info text-[10px]'}>
                        {w.isTarget !== false ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Final Sectors Summary */}
        <Card className="print-card avoid-break mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-600" />
              Final Measurement Sectors
            </CardTitle>
            <CardDescription className="text-xs">
              Mast: {fs.mastName} | Target: {fs.targetWtgs.map(w => w.name).join(', ')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Coverage metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="metric-card text-center">
                <p className="metric-label">Total Sectors</p>
                <p className="metric-value">{360 / config.sectorWidth}</p>
              </div>
              <div className="metric-card text-center">
                <p className="metric-label">Valid</p>
                <p className="metric-value text-emerald-600">{fs.validSectors.length}</p>
              </div>
              <div className="metric-card text-center">
                <p className="metric-label">Freestream</p>
                <p className="metric-value text-sky-600">{fs.freestreamSectors.length}</p>
              </div>
              <div className="metric-card text-center">
                <p className="metric-label">Final (Valid+Free)</p>
                <p className="metric-value">{fs.finalSectors.length}</p>
              </div>
            </div>

            {/* Coverage bar */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-600">Total Measurement Coverage</span>
                <span className="text-xs font-bold">{fs.totalCoverage.toFixed(1)}%</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${fs.totalCoverage >= 50 ? 'bg-emerald-500' : fs.totalCoverage >= 25 ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ width: `${fs.totalCoverage}%` }}></div>
              </div>
            </div>

            {/* Final sectors list */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">
                Final Valid + Freestream Sectors ({fs.finalSectors.length})
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {fs.finalSectors.map(dir => (
                  <Badge key={dir} className="badge-valid text-xs">{dir}°</Badge>
                ))}
              </div>
            </div>

            {/* Compliance */}
            <div className={`p-4 rounded-lg ${fs.complianceSummary.allCriteriaMet ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                {fs.complianceSummary.allCriteriaMet ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                )}
                <span className={`font-semibold text-sm ${fs.complianceSummary.allCriteriaMet ? 'text-emerald-800' : 'text-amber-800'}`}>
                  IEC Compliance: {fs.complianceSummary.allCriteriaMet ? 'ALL CRITERIA MET' : 'CRITERIA NOT FULLY MET'}
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-slate-600">
                  <strong>Terrain Class:</strong> {fs.complianceSummary.terrainClass}
                  ({fs.complianceSummary.terrainClass === 'A' ? 'Simple' : fs.complianceSummary.terrainClass === 'B' ? 'Moderate' : 'Complex'})
                </p>
                {fs.complianceSummary.notes.map((note, i) => (
                  <p key={i} className="text-xs text-slate-600 flex items-start gap-1">
                    <span className="mt-0.5">&#8226;</span> {note}
                  </p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Detailed sector table */}
        <Card className="print-card avoid-break mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Detailed Sector Data</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-y-auto wind-scrollbar rounded border print:max-h-none">
              <Table className="wind-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10">Dir°</TableHead>
                    <TableHead className="sticky top-0 z-10">Max Slope (°)</TableHead>
                    <TableHead className="sticky top-0 z-10">Max Slope (%)</TableHead>
                    <TableHead className="sticky top-0 z-10">Avg Slope (%)</TableHead>
                    <TableHead className="sticky top-0 z-10">Δ Elev (m)</TableHead>
                    <TableHead className="sticky top-0 z-10">Class</TableHead>
                    <TableHead className="sticky top-0 z-10">z₀</TableHead>
                    <TableHead className="sticky top-0 z-10">Valid</TableHead>
                    <TableHead className="sticky top-0 z-10">Freestream</TableHead>
                    <TableHead className="sticky top-0 z-10">Final</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fs.validSectors.map(sector => {
                    const isFinal = fs.finalSectors.includes(sector.direction)
                    return (
                      <TableRow key={sector.direction}>
                        <TableCell className="font-mono font-medium">{sector.direction}</TableCell>
                        <TableCell className={sector.maxSlopeDeg > config.maxSlopeSimple ? 'text-red-600 font-medium' : ''}>
                          {sector.maxSlopeDeg.toFixed(1)}
                        </TableCell>
                        <TableCell>{sector.maxSlope.toFixed(1)}</TableCell>
                        <TableCell>{sector.avgSlope.toFixed(2)}</TableCell>
                        <TableCell>{sector.maxElevationChange.toFixed(1)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${
                            sector.terrainClass === 'A' ? 'badge-valid' : sector.terrainClass === 'B' ? 'badge-warning' : 'badge-invalid'
                          }`}>
                            {sector.terrainClass}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{sector.roughness.z0.toFixed(4)}</TableCell>
                        <TableCell>
                          {sector.isValid ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-500" />}
                        </TableCell>
                        <TableCell>
                          {sector.isFreestream ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-500" />}
                        </TableCell>
                        <TableCell>
                          {isFinal ? (
                            <Badge className="badge-valid text-[10px]">Yes</Badge>
                          ) : (
                            <span className="text-slate-400 text-xs">No</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Terrain Assessment Summary (all pairs) */}
        {terrainResults.length > 0 && (
          <Card className="print-card avoid-break mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Terrain Assessment Summary (All Pairs)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table className="wind-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Mast</TableHead>
                    <TableHead>Target WTG</TableHead>
                    <TableHead>Distance (m)</TableHead>
                    <TableHead>Distance (D)</TableHead>
                    <TableHead>Terrain Class</TableHead>
                    <TableHead>Valid Sectors</TableHead>
                    <TableHead>Valid %</TableHead>
                    <TableHead>IEC Compliant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terrainResults.map(r => (
                    <TableRow key={`${r.metadata.mastId}-${r.metadata.targetWtgId}`}>
                      <TableCell className="font-medium text-xs">{r.metadata.mastName}</TableCell>
                      <TableCell className="text-xs">{r.metadata.targetWtgName}</TableCell>
                      <TableCell className="text-xs">{r.distance.meters.toFixed(0)}</TableCell>
                      <TableCell className="text-xs">{r.distance.rotorDiameters.toFixed(1)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${
                          r.summary.terrainClass === 'A' ? 'badge-valid' : r.summary.terrainClass === 'B' ? 'badge-warning' : 'badge-invalid'
                        }`}>
                          {r.summary.terrainClass}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.summary.validSectorsCount}/{r.summary.totalSectors}</TableCell>
                      <TableCell className="text-xs font-medium">{r.summary.validSectorPercentage.toFixed(1)}%</TableCell>
                      <TableCell>
                        {r.summary.isIECCompliant ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-slate-400 mt-8 pb-8 print:mt-4">
          <Separator className="mb-4" />
          <p>Generated by Wind Resource Assessment Tool &middot; {today}</p>
          <p className="mt-1">{config.project.reportNumber} | {config.project.name} | {config.project.location}</p>
        </div>
      </div>
    </div>
  )
}
