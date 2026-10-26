# Ecovacs X1 downstream: notes

This repository is a downstream fork of [Valetudo](https://github.com/Hypfer/Valetudo)
(Copyright Sören Beye, Apache-2.0) that carries local-control support for the Ecovacs
Deebot X1 (Omni/Plus), originally written in
[ValetudoEV](https://github.com/itsjfx/ValetudoEV) by itsjfx (Apache-2.0).
It is not affiliated with or endorsed by either project. Please don't report issues with
this fork to upstream.

## Provenance and changes (Apache-2.0 §4)

- `backend/lib/ecovacs/Ecocloud.js`, `EcocloudTimeoutError.js` and everything under
  `backend/lib/robots/ecovacs/` that carries a "Derived from ValetudoEV" header were
  imported from ValetudoEV commit `d7a48bca` (range `f294b9ef..d7a48bca`) and have since
  been modified in this fork. See `git log` for the changes.
- Upstream files modified by this fork:
  - `.gitignore`: added ignores for secrets, device identifiers, captures and firmware dumps.
  - `backend/lib/robots/index.js`: registers the Ecovacs robot implementation.
  - `backend/package.json`: added the `lzma` dependency (pure JS) for the map parser.
- All other files under `backend/lib/ecovacs/`, `backend/lib/robots/ecovacs/`,
  `backend/test/lib/ecovacs/`, `backend/test/lib/robots/ecovacs/` and
  `util/generate_ecocloud_tls.js` are new in this fork.

## Map parser

`backend/lib/robots/ecovacs/EcovacsMapParser.js` decodes the X1 `map/CompressMap` payload
(from the ROS services `GetCurrentCompressMap` / `ManipulateShowMap`) into a `ValetudoMap`:
a tiled grid of LZMA1 submaps (Ecovacs truncated header) assembled into an 800x800 occupancy
grid, mapped to floor/wall/segment layers at 5 cm pixel size. `POSE_TO_ENTITY` adds robot and
charger `PointMapEntity`s from world poses (dock = grid center, no y-flip, theta=0 points down).
Format and transform confirmed by decoding a real capture and placing the robot on-device (see
the research repo's map-format note and handoff). Tested in `EcovacsMapParser_test.js` against a
synthetic tiled fixture.

## State parser

`backend/lib/robots/ecovacs/EcovacsRobotStateParser.js` decodes the fixed-offset fields of the
`/robot/Robot` ROS message (pose, `power/Battery`, `power/ChargeState`);
`EcovacsX1OmniValetudoRobot.handleRobotState()` maps them to a `BatteryStateAttribute`.
Attachment sensors (waterbox/dustbin/mop) are later in the same message, after variable-length
arrays, and are a follow-up. Tested in `EcovacsRobotStateParser_test.js`.

## Live acquisition (pending)

The parsers are fed by `handleMapData()` / `handleRobotState()`. Live acquisition (the backend
fetching `GetCurrentCompressMap`, `/robot/Robot`, `/map/ChargerDockInfo` over TCPROS itself) is
the remaining integration step. It was proven out of band with the Python toolkit in the research
repo's `scripts/`. Until it is wired, `buildMap()` stays a placeholder mock.

## Configuration

Set in `robot.implementationSpecificConfig` of the Valetudo config. Device identifiers are
secrets. Keep them in the config file only (`/local/` is gitignored for development).

| Key | Default | Purpose |
|---|---|---|
| `deviceId`, `mId`, `resourceId` | none | Device identifiers used in MQTT topics |
| `ecovacsBindIp` | `127.0.0.1` embedded, else `0.0.0.0` | Ecocloud listen address |
| `ecovacsBindPort` | `443` embedded, else `1883` | Ecocloud listen port |
| `ecovacsTlsKeyPath` / `ecovacsTlsCertPath` | `/etc/ssl/valetudo/ecocloud.{key,crt}` embedded, else unset | Server key/cert. If unset when not embedded, Ecocloud doesn't listen |
| `ecovacsRequestTimeout` | `500` | P2P request timeout in ms |
| `ecovacsCaptureDirectory` | unset (off) | If set, every MQTT exchange is recorded there as redacted JSON lines |
| `ecovacsRedactValues` | `{}` | Extra `{name: value}` pairs to mask in logs/captures, e.g. the serial or a user id |

The embedded TLS paths are a convention of this fork, not something the firmware provides.
Which hostname(s) the robot expects the certificate to cover hasn't been established yet.

## Development

```sh
node util/generate_ecocloud_tls.js                  # CA + server cert into ./local/ecocloud-tls/
cd backend && npm run start:dev                     # uses ../local/valetudo_config.json
```

The config must be a full config (copy `backend/lib/res/default_config.json`), with
`embedded: false`, `robot.implementation: "EcovacsX1OmniValetudoRobot"` and the keys above.

## Evidence rules

A capability is only implemented when backed by a request/response captured from a real
device, not inferred from other clients' source. Captures are produced by the recorder above.
Recorded payloads are redacted for known identifiers and MAC-shaped strings only. Review
them by hand before committing anything derived from them (see
`backend/test/lib/robots/ecovacs/res/map/README.md`).
