const GoToLocationCapability = require("../../../core/capabilities/GoToLocationCapability");

/**
 * Drives the robot to a point via /task/WorkManage (workType GOTO). Valetudo coordinates
 * are in centimetres; this converts them to the robot's world frame in millimetres, the
 * exact inverse of EcovacsMapParser.POSE_TO_ENTITY (grid pixel = cm / pixelSize;
 * mm = (pixel - width/2) * resolutionMm).
 *
 * @extends GoToLocationCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsGoToLocationCapability extends GoToLocationCapability {
    /**
     * @param {import("../../../entities/core/ValetudoGoToLocation")} valetudoGoToLocation
     * @returns {Promise<void>}
     */
    async goTo(valetudoGoToLocation) {
        const { x, y } = EcovacsGoToLocationCapability.POINT_CM_TO_WORLD_MM(
            valetudoGoToLocation.coordinates.x,
            valetudoGoToLocation.coordinates.y,
            this.robot.getMapGeometry()
        );

        await this.robot.callRosService(this.robot.commandFactory.goTo(x, y, 0));
    }

    /**
     * @param {number} xCm
     * @param {number} yCm
     * @param {{width: number, height: number, resolutionMm: number, pixelSize: number}} geometry
     * @returns {{x: number, y: number}} world coordinates in mm
     */
    static POINT_CM_TO_WORLD_MM(xCm, yCm, geometry) {
        const { width, height, resolutionMm, pixelSize } = geometry;

        return {
            x: Math.round((xCm / pixelSize - width / 2) * resolutionMm),
            y: Math.round((yCm / pixelSize - height / 2) * resolutionMm)
        };
    }
}

module.exports = EcovacsGoToLocationCapability;
