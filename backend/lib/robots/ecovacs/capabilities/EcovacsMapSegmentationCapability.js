const MapSegmentationCapability = require("../../../core/capabilities/MapSegmentationCapability");

/**
 * Cleans selected rooms via /task/WorkManage (workType AREA_CLEAN) with their segment ids
 * in CleanWorkData.ids.
 *
 * @extends MapSegmentationCapability<import("../EcovacsX1OmniValetudoRobot")>
 */
class EcovacsMapSegmentationCapability extends MapSegmentationCapability {
    /**
     * @param {Array<import("../../../entities/core/ValetudoMapSegment")>} segments
     * @returns {Promise<void>}
     */
    async executeSegmentAction(segments) {
        const ids = segments.map(s => {
            return parseInt(s.id, 10);
        }).filter(id => {
            return Number.isInteger(id) && id >= 0 && id <= 255;
        });

        if (ids.length === 0) {
            throw new Error("No valid segment ids to clean");
        }

        await this.robot.callRosService(this.robot.commandFactory.cleanSegments(ids));
    }

    getProperties() {
        return {
            iterationCount: {
                min: 1,
                max: 1
            },
            customOrderSupport: false
        };
    }
}

module.exports = EcovacsMapSegmentationCapability;
