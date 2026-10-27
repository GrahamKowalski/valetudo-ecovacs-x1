const LocateCapability = require("../../../core/capabilities/LocateCapability");

/**
 * Makes the robot announce itself ("I am here") by publishing the locate sound to
 * /audio/AudioPlay.
 *
 * @extends LocateCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsLocateCapability extends LocateCapability {
    async locate() {
        await this.robot.publishRosMessage(this.robot.commandFactory.locate());
    }
}

module.exports = EcovacsLocateCapability;
