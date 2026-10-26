const assert = require("node:assert");
const { describe, it } = require("node:test");

const EcovacsRobotStateParser = require("../../../../lib/robots/ecovacs/EcovacsRobotStateParser");

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
    return Buffer.concat([header("map"), pp, batt, charge, Buffer.alloc(32)]);
}

describe("EcovacsRobotStateParser", () => {
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

    it("returns null for an undersized buffer", () => {
        assert.strictEqual(EcovacsRobotStateParser.PARSE(Buffer.alloc(8)), null);
        assert.strictEqual(EcovacsRobotStateParser.PARSE("nope"), null);
    });
});
