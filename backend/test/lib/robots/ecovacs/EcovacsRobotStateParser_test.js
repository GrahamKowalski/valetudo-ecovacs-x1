const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const EcovacsRobotStateParser = require("../../../../lib/robots/ecovacs/EcovacsRobotStateParser");

const RES = path.join(__dirname, "res", "state");
const fixture = name => {
    return fs.readFileSync(path.join(RES, `${name}.bin`));
};

// Builders for a synthetic /robot/Robot message (little-endian, matching TCPROS)
function header(frameId = "") {
    const fid = Buffer.from(frameId, "ascii");
    const b = Buffer.alloc(16 + fid.length);
    // seq, sec, nsec left zero; then string length + bytes
    b.writeUInt32LE(fid.length, 12);
    fid.copy(b, 16);
    return b;
}
function pose(x, y, theta) {
    const f = Buffer.alloc(12);
    f.writeFloatLE(x, 0); f.writeFloatLE(y, 4); f.writeFloatLE(theta, 8);
    return Buffer.concat([header(), f]);
}
function robotMsg({ x, y, theta, battery, lowVoltage, isOnCharger, chargeState }) {
    const pp = Buffer.concat([pose(0, 0, 0), pose(x, y, theta)]); // predictPose, pose
    const batt = Buffer.from([battery, lowVoltage]);
    const charge = Buffer.from([isOnCharger, chargeState]);
    // The rest of the message with every array empty: currents count, rangeDetects
    // (header + count), onOffInfo count, bump/downin/fall/dirtbox/carpet/waterbox
    // counts, ldsPic (header + points count + two empty poses) = 128 zero bytes.
    return Buffer.concat([header("map"), pp, batt, charge, Buffer.alloc(128)]);
}

