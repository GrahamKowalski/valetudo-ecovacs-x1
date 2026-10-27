const CarpetModeControlCapability = require("../../../core/capabilities/CarpetModeControlCapability");
const EcovacsCommandFactory = require("../EcovacsCommandFactory");

/**
 * Carpet suction/brush boost on-off via /setting/SettingManage (CARPET_MODE, a
 * CustomSetting). Read-modify-write preserves other settings.
 *
 * @extends CarpetModeControlCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsCarpetModeControlCapability extends CarpetModeControlCapability {
    async isEnabled() {
        const value = await this.robot.readSetting(
            EcovacsCommandFactory.SETTING_TYPE.CARPET_MODE,
            EcovacsCommandFactory.SETTING_OFFSET.CARPET_VALUE
        );

        return value === 1;
    }

    async enable() {
        await this.setCarpet(true);
    }

    async disable() {
        await this.setCarpet(false);
    }

    /**
     * @private
     * @param {boolean} enabled
     */
    async setCarpet(enabled) {
        await this.robot.applySetting(EcovacsCommandFactory.SETTING_TYPE.CARPET_MODE, [
            { offset: EcovacsCommandFactory.SETTING_OFFSET.CARPET_CUSTOM_TYPE, value: EcovacsCommandFactory.SETTING_TYPE.CARPET_MODE },
            { offset: EcovacsCommandFactory.SETTING_OFFSET.CARPET_VALUE, value: enabled ? 1 : 0 }
        ]);
    }
}

module.exports = EcovacsCarpetModeControlCapability;
