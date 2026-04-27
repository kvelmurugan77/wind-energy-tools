'use client'

import React, { useCallback, useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { AppProvider, useAppState } from '@/components/wind/WindContext'
import ProjectSetup from '@/components/wind/ProjectSetup'
import SiteLayoutMap from '@/components/wind/SiteLayoutMap'
import TerrainResults from '@/components/wind/TerrainResults'
import PCVSelection from '@/components/wind/PCVSelection'
import FreestreamAnalysis from '@/components/wind/FreestreamAnalysis'
import ReportPreview from '@/components/wind/ReportPreview'
import {
  Wind, MapPin, Mountain, Trophy, Waves, FileText,
  Loader2, CheckCircle2, AlertTriangle, RotateCcw
} from 'lucide-react'

// ============================================================
// Welcome Screen - shown when no data is loaded
// ============================================================
function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center max-w-lg mx-auto">
      <div className="w-20 h-20 rounded-2xl bg-emerald-100 flex items-center justify-center mb-6">
        <Wind className="h-10 w-10 text-emerald-600" />
      </div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">
        Wind Resource Assessment
      </h2>
      <p className="text-sm text-slate-500 mb-6 leading-relaxed">
        IEC 61400-12-1 compliant Power Curve Verification tool.
        Configure your project, load mast and WTG data, run the terrain analysis,
        and generate a comprehensive assessment report.
      </p>
      <div className="grid grid-cols-2 gap-3 w-full text-left">
        {[
          { icon: <MapPin className="h-4 w-4 text-emerald-600" />, title: 'Setup', desc: 'Configure project & upload data' },
          { icon: <Mountain className="h-4 w-4 text-emerald-600" />, title: 'Assess', desc: 'Run IEC terrain analysis' },
          { icon: <Trophy className="h-4 w-4 text-emerald-600" />, title: 'Select', desc: 'Optimize PCV mast-WTG pairing' },
          { icon: <FileText className="h-4 w-4 text-emerald-600" />, title: 'Report', desc: 'Export findings & compliance' },
        ].map(step => (
          <div key={step.title} className="p-3 rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center gap-2 mb-1">
              {step.icon}
              <span className="text-sm font-semibold text-slate-800">{step.title}</span>
            </div>
            <p className="text-xs text-slate-500">{step.desc}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400 mt-6">
        Start by going to the &quot;Project Setup&quot; tab and loading data, or click &quot;Load Sample Demo Data&quot; to explore.
      </p>
    </div>
  )
}

// ============================================================
// Main Application Content
// ============================================================
function AppContent() {
  const { state, dispatch } = useAppState()
  const { isLoading, error, analysisRun } = state
  const [activeTab, setActiveTab] = useState('setup')

  const runAnalysis = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true })
    dispatch({ type: 'SET_ERROR', payload: null })
    try {
      const res = await fetch('/api/terrain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masts: state.masts,
          wtgs: state.wtgs,
          externalWindFarms: state.externalWindFarms,
          config: state.config,
        }),
      })
      const json = await res.json()
      if (json.success) {
        dispatch({
          type: 'SET_RESULTS',
          payload: {
            terrainResults: json.data.terrainResults,
            freestreamResults: json.data.freestreamResults,
            pcvResults: json.data.pcvResults,
            mastProposals: json.data.mastProposals || [],
            finalSectors: json.data.finalSectors || [],
            warnings: json.warnings || [],
          },
        })
        // Set first pair as active
        if (json.data.terrainResults?.length > 0) {
          const first = json.data.terrainResults[0]
          dispatch({
            type: 'SET_ACTIVE_PAIR',
            payload: `${first.metadata.mastId}:${first.metadata.targetWtgId}`,
          })
        }
        // Switch to map tab
        setActiveTab('map')
      } else {
        dispatch({
          type: 'SET_ERROR',
          payload: json.errors?.map((e: any) => e.message).join('; ') || 'Analysis failed',
        })
      }
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Network error' })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }, [state.masts, state.wtgs, state.externalWindFarms, state.config, dispatch])

  const hasData = state.masts.length > 0 || state.wtgs.length > 0

  const tabItems = [
    { value: 'setup', label: 'Project Setup', icon: <MapPin className="h-3.5 w-3.5" /> },
    { value: 'map', label: 'Site Layout', icon: <MapPin className="h-3.5 w-3.5" /> },
    { value: 'terrain', label: 'Terrain Results', icon: <Mountain className="h-3.5 w-3.5" /> },
    { value: 'pcv', label: 'PCV Selection', icon: <Trophy className="h-3.5 w-3.5" /> },
    { value: 'freestream', label: 'Freestream', icon: <Waves className="h-3.5 w-3.5" /> },
    { value: 'report', label: 'Report', icon: <FileText className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-slate-900 text-white border-b border-slate-700 no-print">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Wind className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">Wind Resource Assessment</h1>
              <p className="text-[10px] text-slate-400">IEC 61400-12-1 PCV Tool</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {analysisRun && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Analysis complete
              </span>
            )}
            {isLoading && (
              <span className="flex items-center gap-1 text-xs text-slate-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running...
              </span>
            )}
            {state.config.project.name && (
              <span className="text-xs text-slate-400 hidden sm:block">
                {state.config.project.name}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-white border-b border-slate-200 no-print sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
          <div className="wind-tabs-nav" style={{ borderWidth: 0 }}>
            {tabItems.map(tab => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`wind-tab-trigger ${activeTab === tab.value ? 'data-[state=active]' : ''}`}
              >
                <span className="flex items-center gap-1.5">
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                </span>
                {tab.value !== 'setup' && tab.value !== 'report' && !analysisRun && (
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block"></span>
                )}
                {tab.value !== 'setup' && tab.value !== 'report' && analysisRun && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                )}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 py-6">
        {/* Loading overlay */}
        {isLoading && (
          <div className="fixed inset-0 bg-white/60 backdrop-blur-sm z-[100] flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 text-emerald-600 animate-spin" />
              <p className="text-sm font-medium text-slate-600">Running terrain analysis...</p>
              <p className="text-xs text-slate-400">This may take a moment</p>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-red-800">Analysis Error</h3>
              <p className="text-xs text-red-600 mt-0.5">{error}</p>
            </div>
            <Button variant="ghost" size="sm" className="ml-auto text-red-500 h-7"
              onClick={() => dispatch({ type: 'SET_ERROR', payload: null })}>×</Button>
          </div>
        )}

        {/* Welcome screen when no data */}
        {!hasData && !isLoading && activeTab === 'setup' && (
          <WelcomeScreen />
        )}

        {/* Tab content */}
        {hasData || activeTab !== 'setup' ? (
          <>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              {/* TabsList is rendered in nav above - this is just for content */}
              <TabsContent value="setup" className="mt-0">
                <ProjectSetup onRunAnalysis={runAnalysis} />
              </TabsContent>
              <TabsContent value="map" className="mt-0">
                <SiteLayoutMap />
              </TabsContent>
              <TabsContent value="terrain" className="mt-0">
                <TerrainResults />
              </TabsContent>
              <TabsContent value="pcv" className="mt-0">
                <PCVSelection />
              </TabsContent>
              <TabsContent value="freestream" className="mt-0">
                <FreestreamAnalysis />
              </TabsContent>
              <TabsContent value="report" className="mt-0">
                <ReportPreview />
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </main>

      {/* Footer */}
      <footer className="bg-slate-100 border-t border-slate-200 py-3 no-print">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Wind Resource Assessment Tool &middot; IEC 61400-12-1
          </p>
          <p className="text-xs text-slate-400">
            {state.config.iecVersion.replace('IEC-', 'IEC ').replace(/-/g, ':')}
            {state.config.sectorWidth && ` · ${state.config.sectorWidth}° sectors`}
          </p>
        </div>
      </footer>
    </div>
  )
}

// ============================================================
// Root Page Component
// ============================================================
export default function Home() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}
