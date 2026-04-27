---
Task ID: 1
Agent: Main Agent
Task: Fix and overhaul PCV Site Selection Tool for GitHub Pages deployment

Work Log:
- Read and analyzed the existing index.html (2553 lines) with embedded PCV tool
- Identified bugs: (1) undefined `self` reference in runAnalysis(), (2) file upload visual feedback issues, (3) no .map terrain file support, (4) no real ERA5T download capability
- Split the tools section into a standalone pcv-tool.html (2213 lines, 103KB)
- Updated portfolio index.html (1225 lines, 82KB) with clean Tools section linking to standalone tool
- Fixed navigation button alignment (added flex-shrink:0 to nav items, adjusted gap)
- Removed ~1300 lines of unused inline tool CSS/JS from portfolio
- Built comprehensive 6-step wizard workflow in pcv-tool.html

Stage Summary:
- **index.html** (82KB): Portfolio page with fixed nav alignment + Tools card linking to standalone tool
- **pcv-tool.html** (103KB): Complete standalone PCV analysis tool with:
  - Step 1: Wind data (CSV upload + ERA5T download from Open-Meteo API)
  - Step 2: Wind rose + predominant direction (auto-computed)
  - Step 3: Site layout (mast, WTG, external WTG, .map terrain file uploads + manual entry)
  - Step 4: Full layout visualization (responsive canvas with all assets)
  - Step 5: Analysis results (first-row WTG ID, free sector ≥20° criterion, scoring, configurations)
  - Step 6: Detailed report (terrain assessment, freestream, DNV-style report)
- Both files are self-contained HTML for GitHub Pages deployment
- No server-side code required, no API keys needed
