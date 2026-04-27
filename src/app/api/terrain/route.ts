// ============================================================
// API Route: Full Wind Assessment
// POST /api/terrain - Perform complete terrain assessment
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import type { InputDataBundle, ValidationError } from '@/lib/wind';
import {
  validateInputs,
  performAllAssessments,
  analyzeFreestreamAllMasts,
  optimizePCV,
  proposeMastLocations,
  calculateFinalSectors,
  DEFAULT_CONFIG,
} from '@/lib/wind';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Merge with default config
    const config = {
      ...DEFAULT_CONFIG,
      ...body.config,
      project: { ...DEFAULT_CONFIG.project, ...body.config?.project },
    };

    const inputData: InputDataBundle = {
      masts: body.masts || [],
      wtgs: body.wtgs || [],
      terrainPoints: body.terrainPoints,
      roughnessSectors: body.roughnessSectors,
      externalWindFarms: body.externalWindFarms || [],
      config,
    };

    // Validate inputs
    const errors = validateInputs(inputData.masts, inputData.wtgs, config);
    const criticalErrors = errors.filter((e) => e.severity === 'error');

    if (criticalErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          errors: criticalErrors,
          warnings: errors.filter((e) => e.severity === 'warning'),
        },
        { status: 400 }
      );
    }

    // Run terrain assessments for all mast-WTG pairs
    const terrainResults = performAllAssessments(
      inputData.masts,
      inputData.wtgs,
      inputData.terrainPoints,
      inputData.roughnessSectors,
      config
    );

    // Run freestream analysis
    const freestreamResults = analyzeFreestreamAllMasts(
      inputData.masts,
      inputData.wtgs,
      inputData.externalWindFarms || [],
      config
    );

    // Run PCV optimization
    const pcvResults = optimizePCV(inputData.masts, inputData.wtgs, config);

    // Propose mast locations
    const mastProposals = proposeMastLocations(
      inputData.wtgs,
      inputData.wtgs,
      config,
      inputData.masts
    );

    // Calculate final measurement sectors
    const finalSectors: any[] = [];
    const bestConfig = pcvResults.configurations[0];
    if (bestConfig) {
      const mast = inputData.masts.find((m) => m.id === bestConfig.mastId);
      if (mast) {
        const targetWtgs = bestConfig.targetWtgs
          .map((tw) => inputData.wtgs.find((w) => w.id === tw.wtgId))
          .filter(Boolean);
        if (targetWtgs.length > 0) {
          finalSectors.push(calculateFinalSectors(mast, targetWtgs, inputData.wtgs, config));
        }
      }
    }

    return NextResponse.json({
      success: true,
      warnings: errors.filter((e) => e.severity === 'warning'),
      data: {
        terrainResults,
        freestreamResults,
        pcvResults,
        mastProposals,
        finalSectors,
      },
    });
  } catch (error: any) {
    console.error('Assessment error:', error);
    return NextResponse.json(
      {
        success: false,
        errors: [{ field: 'server', message: error.message || 'Internal server error', severity: 'error' }],
      },
      { status: 500 }
    );
  }
}
