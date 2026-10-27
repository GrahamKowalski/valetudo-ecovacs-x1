const assert = require("node:assert");
const { beforeEach, describe, it } = require("node:test");

const capabilities = require("../../../../lib/robots/ecovacs/capabilities");
const EcovacsCommandFactory = require("../../../../lib/robots/ecovacs/EcovacsCommandFactory");
const ValetudoSelectionPreset = require("../../../../lib/entities/core/ValetudoSelectionPreset");

function makeRobot() {
    const calls = [];
    const publishes = [];
    const settings = [];
    return {
        calls: calls, publishes: publishes, settings: settings,
        commandFactory: new EcovacsCommandFactory(),
        state: { map: null },
        callRosService: async cmd => {
            calls.push(cmd);
            return Buffer.alloc(54);
        },
        publishRosMessage: async cmd => {
            publishes.push(cmd);
        },
        applySetting: async (settingType, writes) => {
            settings.push({ settingType: settingType, writes: writes });
        },
        getMapGeometry: () => {
            return { width: 800, height: 800, resolutionMm: 50, pixelSize: 5 };
        }
    };
}

describe("Ecovacs control capabilities", () => {
    let robot;
    beforeEach(() => {
        robot = makeRobot();
    });

    describe("BasicControl", () => {
        it("maps start/stop/pause/home to WorkManage requests", async () => {
            const cap = new capabilities.EcovacsBasicControlCapability({ robot: robot });
            await cap.start();
            await cap.stop();
            await cap.pause();
            await cap.home();

            assert.strictEqual(robot.calls.length, 4);
            assert.ok(robot.calls.every(c => {
                return c.service === "/task/WorkManage";
            }));
            assert.strictEqual(robot.calls[0].request[1], 0); // start = AUTO_CLEAN
            assert.strictEqual(robot.calls[1].request[0], 1); // stop managetype
            assert.strictEqual(robot.calls[2].request[0], 2); // pause managetype
            assert.strictEqual(robot.calls[3].request[1], 5); // home = RETURN
        });
    });

    describe("Locate", () => {
        it("publishes the I_AM_HERE audio", async () => {
            const cap = new capabilities.EcovacsLocateCapability({ robot: robot });
            await cap.locate();

            assert.strictEqual(robot.publishes.length, 1);
            assert.strictEqual(robot.publishes[0].topic, "/audio/AudioPlay");
            assert.strictEqual(robot.publishes[0].payload.readUInt32LE(4), 31);
        });
    });

    describe("GoToLocation", () => {
        it("converts cm to world mm and sends a GOTO", async () => {
            const cap = new capabilities.EcovacsGoToLocationCapability({ robot: robot });
            await cap.goTo({ coordinates: { x: 2050, y: 2100 } });

            const req = robot.calls[0].request;
            assert.strictEqual(req[1], 6); // GOTO
            assert.strictEqual(req.readUInt32LE(34), 1); // one pose
            // (2050/5 - 400)*50 = 500 mm ; (2100/5 - 400)*50 = 1000 mm
            assert.strictEqual(Math.round(req.readFloatLE(54)), 500);
            assert.strictEqual(Math.round(req.readFloatLE(58)), 1000);
        });

        it("POINT_CM_TO_WORLD_MM inverts the map transform", () => {
            const geo = { width: 800, height: 800, resolutionMm: 50, pixelSize: 5 };
            // world 0,0 sits at the map centre -> point 2000 cm
            assert.deepStrictEqual(
                capabilities.EcovacsGoToLocationCapability.POINT_CM_TO_WORLD_MM(2000, 2000, geo),
                { x: 0, y: 0 }
            );
        });
    });

    describe("MapSegmentation", () => {
        it("sends an AREA_CLEAN with the segment ids", async () => {
            const cap = new capabilities.EcovacsMapSegmentationCapability({ robot: robot });
            await cap.executeSegmentAction([{ id: "101" }, { id: "102" }]);

            const req = robot.calls[0].request;
            assert.strictEqual(req[1], 1); // AREA_CLEAN
            assert.strictEqual(req.readUInt32LE(2), 2); // two ids
            assert.deepStrictEqual([...req.subarray(6, 8)], [101, 102]);
        });

        it("rejects when there are no valid ids", async () => {
            const cap = new capabilities.EcovacsMapSegmentationCapability({ robot: robot });
            await assert.rejects(cap.executeSegmentAction([{ id: "nope" }]));
        });
    });

    describe("FanSpeed", () => {
        it("applies the preset's mode and isSilent at the right offsets", async () => {
            const cap = new capabilities.EcovacsFanSpeedControlCapability({
                robot: robot,
                presets: [new ValetudoSelectionPreset({ name: "max", value: { mode: 2, isSilent: 0 } })]
            });
            await cap.selectPreset("max");

            assert.strictEqual(robot.settings.length, 1);
            assert.strictEqual(robot.settings[0].settingType, EcovacsCommandFactory.SETTING_TYPE.FAN_LEVEL);
            assert.deepStrictEqual(robot.settings[0].writes, [
                { offset: 22, value: 2 },
                { offset: 23, value: 0 }
            ]);
        });

        it("rejects an unknown preset", async () => {
            const cap = new capabilities.EcovacsFanSpeedControlCapability({ robot: robot, presets: [] });
            await assert.rejects(cap.selectPreset("nope"));
        });
    });

    describe("WaterUsage", () => {
        it("applies the water level at the right offset", async () => {
            const cap = new capabilities.EcovacsWaterUsageControlCapability({
                robot: robot,
                presets: [new ValetudoSelectionPreset({ name: "high", value: 2 })]
            });
            await cap.selectPreset("high");

            assert.strictEqual(robot.settings[0].settingType, EcovacsCommandFactory.SETTING_TYPE.WATER_LEVEL);
            assert.deepStrictEqual(robot.settings[0].writes, [{ offset: 20, value: 2 }]);
        });
    });
});
