// ============================================================
// API Route: Load Sample Data
// GET /api/sample-data
// ============================================================

import { NextResponse } from 'next/server';
import { generateSampleData } from '@/lib/wind';

export async function GET() {
  try {
    const data = generateSampleData();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, errors: [{ message: error.message }] },
      { status: 500 }
    );
  }
}
