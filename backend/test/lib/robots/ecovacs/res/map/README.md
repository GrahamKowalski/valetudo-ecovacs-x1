# X1 map fixtures

Captured map payloads from a real X1, used by `EcovacsMapParser_test.js`. Each fixture is a pair:

- `<name>.capture.json`: a JSON array of the `EcocloudRecorder` entries (lines from an
  `ecocloud-*.jsonl` capture) that together make up one map, request and response(s), in order.
- `<name>.expected.json`: the `ValetudoMap` the parser must produce from it.

Name fixtures after model, firmware and what they show, e.g. `x1omni_<fw>_two_rooms_docked`.

## Before committing a capture

The recorder masks `deviceId`, `mId`, `resourceId`, anything in `ecovacsRedactValues` and
MAC-shaped strings. It cannot mask identifiers nobody knows about yet, and it does not look
inside base64/binary payloads. Review every fixture by hand for the serial number, MAC
addresses, user IDs, tokens, Wi-Fi SSIDs and similar before it goes into git.
