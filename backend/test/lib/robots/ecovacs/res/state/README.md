# X1 state fixtures

Raw TCPROS message bodies captured from an X1 Plus (fw 1.7.2) on 2026-10-26 while the
robot was handled on purpose (dustbin out, module bay emptied, mop plate fitted, cleaning
started and paused, parked on the dock). Used by `EcovacsRobotStateParser_test.js`.

| File | Topic | What it shows |
|---|---|---|
| `robot_vacuum_module_off_dock.bin` | `/robot/Robot` | vacuum/aromatherapy module (waterbox 4), dustbin in, not charging |
| `robot_dustbin_out.bin` | `/robot/Robot` | dustbin removed (dirtbox 1) |
| `robot_no_module.bin` | `/robot/Robot` | module bay empty (waterbox 0) |
| `robot_mop_plate.bin` | `/robot/Robot` | mop plate fitted (waterbox 2) |
| `robot_mop_plate_on_carpet.bin` | `/robot/Robot` | mop plate fitted, carpet sensor 1 |
| `robot_on_charger.bin` | `/robot/Robot` | isOnCharger 1 |
| `workstate_*.bin` | `/task/WorkState` | idle (7/0), relocating (8/1), auto clean running (0/1) and paused (0/2) |
| `dockinfo_found.bin`, `dockinfo_get.bin` | `/map/ChargerDockInfo` | REPORT cycle with the stored dock pose, and a GET cycle without |

Sanitized: the `/robot/Robot` messages had their LDS scan (`ldsPic.points`, the only
room-geometry payload) stripped to zero points, which shrinks them from 25 KB to 307 bytes.
Poses are kept; they are a handful of coordinates relative to the dock, not a floor plan.
Extracted with the research repo's `scripts/x1_extract_fixtures.py`.
