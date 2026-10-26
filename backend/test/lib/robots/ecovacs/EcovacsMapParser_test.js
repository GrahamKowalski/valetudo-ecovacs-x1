const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const EcovacsMapParser = require("../../../../lib/robots/ecovacs/EcovacsMapParser");
const { assertParsedMap } = require("../../../helpers/map");

const FIXTURE_DIR = path.join(__dirname, "/res/map/");

describe("EcovacsMapParser", () => {
    it("parses a ManipulateShowMap payload into the expected ValetudoMap", async () => {
        const payload = fs.readFileSync(path.join(FIXTURE_DIR, "synthetic_x1.showmap.bin"));
        const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "synthetic_x1.showmap.json"), { encoding: "utf-8" }));

        const actual = await EcovacsMapParser.PARSE(payload);

        assertParsedMap(actual, expected);
    });

    it("maps cell values to the right layers at the right scale", async () => {
        const payload = fs.readFileSync(path.join(FIXTURE_DIR, "synthetic_x1.showmap.bin"));
        const map = await EcovacsMapParser.PARSE(payload);

        assert.strictEqual(map.pixelSize, 5, "50mm -> 5cm");
        assert.deepStrictEqual(map.size, { x: 120, y: 120 }, "24 cells * 5cm");

        const byType = {};
        for (const layer of map.layers) {
            const key = layer.type + (layer.metaData.segmentId ? ":" + layer.metaData.segmentId : "");
            byType[key] = layer.dimensions.pixelCount;
        }
        // floor = unsegmented(4) + both segments; wall = wall(2) + obstacle(5)
        assert.strictEqual(byType["floor"], 252);
        assert.strictEqual(byType["wall"], 72);
        assert.strictEqual(byType["segment:101"], 122);
        assert.strictEqual(byType["segment:102"], 128);
    });

    it("places robot and charger entities from world poses", async () => {
        const payload = fs.readFileSync(path.join(FIXTURE_DIR, "synthetic_x1.showmap.bin"));
        // 24x24 grid, 50mm/cell, pixelSize 5cm; world (0,0) maps to grid center (12,12) -> 60cm
        const map = await EcovacsMapParser.PARSE(payload, {
            charger: { x: 0, y: 0, theta: 0 },
            robot: { x: 100, y: -200, theta: 0 }
        });

        const charger = map.entities.find(e => e.type === "charger_location");
        const robot = map.entities.find(e => e.type === "robot_position");

        assert.deepStrictEqual(charger.points, [60, 60], "charger at grid center");
        // robot: (12 + 100/50, 12 + -200/50) = (14, 8) cells -> (70, 40) cm
        assert.deepStrictEqual(robot.points, [70, 40]);
        assert.strictEqual(robot.metaData.angle, 180, "theta=0 points down -> Valetudo 180");
    });

    it("adds no entities when no poses are given", async () => {
        const payload = fs.readFileSync(path.join(FIXTURE_DIR, "synthetic_x1.showmap.bin"));
        const map = await EcovacsMapParser.PARSE(payload);
        assert.strictEqual(map.entities.length, 0);
    });

    it("returns null for an undersized payload", async () => {
        assert.strictEqual(await EcovacsMapParser.PARSE(Buffer.alloc(4)), null);
        assert.strictEqual(await EcovacsMapParser.PARSE("not a buffer"), null);
    });
});
