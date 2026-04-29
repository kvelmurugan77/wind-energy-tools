// ============================================================
// Wind Flow Model - Full Analysis Pipeline API
// POST /api/windflow/process
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { parseWindData, parseLayout } from '@/lib/windflow/parser';
import { analyzeWindClimate, calculateFrequencyDistribution, fitWeibull, lnGamma, NUM_SECTORS, getSectorDirection } from '@/lib/windflow/statistics';
import { calculateFlowAtPosition } from '@/lib/windflow/flow-model';
import { calculateFarmWakeLosses } from '@/lib/windflow/wake-model';
import { calculateGrossAEP, calculateNetAEP } from '@/lib/windflow/aep';
import { getTurbineModel, TURBINE_MODELS } from '@/lib/windflow/power-curves';
import type {
  WindRecord, TurbineLayout, MastConfig,
  FarmResult, TurbineResult, WindClimate, FrequencyTable
} from '@/lib/windflow/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      windDataCsv,
      layoutCsv,
      mastX,
      mastY,
      mastHeight,
      measurementHeight,
      roughnessLength,
      flowModel,
    } = body as {
      windDataCsv: string;
      layoutCsv: string;
      mastX?: number;
      mastY?: number;
      mastHeight?: number;
      measurementHeight?: number;
      roughnessLength?: number;
      flowModel?: 'log-law' | 'power-law';
    };

    // Step 1: Parse input data
    const records: WindRecord[] = parseWindData(windDataCsv);
    const turbines: TurbineLayout[] = parseLayout(layoutCsv);

    if (records.length === 0) {
      return NextResponse.json({ error: 'No valid wind data records found. Check CSV format.' }, { status: 400 });
    }
    if (turbines.length === 0) {
      return NextResponse.json({ error: 'No valid turbine positions found. Check layout CSV format.' }, { status: 400 });
    }

    // Step 2: Configure mast parameters
    const mastConfig: MastConfig = {
      x: mastX || turbines.reduce((s, t) => s + t.x, 0) / turbines.length,
      y: mastY || turbines.reduce((s, t) => s + t.y, 0) / turbines.length,
      measurementHeight: measurementHeight || mastHeight || 100,
      roughnessLength: roughnessLength || 0.03,
    };

    // Step 3: Analyze wind climate at mast
    const windClimate: WindClimate = analyzeWindClimate(records);

    // Step 4: Get frequency table
    const { frequencyTable } = calculateFrequencyDistribution(records);

    // Step 5: For each turbine, extrapolate wind flow and calculate AEP
    const turbineResults: TurbineResult[] = [];
    let totalGrossAEP = 0;
    let totalNetAEP = 0;
    const model = flowModel || 'log-law';

    // Get unique turbine models
    const turbineModels = new Map<string, ReturnType<typeof getTurbineModel>>();
    for (const t of turbines) {
      if (!turbineModels.has(t.model)) {
        turbineModels.set(t.model, getTurbineModel(t.model));
      }
    }

    for (const turbine of turbines) {
      const turbineModel = turbineModels.get(turbine.model) || getTurbineModel(turbine.model);

      // Flow extrapolation from mast to this WTG position
      const flowResult = calculateFlowAtPosition(
        windClimate, turbine, mastConfig, model, mastConfig.roughnessLength
      );

      // Calculate sector-specific Weibull parameters at WTG position
      const sectorA: number[] = [];
      const sectorK: number[] = [];
      for (let s = 0; s < NUM_SECTORS; s++) {
        const mastSector = windClimate.sectors[s];
        if (mastSector.meanSpeed > 0) {
          const ratio = flowResult.sectorSpeeds[s] / mastSector.meanSpeed;
          sectorA.push(mastSector.weibullA * (isFinite(ratio) ? ratio : 1));
        } else {
          sectorA.push(0);
        }
        sectorK.push(mastSector.weibullK);
      }

      // Calculate gross AEP
      const grossResult = calculateGrossAEP(turbineModel, sectorA, sectorK, flowResult.sectorFrequencies);

      // Calculate wake effects
      const { wakeSpeeds, wakeLossBySector } = calculateFarmWakeLosses(
        turbines, flowResult.sectorSpeeds, flowResult.sectorFrequencies
      );

      // Calculate net AEP with wake losses
      const turbineIdx = turbines.indexOf(turbine);
      const netResult = calculateNetAEP(
        turbineModel, wakeSpeeds[turbineIdx], flowResult.sectorFrequencies, sectorK
      );

      // Weighted wake loss across sectors
      let weightedWakeLoss = 0;
      for (let s = 0; s < NUM_SECTORS; s++) {
        weightedWakeLoss += wakeLossBySector[turbineIdx][s] * flowResult.sectorFrequencies[s];
      }

      const result: TurbineResult = {
        id: turbine.id,
        x: turbine.x,
        y: turbine.y,
        model: turbine.model,
        hubHeight: turbine.hubHeight,
        rotorDiameter: turbine.rotorDiameter,
        grossMeanSpeed: flowResult.meanSpeed,
        grossWeibullA: flowResult.weibullA,
        grossWeibullK: flowResult.weibullK,
        grossPowerDensity: flowResult.powerDensity,
        grossAEP: Math.round(grossResult.totalAEP / 1000 * 100) / 100,
        netAEP: Math.round(netResult.totalNetAEP / 1000 * 100) / 100,
        wakeLossPercent: Math.round(weightedWakeLoss * 100) / 100,
        capacityFactor: netResult.netCapacityFactor,
        sectorSpeeds: flowResult.sectorSpeeds,
        sectorFrequencies: flowResult.sectorFrequencies,
      };

      turbineResults.push(result);
      totalGrossAEP += result.grossAEP;
      totalNetAEP += result.netAEP;
    }

    // Sort results by turbine ID
    turbineResults.sort((a, b) => {
      const numA = parseInt(a.id.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.id.replace(/\D/g, '')) || 0;
      return numA - numB;
    });

    const farmCapacity = turbines.reduce((sum, t) => {
      const tm = turbineModels.get(t.model);
      return sum + (tm ? tm.ratedPower : 0);
    }, 0);

    const farmResult: FarmResult = {
      turbines: turbineResults,
      totalGrossAEP: Math.round(totalGrossAEP * 100) / 100,
      totalNetAEP: Math.round(totalNetAEP * 100) / 100,
      totalWakeLoss: Math.round((totalGrossAEP - totalNetAEP) * 100) / 100,
      wakeLossPercent: totalGrossAEP > 0 ? Math.round(((totalGrossAEP - totalNetAEP) / totalGrossAEP) * 100 * 100) / 100 : 0,
      farmCapacity,
      netCapacityFactor: farmCapacity > 0 ? Math.round(((totalNetAEP * 1e6) / (farmCapacity * 8760)) * 10000) / 100 : 0,
      windClimate,
    };

    return NextResponse.json({
      success: true,
      mastConfig,
      turbineCount: turbines.length,
      farmResult,
      frequencyTable,
      availableModels: Object.keys(TURBINE_MODELS),
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Wind flow analysis error:', error);
    return NextResponse.json({ error: `Analysis failed: ${msg}` }, { status: 500 });
  }
}
