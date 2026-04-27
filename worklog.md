---
Task ID: 1
Agent: Main Agent
Task: Complete rebuild of PCV Site Selection Tool - mast location as OUTPUT not INPUT

Work Log:
- Analyzed existing pcv-tool.html (2213 lines) and identified fundamental design flaw: tool was asking users to input mast locations when mast placement IS the output
- Completely rewrote /home/z/my-project/download/pcv-tool.html (1339 lines) with correct architecture
- Reordered workflow: Layout → Wind Data → Wind Rose → Visualization → Mast Proposal → Report
- Removed all mast input (upload, manual entry, table, validation)
- Added automatic ERA5T download from layout centroid when user skips wind data step
- Implemented mast proposal engine: identifies first-row WTGs, generates 30+ candidate positions per qualifying WTG at 2D-5D upstream with azimuth offsets
- Added scoring algorithm: distance, terrain validity, freestream, first-row bonus, free sector bonus, multi-WTG bonus
- Added deduplication to prevent overlapping proposals
- Added 1-mast-to-2-WTG configuration optimization
- Improved WAsP .map file parsing (skips IG, BM, RZ, OB headers, handles various delimiters)
- Visualization shows proposed mast locations as red triangles with dashed links to target WTGs
- DNV-style report generation with all IEC 61400-12-1 parameters

Stage Summary:
- File: /home/z/my-project/download/pcv-tool.html (1339 lines, self-contained HTML)
- Key change: Mast location is now the OUTPUT of the analysis, not an input
- Workflow: Layout → Wind Data (optional/auto-download) → Wind Rose → Visualization → Mast Proposal → Report
- Mast proposal algorithm evaluates candidates at 2D, 2.5D, 3D, 3.5D, 4D, 5D distances with ±15° azimuth offsets
- Supports IEC 61400-12-1:2005 and :2017 standards
