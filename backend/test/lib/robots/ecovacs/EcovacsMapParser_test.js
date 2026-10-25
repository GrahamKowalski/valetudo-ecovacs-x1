const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const EcovacsMapParser = require("../../../../lib/robots/ecovacs/EcovacsMapParser");
const { assertParsedMap } = require("../../../helpers/map");

const FIXTURE_DIR = path.join(__dirname, "/res/map/");
const CAPTURE_SUFFIX = ".capture.json";

const fixtures = fs.readdirSync(FIXTURE_DIR)
    .filter(f => {
        return f.endsWith(CAPTURE_SUFFIX);
    })
    .map(f => {
        return f.slice(0, -CAPTURE_SUFFIX.length);
    });

describe("EcovacsMapParser", () => {
    if (fixtures.length === 0) {
        it("parses captured X1 maps", { skip: "no captured X1 map fixtures yet" }, () => {});
    }

    fixtures.forEach(name => {
        it(`parses ${name}`, () => {
            const entries = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name + CAPTURE_SUFFIX), { encoding: "utf-8" }));
            const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name + ".expected.json"), { encoding: "utf-8" }));

            const actual = EcovacsMapParser.PARSE(entries);

            assertParsedMap(actual, expected);
        });
    });
});
