const DoNotDisturbCapability = require("../../../core/capabilities/DoNotDisturbCapability");
const EcovacsCommandFactory = require("../EcovacsCommandFactory");
const ValetudoDNDConfiguration = require("../../../entities/core/ValetudoDNDConfiguration");

/**
 * Do Not Disturb via /setting/SettingManage (BLOCK_TIME). The BlockTimeSetting carries an
 * on/off flag plus a start and end DateTime; only the hour and minute of each are used.
 * Byte offsets were mapped on device and cross-checked against the firmware's own
 * settingBlock.json.
 *
 * @extends DoNotDisturbCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsDoNotDisturbCapability extends DoNotDisturbCapability {
    /**
     * @returns {Promise<ValetudoDNDConfiguration>}
     */
    async getDndConfiguration() {
        const T = EcovacsCommandFactory.SETTING_TYPE;
        const O = EcovacsCommandFactory.SETTING_OFFSET;
        const body = await this.robot.readSettingBody(T.BLOCK_TIME);

        const read = (offset) => {
            const value = EcovacsCommandFactory.READ_SETTING_BYTE(body, offset);

            return typeof value === "number" ? value : 0;
        };

        return new ValetudoDNDConfiguration({
            enabled: read(O.BLOCK_ON) === 1,
            start: {
                hour: read(O.BLOCK_START_HOUR),
                minute: read(O.BLOCK_START_MIN)
            },
            end: {
                hour: read(O.BLOCK_END_HOUR),
                minute: read(O.BLOCK_END_MIN)
            }
        });
    }

    /**
     * @param {ValetudoDNDConfiguration} dndConfig
     * @returns {Promise<void>}
     */
    async setDndConfiguration(dndConfig) {
        const O = EcovacsCommandFactory.SETTING_OFFSET;

        await this.robot.applySetting(EcovacsCommandFactory.SETTING_TYPE.BLOCK_TIME, [
            { offset: O.BLOCK_ON, value: dndConfig.enabled ? 1 : 0 },
            { offset: O.BLOCK_START_HOUR, value: dndConfig.start.hour },
            { offset: O.BLOCK_START_MIN, value: dndConfig.start.minute },
            { offset: O.BLOCK_END_HOUR, value: dndConfig.end.hour },
            { offset: O.BLOCK_END_MIN, value: dndConfig.end.minute }
        ]);
    }
}

module.exports = EcovacsDoNotDisturbCapability;
