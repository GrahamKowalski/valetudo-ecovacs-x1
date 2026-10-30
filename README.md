<div align="center">
  <img src="docs/img/ecovacs_x1.jpg" alt="Ecovacs Deebot X1" height="200">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="assets/logo/valetudo_logo_with_name.svg" alt="Valetudo" height="110">
  <p><em>Local, cloud-free control of the Ecovacs Deebot X1 Omni through Valetudo</em></p>
</div>

# Valetudo for the Ecovacs Deebot X1 Omni

This is a downstream fork of [Valetudo](https://github.com/Hypfer/Valetudo) that adds local,
cloud-free control of the Ecovacs Deebot X1 Omni (and Plus). It talks to the robot's own
on-board ROS graph directly, so the robot runs with no Ecovacs cloud and no account, exposing
a web UI, a REST API, and a Home Assistant integration over MQTT, the same as any other
Valetudo robot.

It builds on the Ecovacs groundwork in [ValetudoEV](https://github.com/itsjfx/ValetudoEV) by
itsjfx. Provenance, licensing, and the full list of changed files are in
[ECOVACS-FORK.md](ECOVACS-FORK.md).

> **Status: working, with a defined capability set and known gaps.** The core control and
> reporting path runs on a real X1 Omni and is verified live, including through Home Assistant.
> This is not a feature-complete reimplementation of the Ecovacs app. Read the capabilities and
> gaps below before you rely on it.

## Capabilities

| Capability | Status |
|---|---|
| Status and state (docked, cleaning, paused, returning, moving, idle) | Verified on device |
| Battery and charge state | Verified on device |
| Attachments (dustbin, mop plate, water tank) | Verified on device |
| Map decode and live map | Verified on device |
| Start, stop, pause, return to dock | Verified on device |
| Room / segment cleaning | Verified on device |
| Go to location | Verified on device |
| Locate ("find my robot") | Verified on device |
| Fan speed (low, medium, high, max) | Verified on device |
| Water usage (low, medium, high, max) | Verified on device |
| Carpet mode | Verified on device |
| Auto-empty dock (manual trigger) | Verified on device |
| Do not disturb (quiet hours) | Verified on device |
| No-go zones and virtual walls | Verified on device |
| Consumable monitoring (main/side brush, filter, mop life) | Implemented |
| Child lock | Implemented (write-only, no read-back) |
| Wi-Fi configuration and scan | Implemented (standard Valetudo) |
| Error reporting (stuck, failed task, dock unreachable, alert stop, silent mid-run crash) | Implemented and deployed |

### Not yet implemented

- Mop wash and mop dry station cycles are reachable over ROS but are not exposed as Valetudo
  capabilities yet (unverified without a mop attached).
- Zone cleaning by rectangle, and auto-empty interval/frequency, are mapped but not yet built.
- Scent intensity exists as an internal command method; voice/speaker volume needs a short
  on-device probe before it can be exposed.
- Scheduling is deliberately left to Home Assistant rather than built in, in line with upstream
  Valetudo's design.

## Requirements

This fork does not install itself. It requires an X1 that has been rooted and has this backend
flashed in place of the stock one. That involves UART access, a device-specific root step, and
an in-place rootfs update. The build constraints (the robot's Node 18 / kernel 4.14 runtime),
the image build, and the on-device deployment are documented in the [companion research repo](https://github.com/GrahamKowalski/ecovacs-x1-research)'s
`deploy/RUNBOOK.md`. Treat rooting and reflashing as advanced: the individual steps are well
documented and not hard to follow, but a mistake is recoverable only via UART plus a backup, so
have both ready before you start.

Once running, the backend serves the Valetudo web UI and REST API on port 80 over the LAN, and
connects to an MQTT broker for Home Assistant autodiscovery.

## Home Assistant

Point the Valetudo MQTT settings at your broker and enable Home Assistant autodiscovery. The
vacuum entity appears automatically, along with battery, attachment, fan, water, carpet-mode,
auto-empty trigger, do-not-disturb, no-go-zone, consumable, child-lock, and error entities.
Scheduling is done with Home Assistant automations that call the vacuum, which also gives you
per-room routines, conditions, and presence.

## Relationship to upstream Valetudo

Valetudo is a generic, cloud-free abstraction for vacuum robots by Sören Beye, licensed
Apache-2.0. This fork carries X1 support only and is not affiliated with or endorsed by the
Valetudo or ValetudoEV projects. Please do not report issues with this fork upstream. The
original upstream README is preserved at
[docs/upstream-valetudo-README.md](docs/upstream-valetudo-README.md), and the upstream project
lives at [valetudo.cloud](https://valetudo.cloud).

## License

Apache-2.0, the same as upstream Valetudo. See [LICENSE](LICENSE) and [ECOVACS-FORK.md](ECOVACS-FORK.md).
