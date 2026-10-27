const EcovacsCommandFactory = require("../EcovacsCommandFactory");
const FanSpeedControlCapability = require("../../../core/capabilities/FanSpeedControlCapability");

/**
 * Vacuum power via /setting/SettingManage (FAN_LEVEL). Each preset's value is
 * {mode, isSilent}, written at the verified SettingData offsets.
 *
 * @extends FanSpeedControlCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsFanSpeedControlCapability extends FanSpeedControlCapability {
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

        const { mode, isSilent } = matched.value;
        await this.robot.applySetting(EcovacsCommandFactory.SETTING_TYPE.FAN_LEVEL, [
            { offset: EcovacsCommandFactory.SETTING_OFFSET.FAN_MODE, value: mode },
            { offset: EcovacsCommandFactory.SETTING_OFFSET.FAN_IS_SILENT, value: isSilent }
        ]);
    }
}

module.exports = EcovacsFanSpeedControlCapability;
