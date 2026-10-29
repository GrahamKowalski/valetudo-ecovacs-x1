const KeyLockCapability = require("../../../core/capabilities/KeyLockCapability");

/**
 * Station child lock on/off by publishing to /omni/control (type 1). The robot does not
 * expose a child-lock read over ROS yet, so the last-set value is tracked on the robot.
 *
 * @extends KeyLockCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsKeyLockCapability extends KeyLockCapability {
    /**
     * @returns {Promise<boolean>}
     */
    async isEnabled() {
        return this.robot.keyLockEnabled === true;
    }

    async enable() {
        await this.robot.publishRosMessage(this.robot.commandFactory.childLock(true));
        this.robot.keyLockEnabled = true;
    }

    async disable() {
        await this.robot.publishRosMessage(this.robot.commandFactory.childLock(false));
        this.robot.keyLockEnabled = false;
    }
}

module.exports = EcovacsKeyLockCapability;
