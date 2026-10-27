const assert = require("node:assert");
const { describe, it } = require("node:test");

const EcovacsX1OmniValetudoRobot = require("../../../../lib/robots/ecovacs/EcovacsX1OmniValetudoRobot");

// pollState is exercised in isolation via prototype.call to avoid standing up the full
// robot (config, Ecocloud server, ValetudoRobot base).
describe("EcovacsX1OmniValetudoRobot.pollState", () => {
    it("serves state from the ROS link without polling Ecocloud when the link is active", async () => {
        let ecocloudPolled = false;
        const self = {
            rosLink: {},
            state: { marker: "ros" },
            ecocloud: {
                send: async () => {
                    ecocloudPolled = true;
                    return {};
                }
            }
        };

        const result = await EcovacsX1OmniValetudoRobot.prototype.pollState.call(self);

        assert.strictEqual(result, self.state);
        assert.strictEqual(ecocloudPolled, false);
    });

    it("falls back to the Ecocloud poll when there is no ROS link", async () => {
        let ecocloudPolled = false;
        const self = {
            rosLink: null,
            state: { marker: "cloud" },
            ecocloud: {
                send: async () => {
                    ecocloudPolled = true;
                    return { body: { data: {} } };
                }
            },
            parseAndUpdateState: () => {}
        };

        const result = await EcovacsX1OmniValetudoRobot.prototype.pollState.call(self);

        assert.strictEqual(result, self.state);
        assert.strictEqual(ecocloudPolled, true);
    });
});
