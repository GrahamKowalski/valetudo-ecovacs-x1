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
- All other files under `backend/lib/ecovacs/`, `backend/lib/robots/ecovacs/`,
  `backend/test/lib/ecovacs/`, `backend/test/lib/robots/ecovacs/` and
  `util/generate_ecocloud_tls.js` are new in this fork.

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
