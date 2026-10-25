const assert = require("node:assert");
const { describe, it } = require("node:test");

const EcocloudRedactor = require("../../../lib/ecovacs/EcocloudRedactor");

// All values here are made up
const redactor = new EcocloudRedactor({
    secrets: {
        deviceId: "abcdef12-3456-7890-abcd-ef1234567890",
        mId: "x1fake",
        resourceId: "Rf4K",
        tooShort: "ab",
        notAString: undefined
    }
});

describe("EcocloudRedactor", () => {
    it("masks known values in topics", () => {
        assert.strictEqual(
            redactor.redactString("iot/p2p/getInfo/abcdef12-3456-7890-abcd-ef1234567890/x1fake/Rf4K/q/AbCd/j"),
            "iot/p2p/getInfo/<deviceId>/<mId>/<resourceId>/q/AbCd/j"
        );
    });

    it("masks MAC addresses", () => {
        assert.strictEqual(redactor.redactString("mac=00:1A:2b:3C:4d:5E,"), "mac=<mac>,");
        assert.strictEqual(redactor.redactString("00-1a-2b-3c-4d-5e"), "<mac>");
    });

    it("does not mask secrets embedded in longer tokens", () => {
        assert.strictEqual(redactor.redactString("QRf4KzzZ"), "QRf4KzzZ");
    });

    it("ignores secrets that are too short or not strings", () => {
        assert.strictEqual(redactor.redactString("ab/undefined"), "ab/undefined");
    });

    it("deep-redacts objects and arrays without touching keys", () => {
        assert.deepStrictEqual(
            redactor.redact({ x1fake: ["x1fake", 3, null, { id: "Rf4K" }] }),
            { x1fake: ["<mId>", 3, null, { id: "<resourceId>" }] }
        );
    });
});
