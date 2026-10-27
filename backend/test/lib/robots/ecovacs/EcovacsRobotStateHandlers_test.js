const assert = require("node:assert");
const { describe, it } = require("node:test");

const EcovacsRobotStateParser = require("../../../../lib/robots/ecovacs/EcovacsRobotStateParser");
const EcovacsX1OmniValetudoRobot = require("../../../../lib/robots/ecovacs/EcovacsX1OmniValetudoRobot");
const entities = require("../../../../lib/entities");
const ValetudoSelectionPreset = require("../../../../lib/entities/core/ValetudoSelectionPreset");

const stateAttrs = entities.state.attributes;
const R = EcovacsX1OmniValetudoRobot.prototype;

// Synthetic little-endian message bodies (see the definitions in EcovacsRosDefinitions)
function fanMode(mode, isSilent) {
    return Buffer.from([mode, isSilent]);
}
function waterLevel(level) {
    return Buffer.from([level]);
}
function taskStateReport(tasktype, stateType, state) {
    const b = Buffer.alloc(9);
    b[0] = tasktype;
    b.writeUInt32LE(stateType, 1);
    b.writeUInt32LE(state, 5);
    return b;
}
function taskResult(type, result, data = "") {
    const d = Buffer.from(data, "utf8");
    const b = Buffer.alloc(6 + d.length);
    b[0] = type;
    b[1] = result;
    b.writeUInt32LE(d.length, 2);
    d.copy(b, 6);
    return b;
}
function workState(worktype, state, workcause) {
    // worktype, state, WorkData with every array empty + theta 0 + remote move + tasktime, workcause
    // CleanWorkData: ids(4) customAreas(4) cycles(4) theta(4) states(4) types(4) = 24
    // ExtraWorkData: ids(4) poses(4) RemoteMove(1+2+2+2=7) tasktime(4) states(4) = 23
    const b = Buffer.alloc(2 + 24 + 23 + 1);
    b[0] = worktype;
    b[1] = state;
    b[b.length - 1] = workcause;
    return b;
}

/**
 * A minimal stand-in for the robot instance: real state container and attributes,
 * the fan/water presets as registered in the constructor, and an event sink.
 */
function fakeSelf() {
    const events = [];
    const self = {
        state: new entities.state.RobotState({ map: null }),
        capabilities: {
            FanSpeedControlCapability: {
                presets: [
                    new ValetudoSelectionPreset({ name: "low", value: { mode: 0, isSilent: 1 } }),
                    new ValetudoSelectionPreset({ name: "medium", value: { mode: 0, isSilent: 0 } }),
                    new ValetudoSelectionPreset({ name: "high", value: { mode: 1, isSilent: 0 } }),
                    new ValetudoSelectionPreset({ name: "max", value: { mode: 2, isSilent: 0 } })
                ]
            },
            WaterUsageControlCapability: {
                presets: [
                    new ValetudoSelectionPreset({ name: "low", value: 0 }),
                    new ValetudoSelectionPreset({ name: "medium", value: 1 }),
                    new ValetudoSelectionPreset({ name: "high", value: 2 }),
                    new ValetudoSelectionPreset({ name: "max", value: 3 })
                ]
            }
        },
        valetudoEventStore: {
            raise: e => {
                events.push(e);
            }
        },
        events: events,
        lastRobotState: null,
        lastWorkState: null,
        lastError: null,
        lastErrorCode: ""
    };
    for (const name of [
        "handleFanMode", "handleWaterLevel", "updateFanSpeedPreset", "updateWaterGradePreset",
        "handleTaskStateReport", "handleTaskResult", "handleWorkState", "setError", "clearError", "updateStatus"
    ]) {
        self[name] = R[name].bind(self);
    }
    return self;
}

function status(self) {
    return self.state.getFirstMatchingAttribute({ attributeClass: stateAttrs.StatusStateAttribute.name });
}
function preset(self, type) {
    return self.state.getFirstMatchingAttribute({
        attributeClass: stateAttrs.PresetSelectionStateAttribute.name,
        attributeType: type
    });
}

describe("EcovacsRobotStateParser (settings and task topics)", () => {
    it("parses FanMode, WaterLevel, TaskStateReport and TaskResult", () => {
        assert.deepStrictEqual(EcovacsRobotStateParser.PARSE_FAN_MODE(fanMode(2, 0)), { mode: 2, isSilent: 0 });
        assert.deepStrictEqual(EcovacsRobotStateParser.PARSE_WATER_LEVEL(waterLevel(3)), { level: 3 });
        assert.deepStrictEqual(
            EcovacsRobotStateParser.PARSE_TASK_STATE_REPORT(taskStateReport(1, 3, 1)),
            { tasktype: 1, stateType: 3, state: 1 }
        );
        assert.deepStrictEqual(
            EcovacsRobotStateParser.PARSE_TASK_RESULT(taskResult(3, 1, "x")),
            { type: 3, result: 1, data: "x" }
        );
    });

    it("returns null for garbage", () => {
        assert.strictEqual(EcovacsRobotStateParser.PARSE_FAN_MODE("nope"), null);
        assert.strictEqual(EcovacsRobotStateParser.PARSE_TASK_RESULT(Buffer.from([3])), null);
    });
});

