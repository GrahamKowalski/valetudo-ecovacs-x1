const CombinedVirtualRestrictionsCapability = require("../../../core/capabilities/CombinedVirtualRestrictionsCapability");
const EcovacsCommandFactory = require("../EcovacsCommandFactory");
const EcovacsGoToLocationCapability = require("./EcovacsGoToLocationCapability");

/**
 * Virtual walls and no-go zones via /map/ManipulateVirtualWall. A virtual wall is a two-dot
 * line; a no-go zone is a four-dot polygon. Valetudo coordinates (cm) are converted to the
 * robot's world frame (mm) with the same transform GoTo uses. getVirtualRestrictions() is
 * inherited: it reads the walls the map parser renders from the live wall list.
 *
 * @extends CombinedVirtualRestrictionsCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsCombinedVirtualRestrictionsCapability extends CombinedVirtualRestrictionsCapability {
    /**
     * @param {import("../../../entities/core/ValetudoVirtualRestrictions")} virtualRestrictions
     * @returns {Promise<void>}
     */
    async setVirtualRestrictions(virtualRestrictions) {
        const mapId = this.robot.currentVendorMapId;
        if (!mapId) {
            throw new Error("No map id known yet; wait for the first map poll to complete");
        }

        const geometry = this.robot.getMapGeometry();
        const toMm = point => {
            return EcovacsGoToLocationCapability.POINT_CM_TO_WORLD_MM(point.x, point.y, geometry);
        };
        const NORMAL = EcovacsCommandFactory.VWALL_TYPE.NORMAL;

        // The service has no "replace" op, so clear everything and re-add the full set.
        await this.robot.callRosService(this.robot.commandFactory.clearVirtualWalls(mapId));

        for (const wall of virtualRestrictions.virtualWalls) {
            const dots = [toMm(wall.points.pA), toMm(wall.points.pB)];
            await this.robot.callRosService(this.robot.commandFactory.addVirtualWall(mapId, NORMAL, dots));
        }

        for (const zone of virtualRestrictions.restrictedZones) {
            const p = zone.points;
            const dots = [toMm(p.pA), toMm(p.pB), toMm(p.pC), toMm(p.pD)];
            await this.robot.callRosService(this.robot.commandFactory.addVirtualWall(mapId, NORMAL, dots));
        }

        await this.robot.refreshMap();
    }
}

module.exports = EcovacsCombinedVirtualRestrictionsCapability;
