# X1 map fixtures

Fixtures for `EcovacsMapParser_test.js`. Each is a pair:

- `<name>.showmap.bin`: a raw `map/ManipulateShowMap` response payload (metadata header
  plus an LZMA1-compressed occupancy grid, the format `EcovacsMapParser` parses).
- `<name>.showmap.json`: the `ValetudoMap` the parser must produce from it.

`synthetic_x1.showmap.bin` is a small hand-built 24x24 map (two segments, a wall ring, an
obstacle, and some unsegmented floor). It is synthetic on purpose: real captures are maps
of a home, so they stay out of git. The payload format matches the device (verified by
decoding a real capture), so the parser is exercised against the true format without
committing anyone's floor plan.

## Adding a real capture

If you add one, confirm it decodes, then **sanitize it**: a real map reveals a home
layout. Prefer a synthetic or heavily reduced grid for anything committed.
