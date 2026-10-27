const BasicControlCapability = require("../../../core/capabilities/BasicControlCapability");

/**
 * Start / stop / pause / resume / home via the robot's /task/WorkManage service.
 *
 * @extends BasicControlCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsBasicControlCapability extends BasicControlCapability {
    async start() {
        await this.robot.callRosService(this.robot.commandFactory.start());
    }

    async stop() {
        await this.robot.callRosService(this.robot.commandFactory.stop());
    }

    async pause() {
        await this.robot.callRosService(this.robot.commandFactory.pause());
    }

    async home() {
        await this.robot.callRosService(this.robot.commandFactory.home());
    }
}

module.exports = EcovacsBasicControlCapability;