describe("EcovacsX1OmniValetudoRobot presets", () => {
    it("maps FanMode and WaterLevel topics to the preset attributes", () => {
        const self = fakeSelf();

        self.handleFanMode(fanMode(0, 1));
        assert.strictEqual(preset(self, "fan_speed").value, "low");
        self.handleFanMode(fanMode(2, 0));
        assert.strictEqual(preset(self, "fan_speed").value, "max");

        self.handleWaterLevel(waterLevel(2));
        assert.strictEqual(preset(self, "water_grade").value, "high");
        assert.strictEqual(self.state.attributes.filter(a => {
            return a instanceof stateAttrs.PresetSelectionStateAttribute;
        }).length, 2);
    });

    it("leaves the attribute alone for an unknown combination", () => {
        const self = fakeSelf();
        self.handleFanMode(fanMode(1, 0));
        self.handleFanMode(fanMode(2, 1)); // not a preset
        assert.strictEqual(preset(self, "fan_speed").value, "high");
    });
});

describe("EcovacsX1OmniValetudoRobot error state", () => {
    const WT = EcovacsRobotStateParser.WORK_TYPE;
    const WS = EcovacsRobotStateParser.WORK_STATE;
    const WC = EcovacsRobotStateParser.WORK_CAUSE;

    it("reports stuck as an error with an event, and clears it when the robot is freed", () => {
        const self = fakeSelf();
        self.handleWorkState(workState(WT.AUTO_CLEAN, WS.RUNNING, WC.SCHEDULE));
        assert.strictEqual(status(self).value, "cleaning");

        self.handleTaskStateReport(taskStateReport(WT.AUTO_CLEAN, 3, 1));
        assert.strictEqual(status(self).value, "error");
        assert.strictEqual(status(self).error.message, "Robot is stuck");
        assert.strictEqual(status(self).error.subsystem, "navigation");
        assert.strictEqual(self.events.length, 1);
        assert.strictEqual(self.events[0].message, "Robot is stuck");

        // repeated reports do not spam events
        self.handleTaskStateReport(taskStateReport(WT.AUTO_CLEAN, 3, 1));
        assert.strictEqual(self.events.length, 1);

        self.handleTaskStateReport(taskStateReport(WT.AUTO_CLEAN, 3, 0));
        assert.strictEqual(status(self).value, "cleaning");
    });

    it("ignores other task state types", () => {
        const self = fakeSelf();
        self.handleTaskStateReport(taskStateReport(WT.AUTO_CLEAN, 1, 1));
        assert.strictEqual(self.lastError, null);
    });

    it("turns failed task results into errors and a success clears them", () => {
        const self = fakeSelf();
        self.handleTaskResult(taskResult(4, 4));
        assert.strictEqual(status(self).value, "error");
        assert.strictEqual(status(self).error.message, "Could not find the charging dock");
        assert.strictEqual(status(self).error.subsystem, "dock");
        assert.strictEqual(status(self).error.vendorErrorCode, "task 4 result 4");

        self.handleTaskResult(taskResult(4, 0));
        assert.strictEqual(status(self).value, "idle");
    });

    it("flags a task that stopped because of an alert", () => {
        const self = fakeSelf();
        self.handleWorkState(workState(WT.AUTO_CLEAN, WS.RUNNING, WC.MANUAL));
        self.handleWorkState(workState(WT.IDLE, WS.IDLE, WC.ALERT));
        assert.strictEqual(status(self).value, "error");
        assert.strictEqual(status(self).error.message, "Task stopped by an alert");
    });

    it("clears the error when a new task starts", () => {
        const self = fakeSelf();
        self.handleTaskStateReport(taskStateReport(WT.AUTO_CLEAN, 3, 1));
        assert.strictEqual(status(self).value, "error");

        self.handleWorkState(workState(WT.AUTO_CLEAN, WS.RUNNING, WC.MANUAL));
        assert.strictEqual(status(self).value, "cleaning");
        assert.strictEqual(self.lastError, null);
    });

    it("clears the error once the robot is back on the charger", () => {
        const self = fakeSelf();
        self.handleTaskStateReport(taskStateReport(WT.AUTO_CLEAN, 3, 1));
        assert.strictEqual(status(self).value, "error");

        // handleRobotState needs a full /robot/Robot message; drive the same path directly
        self.lastRobotState = { isOnCharger: 1, battery: 50 };
        self.lastError = null;
        self.lastErrorCode = "";
        self.updateStatus();
        assert.strictEqual(status(self).value, "docked");
    });

    it("does not raise an event without an event store", () => {
        const self = fakeSelf();
        self.valetudoEventStore = undefined;
        self.handleTaskStateReport(taskStateReport(WT.AUTO_CLEAN, 3, 1));
        assert.strictEqual(status(self).value, "error");
    });
});
