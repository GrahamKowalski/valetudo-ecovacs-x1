const EcovacsRosDefinitions = require("./EcovacsRosDefinitions");
const EcovacsRosMessageDecoder = require("./EcovacsRosMessageDecoder");

/**
 * Parses the Ecovacs X1 ROS state messages into plain fields.
 *
 * Every message is decoded in full by EcovacsRosMessageDecoder from the definition the
 * robot's publishers send (EcovacsRosDefinitions), then reduced to what Valetudo needs.
 * Enum values below were confirmed on an X1 Plus by handling the robot while streaming
 * its topics (research repo, state-stream-findings-2026-10-26).
 *
 * /robot/Robot (50 Hz): pose (mm, rad), battery, charge, and the attachment sensors:
 *   dirtbox[0].value   0 = dustbin in, 1 = dustbin out
 *   waterbox[0].value  0 = nothing fitted, 2 = mop plate, 4 = vacuum/aromatherapy module
 *   carpet[0].value    1 = carpet detected
 * /task/WorkState (on change): worktype (WORK_TYPE) + state (WORK_STATE)
 * /map/ChargerDockInfo (every 20 s): stored dock pose when hasfindDock is set
 */
class EcovacsRobotStateParser {
    /**
     * @param {Buffer} buf a /robot/Robot message body
     * @returns {EcovacsRobotState|null}
     */
    static PARSE(buf) {
        if (!Buffer.isBuffer(buf) || buf.length < MIN_LENGTH) {
            return null;
        }

        let m;
        try {
            m = ROBOT_DECODER.decode(buf).message;
        } catch {
            return null;
        }

        const waterbox = firstValue(m.waterbox);

        return {
            pose: {
                x: m.pose.pose.x,
                y: m.pose.pose.y,
                theta: m.pose.pose.theta
            },
            battery: m.battery.battery,
            lowVoltage: m.battery.isLowVoltageToPowerOff,
            isOnCharger: m.chargestate.isOnCharger,
            chargeState: m.chargestate.chargeState,
            dustbinIn: firstValue(m.dirtbox) === null ? null : firstValue(m.dirtbox) === 0,
            module: waterbox === null ? null : (MODULE_BY_WATERBOX[waterbox] ?? EcovacsRobotStateParser.MODULE.UNKNOWN),
            carpet: firstValue(m.carpet) === 1,
            bump: {
                left: valueOfType(m.bump, 0) === 1,
                right: valueOfType(m.bump, 1) === 1,
                lds: valueOfType(m.bump, 2) === 1
            }
        };
    }

    /**
     * @param {Buffer} buf a /task/WorkState message body
     * @returns {{worktype: number, state: number, workcause: number}|null}
     */
    static PARSE_WORK_STATE(buf) {
        if (!Buffer.isBuffer(buf)) {
            return null;
        }

        try {
            const m = WORK_STATE_DECODER.decode(buf).message;

            return {
                worktype: m.worktype,
                state: m.state,
                workcause: m.workcause
            };
        } catch {
            return null;
        }
    }

    /**
     * @param {Buffer} buf a /map/ChargerDockInfo message body
     * @returns {{info: number, mapid: number, dock: {x: number, y: number, theta: number}|null}|null}
     *          dock is the stored charger pose (mm, rad) or null when the robot has none
     */
    static PARSE_CHARGER_DOCK_INFO(buf) {
        if (!Buffer.isBuffer(buf)) {
            return null;
        }

        try {
            const m = CHARGER_DOCK_INFO_DECODER.decode(buf).message;

            return {
                info: m.info,
                mapid: m.mapid,
                dock: m.hasfindDock === 1 ? { x: m.finddock.x, y: m.finddock.y, theta: m.finddock.theta } : null
            };
        } catch {
            return null;
        }
    }
}

/**
 * @typedef {object} EcovacsRobotState
 * @property {{x: number, y: number, theta: number}} pose mm, mm, rad (SLAM frame, dock = origin)
 * @property {number} battery 0-100
 * @property {number} lowVoltage
 * @property {number} isOnCharger 0 off, 1 on charger, 3 on 3d charger
 * @property {number} chargeState power/ChargeState enum (1 charging, 2 full, 3/4 error)
 * @property {boolean|null} dustbinIn null when the sensor array is empty
 * @property {string|null} module one of EcovacsRobotStateParser.MODULE, null when the array is empty
 * @property {boolean} carpet
 * @property {{left: boolean, right: boolean, lds: boolean}} bump
 */

/**
 * What is mounted in the robot's rear module bay (waterbox sensor)
 *
 * @enum {string}
 */
EcovacsRobotStateParser.MODULE = Object.freeze({
    NONE: "none",
    MOP: "mop",
    VACUUM: "vacuum", // the vacuum-only / aromatherapy module
    UNKNOWN: "unknown"
});

const MODULE_BY_WATERBOX = Object.freeze({
    0: EcovacsRobotStateParser.MODULE.NONE,
    2: EcovacsRobotStateParser.MODULE.MOP,
    4: EcovacsRobotStateParser.MODULE.VACUUM
});

/**
 * task/WorkType
 *
 * @enum {number}
 */
EcovacsRobotStateParser.WORK_TYPE = Object.freeze({
    AUTO_CLEAN: 0,
    AREA_CLEAN: 1,
    CUSTOM_CLEAN: 2,
    CIRCLE_CLEAN: 3,
    AI_COVER_CLEAN: 4,
    RETURN: 5,
    GOTO: 6,
    IDLE: 7,
    RELOCATION: 8,
    REMOTE_CONTROL: 9,
    AI_GUIDE: 10,
    CHECK_POINT: 11,
    PATROL: 12,
    AUTO_COLLECT_DIRT: 13
});

/**
 * task/WorkStateType
 *
 * @enum {number}
 */
EcovacsRobotStateParser.WORK_STATE = Object.freeze({
    IDLE: 0,
    RUNNING: 1,
    PAUSED: 2
});

/**
 * @param {Array<{type: number, value: number}>} arr
 * @returns {number|null}
 */
function firstValue(arr) {
    return Array.isArray(arr) && arr.length > 0 ? arr[0].value : null;
}

/**
 * @param {Array<{type: number, value: number}>} arr
 * @param {number} type
 * @returns {number|null}
 */
function valueOfType(arr, type) {
    const hit = Array.isArray(arr) ? arr.find(e => {
        return e.type === type;
    }) : undefined;

    return hit ? hit.value : null;
}

const ROBOT_DECODER = new EcovacsRosMessageDecoder(EcovacsRosDefinitions.ROBOT);
const WORK_STATE_DECODER = new EcovacsRosMessageDecoder(EcovacsRosDefinitions.WORK_STATE);
const CHARGER_DOCK_INFO_DECODER = new EcovacsRosMessageDecoder(EcovacsRosDefinitions.CHARGER_DOCK_INFO);

const MIN_LENGTH = 16;

module.exports = EcovacsRobotStateParser;