describe("EcovacsRobotStateParser", () => {
    describe("synthetic /robot/Robot", () => {
        it("parses pose, battery, and charge state", () => {
            const msg = robotMsg({ x: 500, y: 0, theta: -3.1313, battery: 40, lowVoltage: 0, isOnCharger: 1, chargeState: 1 });
            const s = EcovacsRobotStateParser.PARSE(msg);

            assert.strictEqual(s.battery, 40);
            assert.strictEqual(s.isOnCharger, 1);
            assert.strictEqual(s.chargeState, 1);
            assert.strictEqual(Math.round(s.pose.x), 500);
            assert.strictEqual(Math.round(s.pose.y), 0);
            assert.ok(Math.abs(s.pose.theta + 3.1313) < 1e-3);
        });

        it("handles a frame_id in the headers", () => {
            const msg = robotMsg({ x: -1428, y: -1158, theta: 0.0644, battery: 87, lowVoltage: 0, isOnCharger: 0, chargeState: 0 });
            const s = EcovacsRobotStateParser.PARSE(msg);

            assert.strictEqual(s.battery, 87);
            assert.strictEqual(s.isOnCharger, 0);
            assert.strictEqual(Math.round(s.pose.x), -1428);
        });

        it("reports unknown attachments when the sensor arrays are empty", () => {
            const s = EcovacsRobotStateParser.PARSE(robotMsg({ x: 0, y: 0, theta: 0, battery: 1, lowVoltage: 0, isOnCharger: 0, chargeState: 0 }));

            assert.strictEqual(s.dustbinIn, null);
            assert.strictEqual(s.module, null);
            assert.strictEqual(s.carpet, false);
            assert.deepStrictEqual(s.bump, { left: false, right: false, lds: false });
        });

        it("returns null for an undersized or truncated buffer", () => {
            assert.strictEqual(EcovacsRobotStateParser.PARSE(Buffer.alloc(8)), null);
            assert.strictEqual(EcovacsRobotStateParser.PARSE("nope"), null);
            const truncated = robotMsg({ x: 0, y: 0, theta: 0, battery: 1, lowVoltage: 0, isOnCharger: 0, chargeState: 0 }).subarray(0, 90);
            assert.strictEqual(EcovacsRobotStateParser.PARSE(truncated), null);
        });
    });

    describe("captured /robot/Robot", () => {
        it("vacuum module fitted, dustbin in, off the dock", () => {
            const s = EcovacsRobotStateParser.PARSE(fixture("robot_vacuum_module_off_dock"));

            assert.strictEqual(s.battery, 70);
            assert.strictEqual(s.isOnCharger, 0);
            assert.strictEqual(s.dustbinIn, true);
            assert.strictEqual(s.module, EcovacsRobotStateParser.MODULE.VACUUM);
            assert.strictEqual(s.carpet, false);
            assert.strictEqual(Math.round(s.pose.x), 324);
            assert.strictEqual(Math.round(s.pose.y), -4059);
        });

        it("dustbin out", () => {
            const s = EcovacsRobotStateParser.PARSE(fixture("robot_dustbin_out"));

            assert.strictEqual(s.dustbinIn, false);
            assert.strictEqual(s.module, EcovacsRobotStateParser.MODULE.VACUUM);
        });

        it("nothing in the module bay", () => {
            const s = EcovacsRobotStateParser.PARSE(fixture("robot_no_module"));

            assert.strictEqual(s.dustbinIn, true);
            assert.strictEqual(s.module, EcovacsRobotStateParser.MODULE.NONE);
        });

        it("mop plate fitted", () => {
            const s = EcovacsRobotStateParser.PARSE(fixture("robot_mop_plate"));

            assert.strictEqual(s.module, EcovacsRobotStateParser.MODULE.MOP);
            assert.strictEqual(s.carpet, false);
        });

        it("mop plate fitted, on carpet", () => {
            const s = EcovacsRobotStateParser.PARSE(fixture("robot_mop_plate_on_carpet"));

            assert.strictEqual(s.module, EcovacsRobotStateParser.MODULE.MOP);
            assert.strictEqual(s.carpet, true);
        });

        it("on the charger", () => {
            const s = EcovacsRobotStateParser.PARSE(fixture("robot_on_charger"));

            assert.strictEqual(s.isOnCharger, 1);
            assert.strictEqual(s.battery, 68);
            assert.strictEqual(Math.round(s.pose.x), 324);
            assert.strictEqual(Math.round(s.pose.y), 476);
        });
    });

    describe("captured /task/WorkState", () => {
        it("idle", () => {
            const w = EcovacsRobotStateParser.PARSE_WORK_STATE(fixture("workstate_idle"));

            assert.strictEqual(w.worktype, EcovacsRobotStateParser.WORK_TYPE.IDLE);
            assert.strictEqual(w.state, EcovacsRobotStateParser.WORK_STATE.IDLE);
        });

        it("relocating after being set down", () => {
            const w = EcovacsRobotStateParser.PARSE_WORK_STATE(fixture("workstate_relocating"));

            assert.strictEqual(w.worktype, EcovacsRobotStateParser.WORK_TYPE.RELOCATION);
            assert.strictEqual(w.state, EcovacsRobotStateParser.WORK_STATE.RUNNING);
        });

        it("auto clean running and paused", () => {
            const running = EcovacsRobotStateParser.PARSE_WORK_STATE(fixture("workstate_auto_clean_running"));
            const paused = EcovacsRobotStateParser.PARSE_WORK_STATE(fixture("workstate_auto_clean_paused"));

            assert.strictEqual(running.worktype, EcovacsRobotStateParser.WORK_TYPE.AUTO_CLEAN);
            assert.strictEqual(running.state, EcovacsRobotStateParser.WORK_STATE.RUNNING);
            assert.strictEqual(paused.worktype, EcovacsRobotStateParser.WORK_TYPE.AUTO_CLEAN);
            assert.strictEqual(paused.state, EcovacsRobotStateParser.WORK_STATE.PAUSED);
        });

        it("returns null for garbage", () => {
            assert.strictEqual(EcovacsRobotStateParser.PARSE_WORK_STATE(Buffer.alloc(3)), null);
            assert.strictEqual(EcovacsRobotStateParser.PARSE_WORK_STATE(undefined), null);
        });
    });

    describe("captured /map/ChargerDockInfo", () => {
        it("reports the stored dock pose", () => {
            const d = EcovacsRobotStateParser.PARSE_CHARGER_DOCK_INFO(fixture("dockinfo_found"));

            assert.ok(d.dock);
            assert.ok(Math.abs(d.dock.x - 323.78) < 0.01);
            assert.ok(Math.abs(d.dock.y + 4058.75) < 0.01);
        });

        it("has no pose in a GET cycle", () => {
            const d = EcovacsRobotStateParser.PARSE_CHARGER_DOCK_INFO(fixture("dockinfo_get"));

            assert.strictEqual(d.info, 3);
            assert.strictEqual(d.dock, null);
        });
    });
});
