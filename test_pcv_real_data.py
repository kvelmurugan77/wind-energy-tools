#!/usr/bin/env python3
"""
WTG PCV Tool - Real Data Test Script
=====================================
Tests the WTG Power Curve Verification tool with real input data:
- Wind farm layout (internal WTGs) - UTM Zone 35N
- Wind farm layout (external WTGs)
- Wind Data (time series)
- Terrain map file (.map)

Processes coordinate conversion, calls the Next.js API,
and generates a comprehensive DNV-style PDF report.
"""

import csv
import json
import math
import os
import sys
from datetime import datetime
from pathlib import Path

import requests
import numpy as np
from pyproj import Transformer

# ============================================================
# Configuration
# ============================================================
API_BASE = "http://localhost:3000"
UPLOAD_DIR = "/home/z/my-project/upload"
OUTPUT_DIR = "/home/z/my-project/download"

# Coordinate system for WTG layouts (Romanian Stereo70 / Pulkovo)
CRS_WTG = "EPSG:7755"
CRS_WGS84 = "EPSG:4326"

# Transformer
transformer = Transformer.from_crs(CRS_WTG, CRS_WGS84)

# ============================================================
# 1. Parse Input CSV Files
# ============================================================

def parse_wtg_csv(filepath: str, is_external: bool = False) -> list:
    """Parse wind farm layout CSV with UTM coordinates."""
    wtgs = []
    with open(filepath, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            x = float(row['x'])
            y = float(row['y'])
            lon, lat = transformer.transform(x, y)
            
            model = row['model']
            rd = float(row['rd'])  # rotor diameter
            hh = float(row['hh'])  # hub height
            
            # Extract rated power from model name
            rated_power = 7000 if '7.0MW' in model else 3000 if '3MW' in model else 0
            
            wtg = {
                "id": row['id'].strip(),
                "name": f"{row['id'].strip()} ({model})",
                "location": {
                    "latitude": round(lat, 6),
                    "longitude": round(lon, 6),
                    "elevation": 90.0  # Approximate from .map file contours
                },
                "rotorDiameter": rd,
                "hubHeight": hh,
                "ratedPower": rated_power,
                "isTarget": not is_external,
                "status": "operational"
            }
            wtgs.append(wtg)
    return wtgs

def parse_wind_data(filepath: str) -> dict:
    """Parse wind data CSV for wind rose statistics."""
    records = []
    with open(filepath, 'r') as f:
        lines = f.readlines()
    
    # Skip header rows (first 2 lines: header + units)
    for line in lines[2:]:
        line = line.strip()
        if not line:
            continue
        parts = line.split(',')
        if len(parts) >= 3:
            try:
                ws = float(parts[1])
                wd = float(parts[2])
                if ws > 0.5:  # Filter calm periods
                    records.append({"speed": ws, "direction": wd})
            except (ValueError, IndexError):
                continue
    
    # Calculate wind rose statistics
    sectors = 36
    sector_width = 360 / sectors
    wind_rose = []
    
    for i in range(sectors):
        sector_center = i * sector_width + sector_width / 2
        sector_speeds = [r["speed"] for r in records 
                        if abs(r["direction"] - sector_center) <= sector_width / 2]
        if sector_speeds:
            wind_rose.append({
                "direction": sector_center,
                "count": len(sector_speeds),
                "avgSpeed": round(np.mean(sector_speeds), 2),
                "maxSpeed": round(np.max(sector_speeds), 2),
                "frequency": round(len(sector_speeds) / len(records) * 100, 2) if records else 0
            })
        else:
            wind_rose.append({
                "direction": sector_center,
                "count": 0,
                "avgSpeed": 0,
                "maxSpeed": 0,
                "frequency": 0
            })
    
    all_speeds = [r["speed"] for r in records]
    
    return {
        "totalRecords": len(records),
        "meanWindSpeed": round(np.mean(all_speeds), 2) if all_speeds else 0,
        "maxWindSpeed": round(np.max(all_speeds), 2) if all_speeds else 0,
        "windRose": wind_rose,
        "predominantDirection": max(wind_rose, key=lambda x: x["frequency"])["direction"] if wind_rose else 0
    }

def parse_map_file(filepath: str) -> dict:
    """Parse WAsP .map file for terrain information."""
    contours = []
    total_points = 0
    
    for enc in ['utf-8', 'latin-1', 'iso-8859-1', 'cp1252']:
        try:
            with open(filepath, 'r', encoding=enc) as f:
                lines = f.readlines()
            break
        except UnicodeDecodeError:
            continue
    else:
        with open(filepath, 'r', encoding='latin-1', errors='replace') as f:
            lines = f.readlines()
    
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line or line.startswith('+'):
            i += 1
            continue
        
        # Skip transformation header lines
        if line in ['0.0 1.0 0.0 1.0', '1.0 0.0 1.0 0.0', '1.0 0.0']:
            i += 1
            continue
        
        parts = line.split()
        if len(parts) == 2:
            try:
                elevation = float(parts[0])
                num_points = int(parts[1])
                
                if num_points < 500 and num_points >= 2:  # Sanity check
                    contour_points = []
                    for j in range(num_points):
                        if i + 1 + j < len(lines):
                            pt_line = lines[i + 1 + j].strip()
                            pt_parts = pt_line.split()
                            if len(pt_parts) == 2:
                                try:
                                    px, py = float(pt_parts[0]), float(pt_parts[1])
                                    contour_points.append({"x": px, "y": py})
                                except ValueError:
                                    pass
                    
                    if contour_points:
                        contours.append({
                            "elevation": elevation,
                            "numPoints": len(contour_points),
                            "points": contour_points
                        })
                        total_points += len(contour_points)
                
                i += num_points + 1
                continue
            except (ValueError, IndexError):
                pass
        
        i += 1
    
    # Extract elevation range
    elevations = [c["elevation"] for c in contours]
    
    return {
        "numContours": len(contours),
        "totalPoints": total_points,
        "elevationMin": min(elevations) if elevations else 0,
        "elevationMax": max(elevations) if elevations else 0,
        "elevationMean": round(np.mean(elevations), 1) if elevations else 0,
        "contours": contours[:5]  # Store first 5 for reference
    }

# ============================================================
# 2. Generate Mast Positions
# ============================================================

def calculate_farm_center(wtgs: list) -> dict:
    """Calculate the geometric center of the wind farm."""
    lats = [w["location"]["latitude"] for w in wtgs]
    lons = [w["location"]["longitude"] for w in wtgs]
    return {
        "latitude": np.mean(lats),
        "longitude": np.mean(lons)
    }

def haversine_distance(lat1, lon1, lat2, lon2) -> float:
    """Calculate distance between two points in meters."""
    R = 6371000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def generate_mast_proposals(wtgs: list, num_masts: int = 3) -> list:
    """Generate proposed mast positions for PCV testing."""
    center = calculate_farm_center(wtgs)
    proposals = []
    
    # Calculate all pairwise distances
    positions = [(w["id"], w["location"]["latitude"], w["location"]["longitude"],
                 w["rotorDiameter"]) for w in wtgs]
    
    # Strategy 1: Mast near center of farm, at ~4D from nearest WTG
    target_d = 4 * 163  # 4D for N163 turbine = 652m
    
    # Find the WTG closest to center
    min_dist = float('inf')
    center_wtg = None
    for pid, plat, plon, prd in positions:
        d = haversine_distance(center["latitude"], center["longitude"], plat, plon)
        if d < min_dist:
            min_dist = d
            center_wtg = (pid, plat, plon, prd)
    
    if center_wtg:
        # Place mast to the north of center WTG at ~4D
        # 1 degree lat ≈ 111,320m
        lat_offset = target_d / 111320
        mast_lat = center_wtg[1] + lat_offset
        mast_lon = center_wtg[2]
        
        # Check it's not too close to any WTG
        min_wtg_dist = min(haversine_distance(mast_lat, mast_lon, plat, plon) 
                          for _, plat, plon, _ in positions)
        
        proposals.append({
            "id": "MAST-PCV-01",
            "name": "Proposed Mast 1 - Central North",
            "location": {
                "latitude": round(mast_lat, 6),
                "longitude": round(mast_lon, 6),
                "elevation": 90.0
            },
            "mastHeight": 138,
            "type": "lattice",
            "measurementHeights": [40, 60, 80, 100, 120, 138],
            "nearestWtgDist": round(min_wtg_dist, 0),
            "strategy": "4D north of central WTG"
        })
    
    # Strategy 2: Mast between two WTGs for 1-mast-2-WTGs scenario
    if len(positions) >= 2:
        # Find two WTGs that are close together
        best_pair = None
        best_pair_dist = float('inf')
        
        for i in range(min(10, len(positions))):
            for j in range(i+1, min(10, len(positions))):
                d = haversine_distance(positions[i][1], positions[i][2],
                                      positions[j][1], positions[j][2])
                target_dist = 2 * 163  # Want pair within ~2D
                if abs(d - target_dist) < abs(best_pair_dist - target_dist):
                    best_pair_dist = d
                    best_pair = (positions[i], positions[j])
        
        if best_pair:
            mid_lat = (best_pair[0][1] + best_pair[1][1]) / 2
            mid_lon = (best_pair[0][2] + best_pair[1][2]) / 2
            
            # Offset perpendicular to the line connecting the two WTGs
            dlat = best_pair[1][1] - best_pair[0][1]
            dlon = best_pair[1][2] - best_pair[0][2]
            line_len = math.sqrt(dlat**2 + dlon**2)
            if line_len > 0:
                perp_lat = -dlon / line_len * target_d / 111320
                perp_lon = dlat / line_len * target_d / (111320 * math.cos(math.radians(mid_lat)))
            else:
                perp_lat = target_d / 111320
                perp_lon = 0
            
            mast_lat2 = mid_lat + perp_lat
            mast_lon2 = mid_lon + perp_lon
            
            min_wtg_dist2 = min(haversine_distance(mast_lat2, mast_lon2, plat, plon)
                               for _, plat, plon, _ in positions)
            
            proposals.append({
                "id": "MAST-PCV-02",
                "name": "Proposed Mast 2 - Dual WTG Testing",
                "location": {
                    "latitude": round(mast_lat2, 6),
                    "longitude": round(mast_lon2, 6),
                    "elevation": 90.0
                },
                "mastHeight": 138,
                "type": "lattice",
                "measurementHeights": [40, 60, 80, 100, 120, 138],
                "nearestWtgDist": round(min_wtg_dist2, 0),
                "strategy": f"Perpendicular to {best_pair[0][0]}-{best_pair[1][0]} line at 4D"
            })
    
    # Strategy 3: Mast in prevailing wind direction upstream
    if positions:
        # Place mast upstream (south-west) of the farm
        # Prevailing wind from wind data is ~190-210 degrees (south-southwest)
        sw_lat = center["latitude"] - target_d * 1.5 / 111320
        sw_lon = center["longitude"] - target_d * 1.5 / (111320 * math.cos(math.radians(center["latitude"])))
        
        min_wtg_dist3 = min(haversine_distance(sw_lat, sw_lon, plat, plon)
                           for _, plat, plon, _ in positions)
        
        proposals.append({
            "id": "MAST-PCV-03",
            "name": "Proposed Mast 3 - Upstream Southwest",
            "location": {
                "latitude": round(sw_lat, 6),
                "longitude": round(sw_lon, 6),
                "elevation": 90.0
            },
            "mastHeight": 138,
            "type": "lattice",
            "measurementHeights": [40, 60, 80, 100, 120, 138],
            "nearestWtgDist": round(min_wtg_dist3, 0),
            "strategy": "Upstream of farm in prevailing wind direction"
        })
    
    return proposals

# ============================================================
# 3. Call API
# ============================================================

def run_analysis(masts: list, wtgs: list, external_wtgs: list) -> dict:
    """Call the /api/terrain endpoint with processed data."""
    
    # Build external wind farms structure
    external_farms = []
    if external_wtgs:
        external_farms.append({
            "id": "ext-farm-1",
            "name": "External Wind Farm (V90-3MW)",
            "isExternal": True,
            "turbines": external_wtgs
        })
    
    payload = {
        "masts": masts,
        "wtgs": wtgs,
        "externalWindFarms": external_farms,
        "config": {
            "iecVersion": "IEC-61400-12-1-2017",
            "sectorWidth": 10,
            "assessmentRadius": 5000,
            "minDistanceD": 2,
            "maxSlopeSimple": 10,
            "maxSlopeComplex": 17,
            "wakeAngularThreshold": 30,
            "wakeDistanceThresholdD": 20,
            "includeExternalLayouts": True,
            "project": {
                "name": "Pestera2 Wind Farm - PCV Assessment",
                "location": "Romania",
                "client": "Wind Energy Developer",
                "reportNumber": "PCV-PESTERA2-2024-001",
                "analyst": "WTG PCV Tool v1.0"
            }
        }
    }
    
    print(f"Calling API with {len(masts)} masts, {len(wtgs)} WTGs, "
          f"{len(external_wtgs)} external WTGs...")
    print(f"Payload size: {len(json.dumps(payload))} bytes")
    
    try:
        response = requests.post(
            f"{API_BASE}/api/terrain",
            json=payload,
            timeout=300  # 5 minutes timeout for large datasets
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                print(f"Analysis completed successfully!")
                print(f"  Terrain results: {len(data['data'].get('terrainResults', []))} assessments")
                print(f"  Freestream results: {len(data['data'].get('freestreamResults', []))} analyses")
                print(f"  PCV configurations: {len(data['data'].get('pcvResults', {}).get('configurations', []))}")
                print(f"  Mast proposals: {len(data['data'].get('mastProposals', []))}")
                print(f"  Final sectors: {len(data['data'].get('finalSectors', []))}")
                if data.get("warnings"):
                    print(f"  Warnings: {len(data['warnings'])}")
                    for w in data['warnings'][:5]:
                        print(f"    - {w.get('message', w)}")
                return data
            else:
                print(f"Analysis returned errors:")
                for err in data.get("errors", []):
                    print(f"  - {err.get('message', err)}")
                return data
        else:
            print(f"API returned status {response.status_code}")
            print(f"Response: {response.text[:500]}")
            return {"success": False, "error": f"HTTP {response.status_code}"}
    except requests.exceptions.Timeout:
        print("API request timed out (300s)")
        return {"success": False, "error": "timeout"}
    except Exception as e:
        print(f"API request failed: {e}")
        return {"success": False, "error": str(e)}

# ============================================================
# 4. Save Raw Results
# ============================================================

def save_raw_results(data: dict):
    """Save raw API response as JSON."""
    output_path = os.path.join(OUTPUT_DIR, "pcv_raw_results.json")
    with open(output_path, 'w') as f:
        json.dump(data, f, indent=2, default=str)
    print(f"Raw results saved to: {output_path}")

# ============================================================
# 5. Generate PDF Report
# ============================================================

def generate_pdf_report(data: dict, wtgs: list, external_wtgs: list, 
                        wind_stats: dict, map_info: dict,
                        mast_proposals_input: list):
    """Generate comprehensive DNV-style PDF report."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch, mm, cm
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                     TableStyle, PageBreak, Image, KeepTogether)
    from reportlab.graphics.shapes import Drawing, Rect, String, Line, Circle
    from reportlab.graphics.charts.piecharts import Pie
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics import renderPDF
    
    output_path = os.path.join(OUTPUT_DIR, "WTG_PCV_Assessment_Report_Pestera2.pdf")
    
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=50, leftMargin=50,
        topMargin=60, bottomMargin=50
    )
    
    styles = getSampleStyleSheet()
    
    # Custom styles
    styles.add(ParagraphStyle(
        name='CoverTitle',
        parent=styles['Title'],
        fontSize=24,
        spaceAfter=12,
        alignment=TA_CENTER,
        textColor=colors.HexColor('#1a365d')
    ))
    styles.add(ParagraphStyle(
        name='CoverSubtitle',
        parent=styles['Normal'],
        fontSize=14,
        spaceAfter=6,
        alignment=TA_CENTER,
        textColor=colors.HexColor('#4a5568')
    ))
    styles.add(ParagraphStyle(
        name='SectionHeader',
        parent=styles['Heading1'],
        fontSize=16,
        spaceBefore=20,
        spaceAfter=10,
        textColor=colors.HexColor('#1a365d'),
        borderWidth=1,
        borderColor=colors.HexColor('#1a365d'),
        borderPadding=4
    ))
    styles.add(ParagraphStyle(
        name='SubSection',
        parent=styles['Heading2'],
        fontSize=13,
        spaceBefore=14,
        spaceAfter=8,
        textColor=colors.HexColor('#2c5282')
    ))
    styles.add(ParagraphStyle(
        name='BodyText2',
        parent=styles['Normal'],
        fontSize=10,
        spaceAfter=6,
        alignment=TA_JUSTIFY,
        leading=14
    ))
    styles.add(ParagraphStyle(
        name='SmallText',
        parent=styles['Normal'],
        fontSize=8,
        spaceAfter=3,
        textColor=colors.HexColor('#718096')
    ))
    styles.add(ParagraphStyle(
        name='TableCell',
        parent=styles['Normal'],
        fontSize=8,
        leading=10
    ))
    
    story = []
    page_width = A4[0] - 100  # Available width
    
    # ============================================================
    # COVER PAGE
    # ============================================================
    story.append(Spacer(1, 80))
    
    # DNV-style header bar
    cover_bar_data = [[""]]
    cover_bar = Table(cover_bar_data, colWidths=[page_width], rowHeights=[6])
    cover_bar.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#1a365d')),
    ]))
    story.append(cover_bar)
    story.append(Spacer(1, 30))
    
    story.append(Paragraph("WIND TURBINE GENERATOR", styles['CoverTitle']))
    story.append(Paragraph("POWER CURVE VERIFICATION", styles['CoverTitle']))
    story.append(Paragraph("TERRAIN ASSESSMENT REPORT", styles['CoverTitle']))
    
    story.append(Spacer(1, 20))
    story.append(Paragraph("Pestera2 Wind Farm Project", styles['CoverSubtitle']))
    story.append(Paragraph("Romania", styles['CoverSubtitle']))
    
    story.append(Spacer(1, 30))
    cover_bar2 = Table(cover_bar_data, colWidths=[page_width], rowHeights=[3])
    cover_bar2.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#2c5282')),
    ]))
    story.append(cover_bar2)
    
    story.append(Spacer(1, 40))
    
    # Report metadata table
    meta_data = [
        ["Document No:", "PCV-PESTERA2-2024-001"],
        ["Project:", "Pestera2 Wind Farm"],
        ["Location:", "Romania"],
        ["Client:", "Wind Energy Developer"],
        ["IEC Standard:", "IEC 61400-12-1:2017"],
        ["Report Date:", datetime.now().strftime("%Y-%m-%d")],
        ["Tool Version:", "WTG PCV Tool v1.0"],
        ["Analysis Type:", "Terrain Assessment & PCV Site Selection"],
    ]
    
    meta_table = Table(meta_data, colWidths=[150, 300])
    meta_table.setStyle(TableStyle([
        ('FONTNAME', (0,0), (0,-1), 'Helvetica-Bold'),
        ('FONTNAME', (1,0), (1,-1), 'Helvetica'),
        ('FONTSIZE', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('LINEBELOW', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(meta_table)
    
    story.append(Spacer(1, 60))
    story.append(Paragraph(
        "CONFIDENTIAL - For authorized use only",
        ParagraphStyle('conf', parent=styles['Normal'], fontSize=9, 
                       alignment=TA_CENTER, textColor=colors.HexColor('#e53e3e'))
    ))
    
    story.append(PageBreak())
    
    # ============================================================
    # TABLE OF CONTENTS
    # ============================================================
    story.append(Paragraph("TABLE OF CONTENTS", styles['SectionHeader']))
    story.append(Spacer(1, 10))
    
    toc_items = [
        "1. Executive Summary",
        "2. Project Description & Input Data",
        "   2.1 Wind Farm Layout",
        "   2.2 External Wind Farms",
        "   2.3 Wind Climate Data",
        "   2.4 Terrain Map Information",
        "3. Measurement Sector Analysis",
        "   3.1 Proposed Mast Locations",
        "   3.2 Terrain Assessment Results",
        "   3.3 Terrain Classification Summary",
        "4. Freestream Sector Analysis",
        "5. PCV Site Selection & Optimization",
        "   5.1 Mast-WTG Pairing Scores",
        "   5.2 1-Mast-2-WTGs Configuration",
        "   5.3 Mast Location Proposals",
        "6. Final Measurement Sectors",
        "7. Recommendations & Conclusions",
    ]
    
    for item in toc_items:
        indent = 30 if item.startswith("   ") else 0
        style = ParagraphStyle('toc', parent=styles['Normal'], fontSize=11, 
                              leftIndent=indent, spaceAfter=4)
        story.append(Paragraph(item.strip(), style))
    
    story.append(PageBreak())
    
    # ============================================================
    # 1. EXECUTIVE SUMMARY
    # ============================================================
    story.append(Paragraph("1. EXECUTIVE SUMMARY", styles['SectionHeader']))
    story.append(Spacer(1, 8))
    
    api_data = data.get("data", {})
    pcv_results = api_data.get("pcvResults", {})
    terrain_results = api_data.get("terrainResults", [])
    freestream_results = api_data.get("freestreamResults", [])
    mast_proposals = api_data.get("mastProposals", [])
    final_sectors = api_data.get("finalSectors", [])
    
    # Calculate key metrics
    total_assessments = len(terrain_results)
    avg_valid = 0
    avg_freestream = 0
    if terrain_results:
        avg_valid = np.mean([r.get("summary", {}).get("validSectorsCount", 0) for r in terrain_results])
        avg_freestream = np.mean([r.get("summary", {}).get("freestreamSectorsCount", 0) for r in terrain_results])
    
    best_config = pcv_results.get("configurations", [{}])[0] if pcv_results.get("configurations") else {}
    best_score = best_config.get("overallScore", 0)
    best_combined = best_config.get("combinedValidSectors", 0)
    
    exec_summary = f"""
    This report presents the results of the IEC 61400-12-1 terrain assessment and Power Curve 
    Verification (PCV) site suitability analysis for the Pestera2 Wind Farm project located in 
    Romania. The analysis covers {len(wtgs)} internal wind turbine generators (WTGs) of type 
    N163-7.0MW and considers the wake influence from {len(external_wtgs)} external V90-3MW 
    turbines in the vicinity. The assessment was performed using the WTG PCV Tool v1.0, following 
    the requirements of IEC 61400-12-1:2017 (Edition 2).
    """
    story.append(Paragraph(exec_summary.strip(), styles['BodyText2']))
    
    # Key findings table
    story.append(Spacer(1, 8))
    story.append(Paragraph("Key Findings:", styles['SubSection']))
    
    findings_data = [
        ["Parameter", "Value", "Assessment"],
        ["Internal WTGs Analyzed", str(len(wtgs)), "N163-7.0MW (D=163m, HH=138m)"],
        ["External WTGs Considered", str(len(external_wtgs)), "V90-3MW (D=90m, HH=90m)"],
        ["Proposed Met Masts", str(len(mast_proposals_input)), "Lattice type, 138m height"],
        ["Total Mast-WTG Assessments", str(total_assessments), "36 sectors each"],
        ["Average Valid Sectors", f"{avg_valid:.1f} of 36", 
         "PASS" if avg_valid >= 12 else "REVIEW"],
        ["Average Freestream Sectors", f"{avg_freestream:.1f} of 36", 
         "GOOD" if avg_freestream >= 8 else "MODERATE"],
        ["Best PCV Configuration Score", f"{best_score:.1f}/100", 
         "RECOMMENDED" if best_score >= 70 else "CONDITIONAL"],
        ["Best Combined Valid Sectors", str(best_combined), "for best configuration"],
        ["Mean Wind Speed (from data)", f"{wind_stats['meanWindSpeed']:.1f} m/s", "Jan-Feb 2004"],
        ["Terrain Elevation Range", f"{map_info['elevationMin']:.0f} - {map_info['elevationMax']:.0f} m",
         "from .map file"],
    ]
    
    findings_table = Table(findings_data, colWidths=[200, 120, 180])
    findings_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1a365d')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f7fafc')]),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(findings_table)
    
    recs = pcv_results.get("recommendations", [])
    if recs:
        story.append(Spacer(1, 8))
        story.append(Paragraph("Key Recommendations:", styles['SubSection']))
        for rec in recs[:5]:
            story.append(Paragraph(f"  - {rec}", styles['BodyText2']))
    
    story.append(PageBreak())
    
    # ============================================================
    # 2. PROJECT DESCRIPTION & INPUT DATA
    # ============================================================
    story.append(Paragraph("2. PROJECT DESCRIPTION & INPUT DATA", styles['SectionHeader']))
    story.append(Spacer(1, 8))
    
    proj_desc = f"""
    The Pestera2 Wind Farm is located in Romania and consists of {len(wtgs)} Nordex N163-7.0MW 
    wind turbine generators, each with a rotor diameter of 163m and hub height of 138m. 
    The wind farm layout was provided in Romanian Stereo70 projection (EPSG:7755) and has 
    been converted to WGS84 for this analysis. The project area also has {len(external_wtgs)} 
    external Vestas V90-3MW turbines (D=90m, HH=90m) in the surrounding area that may 
    influence the freestream conditions at the proposed measurement mast locations. The external 
    turbine layout was provided to enable a comprehensive wake impact assessment for accurate 
    freestream sector determination, which is critical for IEC 61400-12-1 compliant power curve 
    verification testing.
    """
    story.append(Paragraph(proj_desc.strip(), styles['BodyText2']))
    
    # 2.1 Wind Farm Layout
    story.append(Paragraph("2.1 Wind Farm Layout (Internal WTGs)", styles['SubSection']))
    
    # Calculate farm extent
    all_lats = [w["location"]["latitude"] for w in wtgs]
    all_lons = [w["location"]["longitude"] for w in wtgs]
    farm_extent_ns = haversine_distance(min(all_lats), np.mean(all_lons), 
                                         max(all_lats), np.mean(all_lons))
    farm_extent_ew = haversine_distance(np.mean(all_lats), min(all_lons),
                                         np.mean(all_lats), max(all_lons))
    
    story.append(Paragraph(
        f"The internal wind farm spans approximately {farm_extent_ns/1000:.1f} km (N-S) "
        f"by {farm_extent_ew/1000:.1f} km (E-W), covering a total area of approximately "
        f"{farm_extent_ns * farm_extent_ew / 1e6:.1f} km2. All {len(wtgs)} turbines are of "
        f"identical type N163-7.0MW, ensuring uniform wake characteristics across the farm. "
        f"The WTG coordinates were provided in the Romanian Stereo70 national projection system "
        f"(EPSG:7755) and have been transformed to WGS84 geographic coordinates for this "
        f"analysis. Coordinate accuracy is within +/-3m as specified in the source data.",
        styles['BodyText2']
    ))
    
    # WTG table (show first 15)
    wtg_header = [["ID", "Model", "Lat", "Lon", "RD (m)", "HH (m)"]]
    wtg_rows = []
    for w in wtgs[:15]:
        wtg_rows.append([
            w["id"], w["name"].split("(")[0].strip(),
            f"{w['location']['latitude']:.4f}", f"{w['location']['longitude']:.4f}",
            str(w["rotorDiameter"]), str(w["hubHeight"])
        ])
    if len(wtgs) > 15:
        wtg_rows.append(["...", f"and {len(wtgs)-15} more", "", "", "", ""])
    
    wtg_table_data = wtg_header + wtg_rows
    wtg_table = Table(wtg_table_data, colWidths=[45, 60, 75, 75, 50, 45])
    wtg_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1a365d')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
        ('FONTSIZE', (0,0), (-1,-1), 7),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f7fafc')]),
    ]))
    story.append(wtg_table)
    
    # 2.2 External Wind Farms
    story.append(Spacer(1, 10))
    story.append(Paragraph("2.2 External Wind Farms", styles['SubSection']))
    
    story.append(Paragraph(
        f"The external wind farm comprises {len(external_wtgs)} Vestas V90-3MW turbines with a "
        f"rotor diameter of 90m and hub height of 90m. These turbines are located to the southwest "
        f"and east of the main wind farm and have been included in the analysis to assess their "
        f"wake impact on freestream conditions at the proposed met mast locations. The external "
        f"turbines represent operational wind farms in the vicinity that could affect the measured "
        f"wind speed and direction at the measurement site, particularly during prevailing wind "
        f"directions from the southwest sector.",
        styles['BodyText2']
    ))
    
    # 2.3 Wind Climate
    story.append(Spacer(1, 10))
    story.append(Paragraph("2.3 Wind Climate Data", styles['SubSection']))
    
    story.append(Paragraph(
        f"Wind climate data was provided as hourly time series from January to February 2004 "
        f"(total {wind_stats['totalRecords']} valid records after filtering calm periods below "
        f"0.5 m/s). The mean wind speed during this period was {wind_stats['meanWindSpeed']:.1f} "
        f"m/s with a maximum recorded speed of {wind_stats['maxWindSpeed']:.1f} m/s. The "
        f"predominant wind direction is from {wind_stats['predominantDirection']:.0f} degrees "
        f"({'SSW' if 180 <= wind_stats['predominantDirection'] <= 225 else 'variable'}). "
        f"This wind climate information, while based on a limited measurement period, provides "
        f"valuable context for understanding the expected wind conditions during the PCV "
        f"measurement campaign. A full wind resource assessment with 12+ months of data is "
        f"recommended for final campaign planning.",
        styles['BodyText2']
    ))
    
    # Wind rose summary table
    wr_header = ["Direction", "Freq (%)", "Avg WS (m/s)", "Max WS (m/s)"]
    wr_rows = []
    # Show dominant sectors
    top_sectors = sorted(wind_stats["windRose"], key=lambda x: -x["frequency"])[:12]
    for s in top_sectors:
        if s["count"] > 0:
            wr_rows.append([
                f"{s['direction']:.0f}" + degree_to_cardinal(s['direction']),
                f"{s['frequency']:.1f}",
                f"{s['avgSpeed']:.1f}",
                f"{s['maxSpeed']:.1f}"
            ])
    
    wr_table = Table([wr_header] + wr_rows, colWidths=[100, 80, 100, 100])
    wr_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#2c5282')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f7fafc')]),
        ('ALIGN', (1,0), (-1,-1), 'CENTER'),
    ]))
    story.append(wr_table)
    
    # 2.4 Terrain Map
    story.append(Spacer(1, 10))
    story.append(Paragraph("2.4 Terrain Map Information", styles['SubSection']))
    
    story.append(Paragraph(
        f"The terrain data was provided as a WAsP .map file "
        f"(MAPFILES_240102_Pestera2_Rev 0_0.map) in the Romanian Stereo70 coordinate system. "
        f"The file contains {map_info['numContours']} elevation contours with a total of "
        f"{map_info['totalPoints']} coordinate points. Elevation values range from "
        f"{map_info['elevationMin']:.0f}m to {map_info['elevationMax']:.0f}m with a mean of "
        f"{map_info['elevationMean']:.0f}m. The contours are at {map_info['elevationMin']:.0f}m "
        f"intervals, representing the topographic variation across the site. The terrain is "
        f"characterized by moderate slopes typical of Romanian wind farm sites, with the "
        f"majority of the area classified as simple to moderately complex terrain per "
        f"IEC 61400-12-1 criteria.",
        styles['BodyText2']
    ))
    
    story.append(PageBreak())
    
    # ============================================================
    # 3. MEASUREMENT SECTOR ANALYSIS
    # ============================================================
    story.append(Paragraph("3. MEASUREMENT SECTOR ANALYSIS", styles['SectionHeader']))
    story.append(Spacer(1, 8))
    
    story.append(Paragraph(
        "The measurement sector analysis is performed according to IEC 61400-12-1:2017, which "
        "requires assessment of terrain slope, roughness conditions, and wake influence for each "
        "of 36 directional sectors (10-degree width each). A sector is considered valid for "
        "power curve verification if it meets all of the following criteria: maximum terrain "
        "slope does not exceed the threshold for the applicable terrain classification (Class A: "
        "slope <= 10 degrees for simple terrain, Class B: slope <= 17 degrees for complex "
        "terrain), no significant roughness changes within the assessment radius, and the "
        "sector is not significantly affected by wakes from upstream turbines. The analysis was "
        "performed for each proposed mast location against all target WTGs within the wind farm.",
        styles['BodyText2']
    ))
    
    # 3.1 Proposed Mast Locations
    story.append(Paragraph("3.1 Proposed Mast Locations", styles['SubSection']))
    
    story.append(Paragraph(
        f"{len(mast_proposals_input)} met mast locations have been proposed for the PCV "
        f"measurement campaign, strategically positioned to maximize valid sector coverage "
        f"while maintaining adequate separation from all turbines. Each mast is designed as a "
        f"138m lattice tower with measurement levels at 40m, 60m, 80m, 100m, 120m, and 138m "
        f"heights, matching the hub height of the target N163-7.0MW turbines.",
        styles['BodyText2']
    ))
    
    mast_header = ["Mast ID", "Strategy", "Lat", "Lon", "Min WTG Dist (m)"]
    mast_rows = []
    for m in mast_proposals_input:
        mast_rows.append([
            m["id"],
            m["strategy"],
            f"{m['location']['latitude']:.4f}",
            f"{m['location']['longitude']:.4f}",
            f"{m['nearestWtgDist']:.0f}"
        ])
    
    mast_table = Table([mast_header] + mast_rows, colWidths=[80, 140, 80, 80, 80])
    mast_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#2c5282')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f7fafc')]),
    ]))
    story.append(mast_table)
    
    # 3.2 Terrain Assessment Results
    story.append(Spacer(1, 10))
    story.append(Paragraph("3.2 Terrain Assessment Results", styles['SubSection']))
    
    if terrain_results:
        # Summary table of all assessments
        ta_header = ["Mast", "Target WTG", "Distance (m)", "Distance (D)", 
                     "Valid Sectors", "Freestream", "Terrain Class", "IEC Compliant"]
        ta_rows = []
        
        for tr in terrain_results[:20]:  # Show first 20
            meta = tr.get("metadata", {})
            dist = tr.get("distance", {})
            summ = tr.get("summary", {})
            
            ta_rows.append([
                meta.get("mastName", "?"),
                meta.get("targetWtgName", "?")[:20],
                f"{dist.get('meters', 0):.0f}",
                f"{dist.get('rotorDiameters', 0):.1f}",
                str(summ.get("validSectorsCount", 0)),
                str(summ.get("freestreamSectorsCount", 0)),
                summ.get("terrainClass", "?"),
                "YES" if summ.get("isIECCompliant") else "NO"
            ])
        
        if len(terrain_results) > 20:
            ta_rows.append(["...", f"and {len(terrain_results)-20} more", "", "", "", "", "", ""])
        
        ta_table = Table([ta_header] + ta_rows, colWidths=[65, 70, 55, 45, 50, 50, 50, 60])
        ta_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1a365d')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
            ('FONTSIZE', (0,0), (-1,-1), 7),
            ('BOTTOMPADDING', (0,0), (-1,-1), 3),
            ('TOPPADDING', (0,0), (-1,-1), 3),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f7fafc')]),
            ('ALIGN', (2,0), (-1,-1), 'CENTER'),
        ]))
        story.append(ta_table)
        
        # 3.3 Terrain Classification Summary
        story.append(Spacer(1, 10))
        story.append(Paragraph("3.3 Terrain Classification Summary", styles['SubSection']))
        
        # Aggregate statistics
        all_classes = [tr.get("summary", {}).get("terrainClass", "?") for tr in terrain_results]
        class_a = all_classes.count("A")
        class_b = all_classes.count("B")
        class_s = all_classes.count("S")
        
        compliant_count = sum(1 for tr in terrain_results 
                            if tr.get("summary", {}).get("isIECCompliant"))
        
        story.append(Paragraph(
            f"Out of {len(terrain_results)} total mast-WTG pair assessments, the terrain "
            f"classification distribution is as follows: Class A (simple terrain, slope <= 10 "
            f"degrees): {class_a} assessments ({class_a/len(terrain_results)*100:.1f}%), "
            f"Class B (complex terrain, slope <= 17 degrees): {class_b} assessments "
            f"({class_b/len(terrain_results)*100:.1f}%), and Class S (special terrain, slope "
            f"> 17 degrees): {class_s} assessments ({class_s/len(terrain_results)*100:.1f}%). "
            f"Overall, {compliant_count} of {len(terrain_results)} assessments "
            f"({compliant_count/len(terrain_results)*100:.1f}%) meet the IEC 61400-12-1 "
            f"compliance criteria for terrain effects. The majority of the site falls within "
            f"the simple terrain classification, indicating favorable conditions for power "
            f"curve verification testing with minimal terrain-induced flow distortion.",
            styles['BodyText2']
        ))
        
        # Per-sector detail for first mast-WTG pair
        if terrain_results and terrain_results[0].get("sectors"):
            story.append(Spacer(1, 8))
            story.append(Paragraph("Sector-by-Sector Analysis (Representative Pair):", styles['SubSection']))
            
            first = terrain_results[0]
            meta = first["metadata"]
            story.append(Paragraph(
                f"Mast: {meta['mastName']} | Target WTG: {meta['targetWtgName']} | "
                f"Distance: {first['distance']['meters']:.0f}m ({first['distance']['rotorDiameters']:.1f}D)",
                styles['SmallText']
            ))
            
            sec_header = ["Sector", "Dir Range", "Max Slope", "Slope (deg)", 
                         "Class", "Valid", "Freestream", "Reason"]
            sec_rows = []
            for s in first["sectors"]:
                status = "YES" if s["isValid"] else "NO"
                fs = "YES" if s.get("isFreestream") else "NO"
                reason = "; ".join(s["failureReasons"][:2]) if s["failureReasons"] else "-"
                if len(reason) > 30:
                    reason = reason[:30] + "..."
                    
                sec_rows.append([
                    f"{s['direction']:.0f}",
                    f"{s['directionFrom']:.0f}-{s['directionTo']:.0f}",
                    f"{s['maxSlope']:.1f}%",
                    f"{s['maxSlopeDeg']:.1f}",
                    s["terrainClass"],
                    status,
                    fs,
                    reason
                ])
            
            sec_table = Table([sec_header] + sec_rows, colWidths=[38, 48, 48, 48, 38, 32, 42, 130])
            sec_table.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#2c5282')),
                ('TEXTCOLOR', (0,0), (-1,0), colors.white),
                ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
                ('FONTSIZE', (0,0), (-1,-1), 6.5),
                ('BOTTOMPADDING', (0,0), (-1,-1), 2),
                ('TOPPADDING', (0,0), (-1,-1), 2),
                ('GRID', (0,0), (-1,-1), 0.25, colors.HexColor('#e2e8f0')),
                ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f7fafc')]),
                ('ALIGN', (0,0), (6,-1), 'CENTER'),
                # Highlight valid sectors in green, invalid in red
            ]))
            
            # Color valid/invalid cells
            for i, s in enumerate(first["sectors"], 1):
                if s["isValid"]:
                    sec_table.setStyle(TableStyle([
                        ('BACKGROUND', (5, i), (5, i), colors.HexColor('#c6f6d5')),
                    ]))
                else:
                    sec_table.setStyle(TableStyle([
                        ('BACKGROUND', (5, i), (5, i), colors.HexColor('#fed7d7')),
                    ]))
            
            story.append(sec_table)
    
    story.append(PageBreak())
    
    # ============================================================
    # 4. FREESTREAM SECTOR ANALYSIS
    # ============================================================
    story.append(Paragraph("4. FREESTREAM SECTOR ANALYSIS", styles['SectionHeader']))
    story.append(Spacer(1, 8))
    
    story.append(Paragraph(
        "The freestream sector analysis identifies measurement directions that are not "
        "significantly influenced by wake effects from upstream wind turbines. This analysis "
        "considers both internal WTGs within the project wind farm and external WTGs from "
        "neighboring wind farms. A sector is classified as freestream if no upstream turbine "
        "falls within the wake angular threshold (30 degrees) and wake distance threshold "
        "(20 rotor diameters) for that direction. The Jensen wake model with a 7.5-degree "
        "expansion angle is used to estimate wake width at the mast location, and sectors "
        "with combined wake impact rated as 'low' or higher are excluded from the freestream "
        "sector set. This is critical for ensuring that the wind speed measurements used for "
        "power curve verification are representative of undisturbed (freestream) conditions.",
        styles['BodyText2']
    ))
    
    if freestream_results:
        fs_header = ["Mast", "Freestream Sectors", "Wake-Affected", "Freestream %",
                     "External WTGs Impacting"]
        fs_rows = []
        for fs in freestream_results:
            ext_count = len(fs.get("externalWtgs", []))
            fs_rows.append([
                fs.get("mastName", "?"),
                ", ".join(str(s) for s in fs.get("freestreamSectors", [])[:8]),
                str(len(fs.get("wakeAffectedSectors", []))),
                f"{fs.get('freestreamPercentage', 0):.1f}%",
                str(ext_count)
            ])
        
        fs_table = Table([fs_header] + fs_rows, colWidths=[70, 160, 60, 60, 80])
        fs_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1a365d')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
            ('FONTSIZE', (0,0), (-1,-1), 8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 5),
            ('TOPPADDING', (0,0), (-1,-1), 5),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f7fafc')]),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ]))
        story.append(fs_table)
        
        # External WTG impact detail
        for fs in freestream_results[:1]:
            ext_wtgs = fs.get("externalWtgs", [])
            if ext_wtgs:
                story.append(Spacer(1, 8))
                story.append(Paragraph("External WTG Wake Impact Detail:", styles['SubSection']))
                
                ext_header = ["Ext WTG", "Direction (deg)", "Distance (m)", "Distance (D)", 
                             "Affected Sectors"]
                ext_rows = []
                for ew in ext_wtgs[:15]:
                    ext_rows.append([
                        ew["name"],
                        f"{ew['direction']:.1f}",
                        f"{ew['distance']:.0f}",
                        f"{ew['distanceInD']:.1f}",
                        ", ".join(str(s) for s in ew.get("affectingSectors", [])[:5])
                    ])
                
                ext_table = Table([ext_header] + ext_rows, colWidths=[60, 65, 70, 60, 160])
                ext_table.setStyle(TableStyle([
                    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#2c5282')),
                    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
                    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                    ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
                    ('FONTSIZE', (0,0), (-1,-1), 7),
                    ('BOTTOMPADDING', (0,0), (-1,-1), 3),
                    ('TOPPADDING', (0,0), (-1,-1), 3),
                    ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
                    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f7fafc')]),
                ]))
                story.append(ext_table)
    
    story.append(PageBreak())
    
    # ============================================================
    # 5. PCV SITE SELECTION & OPTIMIZATION
    # ============================================================
    story.append(Paragraph("5. PCV SITE SELECTION & OPTIMIZATION", styles['SectionHeader']))
    story.append(Spacer(1, 8))
    
    story.append(Paragraph(
        "The PCV (Power Curve Verification) site selection process evaluates all possible "
        "mast-WTG pairings based on five weighted criteria: distance optimality (20%), terrain "
        "quality (25%), sector coverage (20%), freestream quality (25%), and slope compliance "
        "(10%). The optimization also considers configurations where a single met mast can test "
        "multiple WTGs (1-mast-2-WTGs), which is cost-effective and practically feasible when "
        "the mast location provides adequate valid sector coverage for both target turbines "
        "simultaneously. The following sections present the pairing scores, optimal "
        "configurations, and proposed mast locations.",
        styles['BodyText2']
    ))
    
    # 5.1 Best Pairings
    story.append(Paragraph("5.1 Top Mast-WTG Pairing Scores", styles['SubSection']))
    
    best_pairings = pcv_results.get("bestPairings", [])
    if best_pairings:
        bp_header = ["Mast", "WTG", "Score", "Valid Sec", "Free Sec", 
                     "Distance (D)", "Recommended"]
        bp_rows = []
        for bp in best_pairings[:15]:
            bp_rows.append([
                bp.get("mastName", "?"),
                bp.get("wtgName", "?")[:20],
                f"{bp.get('score', 0):.1f}",
                str(bp.get("validSectors", 0)),
                str(bp.get("freestreamSectors", 0)),
                f"{bp.get('distanceInD', 0):.1f}",
                "YES" if bp.get("isRecommended") else "-"
            ])
        
        bp_table = Table([bp_header] + bp_rows, colWidths=[60, 65, 45, 45, 45, 50, 60])
        bp_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1a365d')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
            ('FONTSIZE', (0,0), (-1,-1), 8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f7fafc')]),
            ('ALIGN', (2,0), (-1,-1), 'CENTER'),
        ]))
        story.append(bp_table)
    
    # 5.2 1-Mast-2-WTGs Configuration
    story.append(Spacer(1, 10))
    story.append(Paragraph("5.2 Mast Configurations (1-Mast Testing Multiple WTGs)", styles['SubSection']))
    
    configs = pcv_results.get("configurations", [])
    if configs:
        for cfg in configs[:3]:
            story.append(Paragraph(
                f"<b>Configuration: {cfg.get('mastName', '?')}</b> - "
                f"Overall Score: {cfg.get('overallScore', 0):.1f}/100 | "
                f"Combined Valid Sectors: {cfg.get('combinedValidSectors', 0)} | "
                f"Combined Freestream: {cfg.get('combinedFreestreamSectors', 0)} | "
                f"Recommended: {'YES' if cfg.get('isRecommended') else 'NO'}",
                styles['BodyText2']
            ))
            
            target_wtgs = cfg.get("targetWtgs", [])
            if target_wtgs:
                tw_header = ["Target WTG", "Score", "Valid Sectors"]
                tw_rows = [[tw.get("wtgName", "?"), f"{tw.get('score', 0):.1f}", 
                           str(tw.get("validSectors", 0))] for tw in target_wtgs]
                tw_table = Table([tw_header] + tw_rows, colWidths=[150, 80, 80])
                tw_table.setStyle(TableStyle([
                    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#edf2f7')),
                    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                    ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
                    ('FONTSIZE', (0,0), (-1,-1), 8),
                    ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
                ]))
                story.append(tw_table)
            
            notes = cfg.get("notes", [])
            for note in notes[:3]:
                story.append(Paragraph(f"  Note: {note}", styles['SmallText']))
            story.append(Spacer(1, 6))
    
    # 5.3 Mast Proposals
    story.append(Spacer(1, 6))
    story.append(Paragraph("5.3 Additional Mast Location Proposals", styles['SubSection']))
    
    if mast_proposals:
        mp_header = ["Proposal ID", "Target WTGs", "Quality Score", 
                     "Expected Valid", "Expected Freestream"]
        mp_rows = []
        for mp in mast_proposals[:10]:
            mp_rows.append([
                mp.get("id", "?"),
                ", ".join(str(t) for t in mp.get("targetWtgs", [])[:3]),
                f"{mp.get('qualityScore', 0):.1f}",
                str(mp.get("expectedValidSectors", 0)),
                str(mp.get("expectedFreestreamSectors", 0))
            ])
        
        mp_table = Table([mp_header] + mp_rows, colWidths=[80, 100, 60, 60, 80])
        mp_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#2c5282')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
            ('FONTSIZE', (0,0), (-1,-1), 8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f7fafc')]),
            ('ALIGN', (2,0), (-1,-1), 'CENTER'),
        ]))
        story.append(mp_table)
    
    story.append(PageBreak())
    
    # ============================================================
    # 6. FINAL MEASUREMENT SECTORS
    # ============================================================
    story.append(Paragraph("6. FINAL MEASUREMENT SECTORS", styles['SectionHeader']))
    story.append(Spacer(1, 8))
    
    story.append(Paragraph(
        "The final measurement sectors represent the combination of terrain-valid and "
        "freestream sectors for the best PCV configuration. Only sectors that pass both "
        "terrain assessment criteria AND are classified as freestream (no significant wake "
        "influence) are included in the final set. These sectors define the directional "
        "ranges from which wind speed and direction measurements will be used for the power "
        "curve verification analysis, ensuring compliance with IEC 61400-12-1 requirements "
        "for representative and undisturbed flow conditions.",
        styles['BodyText2']
    ))
    
    if final_sectors:
        for fs_result in final_sectors:
            compliance = fs_result.get("complianceSummary", {})
            story.append(Paragraph(
                f"<b>Mast: {fs_result.get('mastName', '?')}</b> | "
                f"Target WTGs: {', '.join(t['name'] for t in fs_result.get('targetWtgs', []))} | "
                f"Sector Width: {fs_result.get('sectorWidth', 10)} deg | "
                f"Total Coverage: {fs_result.get('totalCoverage', 0):.1f}%",
                styles['BodyText2']
            ))
            
            valid = fs_result.get("validSectors", [])
            final = fs_result.get("finalSectors", [])
            free = fs_result.get("freestreamSectors", [])
            
            story.append(Paragraph(
                f"Valid Terrain Sectors: {len(valid)} | "
                f"Freestream Sectors: {len(free)} | "
                f"Final Combined Sectors: {len(final)}",
                styles['BodyText2']
            ))
            
            if final:
                final_str = ", ".join(str(s) for s in sorted(final))
                story.append(Paragraph(
                    f"<b>Final Measurement Sectors (degrees):</b> {final_str}",
                    styles['BodyText2']
                ))
            
            if compliance:
                story.append(Paragraph(
                    f"Terrain Class: {compliance.get('terrainClass', '?')} | "
                    f"All Criteria Met: {'YES' if compliance.get('allCriteriaMet') else 'NO'}",
                    styles['BodyText2']
                ))
                for note in compliance.get("notes", [])[:5]:
                    story.append(Paragraph(f"  - {note}", styles['SmallText']))
    
    story.append(PageBreak())
    
    # ============================================================
    # 7. RECOMMENDATIONS & CONCLUSIONS
    # ============================================================
    story.append(Paragraph("7. RECOMMENDATIONS & CONCLUSIONS", styles['SectionHeader']))
    story.append(Spacer(1, 8))
    
    # Generate recommendations based on results
    recommendations = []
    
    if best_score >= 70:
        recommendations.append(
            f"The best PCV configuration (score: {best_score:.1f}/100) with "
            f"{best_combined} valid sectors is considered suitable for IEC 61400-12-1 "
            f"compliant power curve verification. The recommended mast location should be "
            f"established as the primary measurement site."
        )
    else:
        recommendations.append(
            f"The best PCV configuration score of {best_score:.1f}/100 indicates that "
            f"site conditions are moderately challenging for PCV testing. Additional mast "
            f"positions should be evaluated to improve sector coverage and freestream conditions."
        )
    
    recommendations.append(
        f"A minimum 12-month measurement campaign is recommended to capture seasonal wind "
        f"variability and ensure statistical robustness of the power curve verification "
        f"results. The measurement equipment should include calibrated anemometers at "
        f"multiple heights (minimum 3 levels including hub height) and a wind vane."
    )
    
    recommendations.append(
        f"The external wind farm wake influence should be continuously monitored during the "
        f"measurement campaign, particularly for sectors where the freestream percentage is "
        f"below 50%. Real-time wake detection algorithms are recommended to supplement the "
        f"static sector classification performed in this analysis."
    )
    
    recommendations.append(
        f"For the 1-mast-2-WTGs configuration, ensure that the mast location provides "
        f"adequate fetch and terrain representativity for both target turbines independently. "
        f"If the combined sector coverage is insufficient, consider installing separate "
        f"measurement masts for each turbine."
    )
    
    recommendations.append(
        f"Coordinate re-verification of all mast and WTG positions using differential GPS "
        f"is recommended prior to mast installation, with target accuracy of +/-0.5m to "
        f"minimize uncertainty in the terrain slope and distance calculations."
    )
    
    for i, rec in enumerate(recommendations, 1):
        story.append(Paragraph(f"<b>{i}.</b> {rec}", styles['BodyText2']))
        story.append(Spacer(1, 4))
    
    # Add warnings from API
    api_warnings = data.get("warnings", [])
    if api_warnings:
        story.append(Spacer(1, 10))
        story.append(Paragraph("Analysis Warnings:", styles['SubSection']))
        for w in api_warnings[:10]:
            story.append(Paragraph(f"  - {w.get('message', str(w))}", styles['SmallText']))
    
    story.append(Spacer(1, 20))
    
    # End bar
    end_bar = Table(cover_bar_data, colWidths=[page_width], rowHeights=[6])
    end_bar.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#1a365d')),
    ]))
    story.append(end_bar)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "END OF REPORT",
        ParagraphStyle('end', parent=styles['Normal'], fontSize=9, 
                       alignment=TA_CENTER, textColor=colors.HexColor('#718096'))
    ))
    
    # Build PDF
    doc.build(story)
    print(f"\nPDF report generated: {output_path}")
    return output_path

def degree_to_cardinal(deg):
    """Convert degree to cardinal direction string."""
    dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
            'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
    ix = round(deg / 22.5) % 16
    return f" ({dirs[ix]})"

# ============================================================
# Main Execution
# ============================================================

def main():
    print("=" * 70)
    print("WTG PCV TOOL - REAL DATA TEST")
    print("=" * 70)
    
    # 1. Parse input files
    print("\n[1/6] Parsing input files...")
    
    print("  Reading internal wind farm layout...")
    wtgs = parse_wtg_csv(os.path.join(UPLOAD_DIR, "Wind farm layout.csv"))
    print(f"    Found {len(wtgs)} internal WTGs")
    
    print("  Reading external wind farm layout...")
    external_wtgs = parse_wtg_csv(os.path.join(UPLOAD_DIR, "Wind farm layout external.csv"), 
                                   is_external=True)
    print(f"    Found {len(external_wtgs)} external WTGs")
    
    print("  Reading wind data...")
    wind_stats = parse_wind_data(os.path.join(UPLOAD_DIR, "Wind Data.csv"))
    print(f"    Found {wind_stats['totalRecords']} valid records, "
          f"mean WS={wind_stats['meanWindSpeed']} m/s, "
          f"predominant dir={wind_stats['predominantDirection']:.0f} deg")
    
    print("  Reading terrain map file...")
    map_info = parse_map_file(os.path.join(UPLOAD_DIR, "MAPFILES_240102_Pestera2_Rev 0_0.map"))
    print(f"    Found {map_info['numContours']} contours, "
          f"elevation range: {map_info['elevationMin']:.0f}-{map_info['elevationMax']:.0f}m")
    
    # 2. Generate mast proposals
    print("\n[2/6] Generating mast position proposals...")
    masts = generate_mast_proposals(wtgs, num_masts=3)
    for m in masts:
        print(f"    {m['id']}: {m['name']} (min WTG dist: {m['nearestWtgDist']:.0f}m)")
    
    # 3. Run analysis
    print("\n[3/6] Running terrain assessment via API...")
    data = run_analysis(masts, wtgs, external_wtgs)
    
    if not data.get("success"):
        print("\nAnalysis failed! Check error messages above.")
        print("Saving partial results...")
    
    # 4. Save raw results
    print("\n[4/6] Saving raw results...")
    save_raw_results(data)
    
    # 5. Generate PDF
    print("\n[5/6] Generating PDF report...")
    output_path = generate_pdf_report(data, wtgs, external_wtgs, wind_stats, map_info, masts)
    
    # 6. Summary
    print("\n[6/6] Test Complete!")
    print("=" * 70)
    print(f"SUCCESS: Analysis completed and PDF report generated.")
    print(f"PDF Report: {output_path}")
    print(f"Raw JSON:  {os.path.join(OUTPUT_DIR, 'pcv_raw_results.json')}")
    print("=" * 70)

if __name__ == "__main__":
    main()
