const EcovacsGoToLocationCapability = require("./EcovacsGoToLocationCapability");
const ZoneCleaningCapability = require("../../../core/capabilities/ZoneCleaningCapability");

/**
 * Cleans freeform rectangular zones via /task/WorkManage (workType CUSTOM_CLEAN). Each
 * Valetudo zone is a rectangle given by four corner points in centimetres; the robot's
 * CleanWorkData.customAreas takes two dots per area (a pair of opposite corners) in the
 * world frame in millimetres, so each zone contributes its top-left (pA) and bottom-right
 * (pC) corners, converted with the same transform GoTo uses.
 *
 * @extends ZoneCleaningCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsZoneCleaningCapability extends ZoneCleaningCapability {
    /**
     * @param {object} options
     * @param {Array<import("../../../entities/core/ValetudoZone")>} options.zones
     * @param {number} [options.iterations]
     * @returns {Promise<void>}
     */
    async start(options) {
        const geometry = this.robot.getMapGeometry();
        const toMm = point => {
            return EcovacsGoToLocationCapability.POINT_CM_TO_WORLD_MM(point.x, point.y, geometry);
        };

        const dots = [];
        for (const zone of options.zones) {
            dots.push(toMm(zone.points.pA), toMm(zone.points.pC));
        }

        if (dots.length === 0) {
            return;
        }

        await this.robot.callRosService(this.robot.commandFactory.cleanZones(dots));
    }
}

module.exports = EcovacsZoneCleaningCapability;
