const assert = require("node:assert");
const { describe, it } = require("node:test");

const EcovacsRosMessageDecoder = require("../../../../lib/robots/ecovacs/EcovacsRosMessageDecoder");

const DEFINITION = `
# a root type with every builtin kind, constants, comments and nested types
uint8 KIND_A = 1   # constant, must be skipped
Header header
bool flag
int16 small
uint32 big
float32 ratio
float64 precise
string name
uint8[] bytes
uint16[2] pair
demo/Inner inner
Inner[] inners
================================================================================
MSG: std_msgs/Header
uint32 seq
time stamp
string frame_id
================================================================================
MSG: demo/Inner
int8 code
string label
`;

function u32(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
}
function str(s) {
    return Buffer.concat([u32(Buffer.byteLength(s, "utf8")), Buffer.from(s, "utf8")]);
}
function inner(code, label) {
    return Buffer.concat([Buffer.from([code & 0xff]), str(label)]);
}

describe("EcovacsRosMessageDecoder", () => {
    it("parses field lines and skips constants and comments", () => {
        const specs = EcovacsRosMessageDecoder.PARSE_DEFINITION(DEFINITION, "demo/Root");

        assert.deepStrictEqual([...specs.keys()], ["demo/Root", "std_msgs/Header", "demo/Inner"]);
        assert.deepStrictEqual(specs.get("demo/Root").map(f => {
            return f.name;
        }), ["header", "flag", "small", "big", "ratio", "precise", "name", "bytes", "pair", "inner", "inners"]);
        assert.deepStrictEqual(specs.get("demo/Root").find(f => {
            return f.name === "bytes";
        }).array, -1);
        assert.deepStrictEqual(specs.get("demo/Root").find(f => {
            return f.name === "pair";
        }).array, 2);
    });

    it("decodes builtins, strings, arrays and nested messages", () => {
        const small = Buffer.alloc(2);
        small.writeInt16LE(-7);
        const ratio = Buffer.alloc(4);
        ratio.writeFloatLE(0.5);
        const precise = Buffer.alloc(8);
        precise.writeDoubleLE(1.25);
        const pair = Buffer.alloc(4);
        pair.writeUInt16LE(10, 0);
        pair.writeUInt16LE(20, 2);

        const body = Buffer.concat([
            u32(9), u32(100), u32(500000000), str("map"),       // header: seq, time, frame_id
            Buffer.from([1]),                                   // flag
            small,
            u32(70000),
            ratio,
            precise,
            str("héllo"),
            u32(3), Buffer.from([1, 2, 3]),                     // bytes[]
            pair,
            inner(-1, "a"),                                     // inner
            u32(2), inner(5, "x"), inner(6, "yz")               // inners[]
        ]);

        const decoder = new EcovacsRosMessageDecoder({ type: "demo/Root", text: DEFINITION });
        const { message: m, bytesConsumed } = decoder.decode(body);

        assert.strictEqual(bytesConsumed, body.length);
        assert.strictEqual(m.header.seq, 9);
        assert.strictEqual(m.header.stamp, 100.5);
        assert.strictEqual(m.header.frame_id, "map");
        assert.strictEqual(m.flag, true);
        assert.strictEqual(m.small, -7);
        assert.strictEqual(m.big, 70000);
        assert.strictEqual(m.ratio, 0.5);
        assert.strictEqual(m.precise, 1.25);
        assert.strictEqual(m.name, "héllo");
        assert.ok(Buffer.isBuffer(m.bytes));
        assert.deepStrictEqual([...m.bytes], [1, 2, 3]);
        assert.deepStrictEqual(m.pair, [10, 20]);
        assert.deepStrictEqual(m.inner, { code: -1, label: "a" });
        assert.deepStrictEqual(m.inners, [{ code: 5, label: "x" }, { code: 6, label: "yz" }]);
    });

    it("encodes what it decodes, byte for byte, and fills missing fields with zeros", () => {
        const decoder = new EcovacsRosMessageDecoder({ type: "demo/Root", text: DEFINITION });
        const full = {
            header: { seq: 9, stamp: 100.5, frame_id: "map" },
            flag: true, small: -7, big: 70000, ratio: 0.5, precise: 1.25, name: "héllo",
            bytes: Buffer.from([1, 2, 3]), pair: [10, 20],
            inner: { code: -1, label: "a" },
            inners: [{ code: 5, label: "x" }, { code: 6, label: "yz" }]
        };
        const body = decoder.encode(full);
        const { message, bytesConsumed } = decoder.decode(body);

        assert.strictEqual(bytesConsumed, body.length);
        assert.deepStrictEqual(message, full);

        const sparse = decoder.decode(decoder.encode({ pair: [1, 2], big: 5 })).message;
        assert.strictEqual(sparse.big, 5);
        assert.strictEqual(sparse.name, "");
        assert.deepStrictEqual(sparse.inners, []);
        assert.deepStrictEqual(sparse.inner, { code: 0, label: "" });
        assert.throws(() => {
            decoder.encode({ pair: [1] });
        }, /needs exactly 2 items/);
    });

    it("throws on a truncated body", () => {
        const decoder = new EcovacsRosMessageDecoder({ type: "demo/Root", text: DEFINITION });

        assert.throws(() => {
            decoder.decode(Buffer.alloc(10));
        });
    });

    it("throws on an unknown nested type", () => {
        assert.throws(() => {
            new EcovacsRosMessageDecoder({ type: "x/Y", text: "other/Thing t\n" }).decode(Buffer.alloc(4));
        }, /Unknown ROS message type/);
    });
});
