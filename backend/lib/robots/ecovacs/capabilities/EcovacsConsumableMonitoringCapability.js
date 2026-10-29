const ConsumableMonitoringCapability = require("../../../core/capabilities/ConsumableMonitoringCapability");
const ValetudoConsumable = require("../../../entities/core/ValetudoConsumable");

const TYPE = ValetudoConsumable.TYPE;
const SUB_TYPE = ValetudoConsumable.SUB_TYPE;
const PERCENT = ValetudoConsumable.UNITS.PERCENT;

// Maps each Valetudo consumable to its field in the robot's lifespan report.
const CONSUMABLES = Object.freeze([
    { type: TYPE.BRUSH, subType: SUB_TYPE.MAIN, field: "mainBrush" },
    { type: TYPE.BRUSH, subType: SUB_TYPE.SIDE_RIGHT, field: "sideBrush" },
    { type: TYPE.FILTER, subType: SUB_TYPE.MAIN, field: "filter" },
    { type: TYPE.MOP, subType: SUB_TYPE.MAIN, field: "mop" }
]);

/**
 * Reports consumable remaining-life percentages from the robot's /lifespan/lifespanreport
 * topic (stored by EcovacsX1OmniValetudoRobot.handleLifespanReport). Reset is not yet mapped
 * on the local interface.
 *
 * @extends ConsumableMonitoringCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsConsumableMonitoringCapability extends ConsumableMonitoringCapability {
    /**
     * @returns {Promise<Array<ValetudoConsumable>>}
     */
    async getConsumables() {
        const report = this.robot.lastLifespanReport ?? null;
        if (report === null) {
            // No lifespan report seen yet; report nothing rather than a false 0% (depleted).
            return [];
        }

        const consumables = CONSUMABLES.map(c => {
            const value = report && typeof report[c.field] === "number" ? report[c.field] : 0;

            return new ValetudoConsumable({
                type: c.type,
                subType: c.subType,
                remaining: {
                    value: value,
                    unit: PERCENT
                }
            });
        });

        this.raiseEventIfRequired(consumables);

        return consumables;
    }

    /**
     * @param {string} type
     * @param {string} [subType]
     * @returns {Promise<void>}
     */
    async resetConsumable(type, subType) {
        throw new Error("Consumable reset is not supported over the local interface");
    }

    getProperties() {
        return {
            availableConsumables: CONSUMABLES.map(c => {
                return {
                    type: c.type,
                    subType: c.subType,
                    unit: PERCENT,
                    maxValue: 100
                };
            })
        };
    }
}

module.exports = EcovacsConsumableMonitoringCapability;
