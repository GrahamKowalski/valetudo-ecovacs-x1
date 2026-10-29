const AutoEmptyDockManualTriggerCapability = require("../../../core/capabilities/AutoEmptyDockManualTriggerCapability");

/**
 * Triggers the omni station to empty the dustbin via /task/WorkManage (workType 13,
 * AUTO_COLLECT_DIRT). The robot stays docked while the station runs its empty cycle.
 *
 * @extends AutoEmptyDockManualTriggerCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsAutoEmptyDockManualTriggerCapability extends AutoEmptyDockManualTriggerCapability {
    /**
     * @returns {Promise<void>}
     */
    async triggerAutoEmpty() {
        await this.robot.callRosService(this.robot.commandFactory.collectDirt());
    }
}

module.exports = EcovacsAutoEmptyDockManualTriggerCapability;
