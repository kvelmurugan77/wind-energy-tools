// ============================================================
// Shared Context for Wind Assessment Application
// Provides state management across all tabs
// ============================================================
'use client'

import React, { createContext, useContext, useReducer, type ReactNode } from 'react'
import type {
  MetMast, WTG, TerrainAssessmentResult, PCVOptimizationResult,
  FreestreamResult, MastProposal, MeasurementSectorsResult,
  WindFarmLayout, AnalysisConfig, ValidationError, InputDataBundle
} from '@/lib/wind'

export interface AppState {
  // Project config
  config: AnalysisConfig

  // Input data
  masts: MetMast[]
  wtgs: WTG[]
  externalWindFarms: WindFarmLayout[]

  // Results
  terrainResults: TerrainAssessmentResult[]
  freestreamResults: FreestreamResult[]
  pcvResults: PCVOptimizationResult | null
  mastProposals: MastProposal[]
  finalSectors: MeasurementSectorsResult[]
  warnings: ValidationError[]

  // UI state
  isLoading: boolean
  error: string | null
  analysisRun: boolean
  activePairKey: string // "mastId:wtgId"
  selectedMastId: string | null
}

export type AppAction =
  | { type: 'SET_CONFIG'; payload: Partial<AnalysisConfig> }
  | { type: 'SET_MASTS'; payload: MetMast[] }
  | { type: 'SET_WTGS'; payload: WTG[] }
  | { type: 'SET_EXTERNAL_FARMS'; payload: WindFarmLayout[] }
  | { type: 'ADD_MAST'; payload: MetMast }
  | { type: 'ADD_WTG'; payload: WTG }
  | { type: 'REMOVE_MAST'; payload: string }
  | { type: 'REMOVE_WTG'; payload: string }
  | { type: 'SET_RESULTS'; payload: {
      terrainResults: TerrainAssessmentResult[]
      freestreamResults: FreestreamResult[]
      pcvResults: PCVOptimizationResult
      mastProposals: MastProposal[]
      finalSectors: MeasurementSectorsResult[]
      warnings: ValidationError[]
    }}
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_ANALYSIS_RUN'; payload: boolean }
  | { type: 'SET_ACTIVE_PAIR'; payload: string }
  | { type: 'SET_SELECTED_MAST'; payload: string | null }
  | { type: 'LOAD_SAMPLE_DATA'; payload: InputDataBundle }
  | { type: 'RESET' }

const DEFAULT_CONFIG: AnalysisConfig = {
  iecVersion: 'IEC-61400-12-1-2017',
  sectorWidth: 10,
  assessmentRadius: 5000,
  minDistanceD: 2,
  maxSlopeSimple: 10,
  maxSlopeComplex: 17,
  wakeAngularThreshold: 30,
  wakeDistanceThresholdD: 20,
  includeExternalLayouts: false,
  project: {
    name: '',
    location: '',
    client: '',
    reportNumber: '',
    analyst: '',
  },
}

const initialState: AppState = {
  config: DEFAULT_CONFIG,
  masts: [],
  wtgs: [],
  externalWindFarms: [],
  terrainResults: [],
  freestreamResults: [],
  pcvResults: null,
  mastProposals: [],
  finalSectors: [],
  warnings: [],
  isLoading: false,
  error: null,
  analysisRun: false,
  activePairKey: '',
  selectedMastId: null,
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CONFIG':
      return { ...state, config: { ...state.config, ...action.payload } }
    case 'SET_MASTS':
      return { ...state, masts: action.payload }
    case 'SET_WTGS':
      return { ...state, wtgs: action.payload }
    case 'SET_EXTERNAL_FARMS':
      return { ...state, externalWindFarms: action.payload }
    case 'ADD_MAST':
      return { ...state, masts: [...state.masts, action.payload] }
    case 'ADD_WTG':
      return { ...state, wtgs: [...state.wtgs, action.payload] }
    case 'REMOVE_MAST':
      return { ...state, masts: state.masts.filter(m => m.id !== action.payload) }
    case 'REMOVE_WTG':
      return { ...state, wtgs: state.wtgs.filter(w => w.id !== action.payload) }
    case 'SET_RESULTS':
      return {
        ...state,
        ...action.payload,
        analysisRun: true,
        isLoading: false,
        error: null,
      }
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload }
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false }
    case 'SET_ANALYSIS_RUN':
      return { ...state, analysisRun: action.payload }
    case 'SET_ACTIVE_PAIR':
      return { ...state, activePairKey: action.payload }
    case 'SET_SELECTED_MAST':
      return { ...state, selectedMastId: action.payload }
    case 'LOAD_SAMPLE_DATA': {
      const d = action.payload
      return {
        ...state,
        config: d.config,
        masts: d.masts,
        wtgs: d.wtgs,
        externalWindFarms: d.externalWindFarms || [],
        analysisRun: false,
        terrainResults: [],
        freestreamResults: [],
        pcvResults: null,
        mastProposals: [],
        finalSectors: [],
        warnings: [],
        error: null,
      }
    }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

const AppContext = createContext<{
  state: AppState
  dispatch: React.Dispatch<AppAction>
} | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppState() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useAppState must be used within AppProvider')
  return context
}
