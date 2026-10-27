const assert = require("node:assert");
const { describe, it } = require("node:test");

const EcovacsCommandFactory = require("../../../../lib/robots/ecovacs/EcovacsCommandFactory");

const hex = buf => {
    return Buffer.from(buf).toString("hex");
};

describe("EcovacsCommandFactory", () => {
    const factory = new EcovacsCommandFactory();

    describe("WorkManage commands (byte-exact, verified on device)", () => {
        it("home = managetype 0, workType 5, 53 bytes", () => {
            const c = factory.home();

            assert.strictEqual(c.service, "/task/WorkManage");
            assert.strictEqual(c.md5sum, "*");
            assert.strictEqual(c.request.length, 53);
            assert.strictEqual(c.request[0], 0);
            assert.strictEqual(c.request[1], 5);
            // all WorkData counts/fields zero
            assert.strictEqual(hex(c.request), "0005" + "00".repeat(51));
        });

        it("start = managetype 0, workType 0", () => {
            const c = factory.start();
            assert.strictEqual(hex(c.request), "0000" + "00".repeat(51));
        });

        it("stop / pause / resume set the manage type", () => {
            assert.strictEqual(factory.stop().request[0], 1);
            assert.strictEqual(factory.pause().request[0], 2);
            assert.strictEqual(factory.resume().request[0], 3);
            assert.strictEqual(factory.stop().request.length, 53);
        });

        it("cleanSegments puts the id count at byte 2 and ids from byte 6", () => {
            const c = factory.cleanSegments([2]);

            assert.strictEqual(c.request.length, 54);
            assert.strictEqual(c.request[0], 0);
            assert.strictEqual(c.request[1], 1); // AREA_CLEAN
            assert.strictEqual(c.request.readUInt32LE(2), 1); // ids count
            assert.strictEqual(c.request[6], 2); // first id

            const multi = factory.cleanSegments([3, 4, 5]);
            assert.strictEqual(multi.request.length, 56);
            assert.strictEqual(multi.request.readUInt32LE(2), 3);
            assert.deepStrictEqual([...multi.request.subarray(6, 9)], [3, 4, 5]);
        });

        it("goTo puts the pose count at byte 34 and x,y,theta at 54,58,62", () => {
            const c = factory.goTo(812, 135, -2.571);

            assert.strictEqual(c.request.length, 81);
            assert.strictEqual(c.request[0], 0);
            assert.strictEqual(c.request[1], 6); // GOTO
            assert.strictEqual(c.request.readUInt32LE(34), 1); // poses count
            assert.strictEqual(Math.round(c.request.readFloatLE(54)), 812);
            assert.strictEqual(Math.round(c.request.readFloatLE(58)), 135);
            assert.ok(Math.abs(c.request.readFloatLE(62) + 2.571) < 1e-3);
        });
    });

    describe("SettingManage commands", () => {
        it("getSetting is a 54-byte GET for the type", () => {
            const c = factory.getSetting(EcovacsCommandFactory.SETTING_TYPE.FAN_LEVEL);

            assert.strictEqual(c.service, "/setting/SettingManage");
            assert.strictEqual(c.request.length, 54);
            assert.strictEqual(c.request[0], 0); // GET
            assert.strictEqual(c.request[1], 7); // FAN_LEVEL
        });

        it("setFanLevel writes mode at byte 22 and isSilent at 23, as a SET", () => {
            const c = factory.setFanLevel(2, 0);

            assert.strictEqual(c.request[0], 1); // SET
            assert.strictEqual(c.request[1], 7); // FAN_LEVEL
            assert.strictEqual(c.request[22], 2);
            assert.strictEqual(c.request[23], 0);
        });

        it("setWaterLevel writes level at byte 20", () => {
            const c = factory.setWaterLevel(3);

            assert.strictEqual(c.request[0], 1);
            assert.strictEqual(c.request[1], 6); // WATER_LEVEL
            assert.strictEqual(c.request[20], 3);
        });

        it("read-modify-write preserves other bytes from a prior GET", () => {
            const current = Buffer.alloc(54);
            current[20] = 2; // some existing water level in the fetched SettingData
            current[30] = 9; // some unrelated byte we must not clobber
            const c = factory.setFanLevel(1, 0, current);

            assert.strictEqual(c.request[22], 1); // our write
            assert.strictEqual(c.request[30], 9); // preserved
        });
    });

    describe("mop / carpet / scent (verified offsets)", () => {
        it("setMopMode writes MopMode.type at byte 19", () => {
            const c = factory.setMopMode(1);

            assert.strictEqual(c.request[0], 1); // SET
            assert.strictEqual(c.request[1], 5); // MOP_MODE
            assert.strictEqual(c.request[19], 1);
        });

        it("setCarpetMode writes the CustomSetting type at byte 2 and on/off at byte 3", () => {
            const on = factory.setCarpetMode(true);
            assert.strictEqual(on.request[1], 8); // CARPET_MODE settingType
            assert.strictEqual(on.request[2], 8); // CustomSetting.type must equal CARPET_MODE
            assert.strictEqual(on.request[3], 1);

            assert.strictEqual(factory.setCarpetMode(false).request[3], 0);
        });

        it("setScent publishes a 1-byte level to the aromatherapy topic", () => {
            const c = factory.setScent(4);

            assert.strictEqual(c.topic, "/setting/AromatherapyLevel");
            assert.strictEqual(c.payload.length, 1);
            assert.strictEqual(c.payload[0], 4);
        });

        it("READ_SETTING_BYTE reads a byte from a GET response body", () => {
            const body = Buffer.alloc(54);
            body[3] = 1;
            assert.strictEqual(EcovacsCommandFactory.READ_SETTING_BYTE(body, 3), 1);
            assert.strictEqual(EcovacsCommandFactory.READ_SETTING_BYTE(body, 99), null);
            assert.strictEqual(EcovacsCommandFactory.READ_SETTING_BYTE("x", 0), null);
        });
    });

    describe("audio / locate", () => {
        it("locate publishes audio/AudioPlay with audiomode 0, value 31 (8 bytes)", () => {
            const c = factory.locate();

            assert.strictEqual(c.topic, "/audio/AudioPlay");
            assert.strictEqual(c.type, "audio/AudioPlay");
            assert.strictEqual(c.payload.length, 8);
            assert.strictEqual(c.payload.readUInt32LE(0), 0);
            assert.strictEqual(c.payload.readUInt32LE(4), 31);
            assert.strictEqual(hex(c.payload), "000000001f000000");
        });
    });
});
