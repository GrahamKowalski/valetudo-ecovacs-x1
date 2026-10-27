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

`backend/lib/robots/ecovacs/EcovacsRosMessageDecoder.js` is a generic ROS1 message decoder
driven by the definition text each publisher sends in its TCPROS header. The definitions we
rely on are embedded verbatim in `EcovacsRosDefinitions.js` (`robot/Robot`, `task/WorkState`,
`map/ChargerDockInfo`, captured from the device on 2026-10-26).

`EcovacsRobotStateParser.js` decodes those three messages in full and reduces them to
plain fields: pose, battery, charge, dustbin in/out, what sits in the module bay (mop plate,
vacuum/aromatherapy module, nothing), carpet, bumpers; work type + state; stored dock pose.
`EcovacsX1OmniValetudoRobot.handleRobotState()` / `handleWorkState()` /
`handleChargerDockInfo()` map them to `BatteryStateAttribute`, `AttachmentStateAttribute`
(dustbin, mop; "watertank" means the mop plate, the clean-water tank lives in the station)
and `StatusStateAttribute` (idle, docked, cleaning, paused, returning, moving, manual).
Sensor enum values were established by handling the robot while streaming its topics; see
the research repo's `research/state-stream-findings-2026-10-26.md`. Tested against captured
messages in `test/lib/robots/ecovacs/res/state/` (LDS scans stripped).

## Live acquisition (ROS link)

`backend/lib/robots/ecovacs/ros/` talks to the robot's own ROS1 graph with no dependencies:
`EcovacsRosXmlRpcClient` (master/slave XML-RPC), `EcovacsTcpRosClient` (TCPROS subscribe +
service call, auto-reconnect), `EcovacsTcpRosFramer`, and `EcovacsRosLink`, which subscribes
to `/robot/Robot` (throttled to 1 Hz), `/task/WorkState`, `/map/ChargerDockInfo` and polls
`/map/GetCurrentCompressMap` every 30 s, feeding `handleRobotState()` / `handleWorkState()` /
`handleChargerDockInfo()` / `handleMapData()`. It starts when `ecovacsRosMasterUri` is set in
the implementation config (`http://127.0.0.1:11311` on the robot). The ROS master only
listens on localhost, so this path is for the backend running on the robot (post-reflash);
off-robot development uses the research repo's stream tools. Tested against a fake ROS graph
in `test/lib/robots/ecovacs/ros/`. Until configured, `buildMap()` stays a placeholder mock and
`pollState()` keeps using the Ecocloud mock.

Controls are not wired yet. The entry point is the `/task/WorkManage` service (start/stop/
pause/resume x work type); its live request md5 does not match the firmware dump's definition,
so the exact request layout still has to be established before the first on-device call.

## Control capabilities

`backend/lib/robots/ecovacs/EcovacsCommandFactory.js` builds the exact request bytes for the
robot's control services/topics, from layouts reverse-engineered on the device (the live
layouts differ from the firmware dump, so they are reconstructed and covered by byte-exact
tests):

- `/task/WorkManage` (service): start, stop, pause, resume, home (return), area clean by
  segment id (CleanWorkData.ids), go to an (x,y) point (ExtraWorkData.poses @ byte 34).
- `/setting/SettingManage` (service): read-modify-write of fan level (byte 22), water level
  (byte 20), mop mode (byte 19), and carpet on/off (CustomSetting type byte 2 = 8, value byte 3),
  preserving other settings. Offsets verified on device.
- `/setting/AromatherapyLevel` (publish): scent level (1-byte uint8).
- `/audio/AudioPlay` (publish): locate / "I am here" (audio id 31).

Capabilities in `capabilities/`: `EcovacsBasicControlCapability`, `EcovacsLocateCapability`,
`EcovacsGoToLocationCapability` (cm->mm inverse of the map transform),
`EcovacsMapSegmentationCapability`, `EcovacsFanSpeedControlCapability` (low/medium/high/max),
`EcovacsWaterUsageControlCapability` (low/medium/high/max), `EcovacsCarpetModeControlCapability`
(on/off toggle). Mop mode and scent have no standard Valetudo capability; they are exposed as
tested command-factory methods (`setMopMode`, `setScent`) for future use. They call the robot's
`callRosService` / `publishRosMessage` / `applySetting`, which go through `EcovacsRosLink` and
the TCPROS client (`EcovacsTcpRosClient` gained a `publish()` that briefly registers as a real
ROS publisher). All inactive until the ROS link is up (`ecovacsRosMasterUri`), i.e. on the robot.
Commands use md5sum "*" so the reconstructed layouts need no checksum match. Tested offline
against byte-exact fixtures and a mocked robot.

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
| `ecovacsRosMasterUri` | unset (off) | ROS master to read state and map from directly, e.g. `http://127.0.0.1:11311` on the robot |
| `ecovacsRosMapPollInterval` | `30000` | ms between `/map/GetCurrentCompressMap` fetches when the ROS link is on |
| `ecovacsRedactValues` | `{}` | Extra `{name: value}` pairs to mask in logs/captures, e.g. the serial or a user id |

The embedded TLS paths are a convention of this fork, not something the firmware provides.
Which hostname(s) the robot expects the certificate to cover hasn't been established yet.

## Deploying to the robot

The robot runs a self-built Node 18 aarch64 binary (the kernel-4.14 build constraints and the
image flash are documented in the research repo's `deploy/RUNBOOK.md`). The boot hook
(`/etc/rc.local`) prefers `/data/valetudo` over the baked `/usr/local/bin/valetudo`, so a
backend update is a network copy plus a reboot, with no reflash.

**The pushed binary must be executable, or the update silently does nothing.** The usual
transfer (`nc -l -p PORT > /data/valetudo.new` on the robot, fed from the PC) writes the file
as mode 644 with no execute bit, and `mv` keeps that mode. The boot hook only runs the file
when it is executable (`[ -x /data/valetudo ] && BIN=/data/valetudo`); otherwise it is skipped
and rc.local falls back to the baked binary, so the new build never runs and Home Assistant
keeps showing the old behaviour (or `unavailable` across the reboot). Always `chmod +x` the
file and confirm `[ -x /data/valetudo ]` before rebooting. Seen on 2026-10-27: an OTA whose
transfer and md5 were both correct still ran the baked copy because the file was mode 644.

`/data` is small (~149 MiB) and will not hold a second full binary alongside a backup, so a
`cp` backup of the running binary fails with "No space left on device". Swap with `mv` (a
rename needs no free space), and rely on the baked `/usr/local/bin/valetudo` as the rollback:
`rm -f /data/valetudo` then `reboot` boots the known-good flashed copy.

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
