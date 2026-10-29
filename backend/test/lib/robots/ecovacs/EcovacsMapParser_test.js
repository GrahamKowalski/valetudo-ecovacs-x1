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

    describe("virtual walls", () => {
        it("decodes a ManipulateVirtualWall response into walls with mm dots", () => {
            // result 0, mapid, count 1; wall vwid 7, type 0, 2 dots (500,500)-(500,1500)
            const parts = [Buffer.from([0]), u32(0x414a57ed), u32(1), u32(7), Buffer.from([0]), u32(2),
                f32(500), f32(500), f32(500), f32(1500)];
            const walls = EcovacsMapParser.PARSE_VIRTUAL_WALLS(Buffer.concat(parts));

            assert.strictEqual(walls.length, 1);
            assert.strictEqual(walls[0].type, 0);
            assert.deepStrictEqual(walls[0].dots, [{ x: 500, y: 500 }, { x: 500, y: 1500 }]);
        });

        it("returns an empty list for a too-short or non-buffer body", () => {
            assert.deepStrictEqual(EcovacsMapParser.PARSE_VIRTUAL_WALLS(Buffer.alloc(4)), []);
            assert.deepStrictEqual(EcovacsMapParser.PARSE_VIRTUAL_WALLS(null), []);
        });

        it("renders a two-dot wall as a VIRTUAL_WALL line and a four-dot wall as a NO_GO_AREA polygon", () => {
            const grid = Buffer.alloc(4 * 4);
            grid[0] = 4; // one floor cell so the map is not empty
            const walls = [
                { type: 0, dots: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
                { type: 0, dots: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }
            ];
            const map = EcovacsMapParser.BUILD_MAP(grid, 4, 4, 50, undefined, walls);
            const line = map.entities.find(e => e.type === "virtual_wall");
            const poly = map.entities.find(e => e.type === "no_go_area");

            assert.ok(line, "a virtual_wall line entity");
            assert.strictEqual(line.points.length, 4);
            assert.ok(poly, "a no_go_area polygon entity");
            assert.strictEqual(poly.points.length, 8);
        });
    });
});

function u32(value) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value >>> 0, 0);
    return b;
}

function f32(value) {
    const b = Buffer.alloc(4);
    b.writeFloatLE(value, 0);
    return b;
}
