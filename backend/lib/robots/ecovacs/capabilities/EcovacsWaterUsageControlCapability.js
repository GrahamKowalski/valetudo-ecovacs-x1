const EcovacsCommandFactory = require("../EcovacsCommandFactory");
const WaterUsageControlCapability = require("../../../core/capabilities/WaterUsageControlCapability");

/**
 * Mop water usage via /setting/SettingManage (WATER_LEVEL). Each preset's value is the
 * WaterLevel.level (0 low .. 3 ultra), written at the verified SettingData offset.
 *
 * @extends WaterUsageControlCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsWaterUsageControlCapability extends WaterUsageControlCapability {
    /**
     * @param {string} preset
     * @returns {Promise<void>}
     */
    async selectPreset(preset) {
        const matched = this.presets.find(p => {
            return p.name === preset;
        });
        if (!matched) {
            throw new Error("Invalid Preset");
        }

        await this.robot.applySetting(EcovacsCommandFactory.SETTING_TYPE.WATER_LEVEL, [
            { offset: EcovacsCommandFactory.SETTING_OFFSET.WATER_LEVEL, value: matched.value }
        ]);
    }
}

module.exports = EcovacsWaterUsageControlCapability;
