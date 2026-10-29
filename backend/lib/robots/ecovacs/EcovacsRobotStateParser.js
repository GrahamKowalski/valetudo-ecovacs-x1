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
 * /setting/FanMode, /setting/WaterLevel (on change): current vacuum power / water presets
 * /task/TaskStateReport: stateType 3 state 1 = the robot reports itself stuck
 * /task/TaskResult: how the last task ended (TASK_RESULT)
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

    /**
     * @param {Buffer} buf a /setting/FanMode message body
     * @returns {{mode: number, isSilent: number}|null}
     */
    static PARSE_FAN_MODE(buf) {
        return decodeOrNull(FAN_MODE_DECODER, buf, m => {
            return { mode: m.mode, isSilent: m.isSilent };
        });
    }

    /**
     * @param {Buffer} buf a /setting/WaterLevel message body
     * @returns {{level: number}|null}
     */
    static PARSE_WATER_LEVEL(buf) {
        return decodeOrNull(WATER_LEVEL_DECODER, buf, m => {
            return { level: m.level };
        });
    }

    /**
     * @param {Buffer} buf a /task/TaskStateReport message body
     * @returns {{tasktype: number, stateType: number, state: number}|null}
     */
    static PARSE_TASK_STATE_REPORT(buf) {
        return decodeOrNull(TASK_STATE_REPORT_DECODER, buf, m => {
            return { tasktype: m.tasktype, stateType: m.stateType, state: m.state };
        });
    }

    /**
     * @param {Buffer} buf a /task/TaskResult message body
     * @returns {{type: number, result: number, data: string}|null}
     */
    static PARSE_TASK_RESULT(buf) {
        return decodeOrNull(TASK_RESULT_DECODER, buf, m => {
            return { type: m.type, result: m.result, data: m.data };
        });
    }

    /**
     * /lifespan/lifespanreport: eight uint8 remaining-life percentages in a fixed order.
     *
     * @param {Buffer} buf a /lifespan/lifespanreport message body
     * @returns {{mainBrush: number, sideBrush: number, filter: number, scent: number,
     *            dustbag: number, silverion: number, doorbar: number, mop: number}|null}
     */
    static PARSE_LIFESPAN_REPORT(buf) {
        if (!Buffer.isBuffer(buf) || buf.length < 8) {
            return null;
        }
        return {
            mainBrush: buf[0],
            sideBrush: buf[1],
            filter: buf[2],
            scent: buf[3],
            dustbag: buf[4],
            silverion: buf[5],
            doorbar: buf[6],
            mop: buf[7]
        };
    }
}

/**
 * @param {EcovacsRosMessageDecoder} decoder
 * @param {Buffer} buf
 * @param {(m: object) => object} pick
 * @returns {object|null}
 */
function decodeOrNull(decoder, buf, pick) {
    if (!Buffer.isBuffer(buf)) {
        return null;
    }

    try {
        return pick(decoder.decode(buf).message);
    } catch {
        return null;
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
 * task/WorkCauseType (WorkState.workcause: why the current work state was entered)
 *
 * @enum {number}
 */
EcovacsRobotStateParser.WORK_CAUSE = Object.freeze({
    NONE: 0,
    MANUAL: 1,
    SCHEDULE: 2,
    WORK_COMPLETE: 3,
    LOW_BATTERY: 4,
    BLOCK_TIME: 5,
    CONTINUE: 6,
    WORK_INTERRUPT: 7,
    ALERT: 8,
    APP_MANUAL: 9
});

/**
 * task/TaskStateType (TaskStateReport.stateType; state 1 = on, 0 = off)
 *
 * @enum {number}
 */
EcovacsRobotStateParser.TASK_STATE_TYPE = Object.freeze({
    RETURN_ENTER_TO_FRONT_OF_CHARGER: 0,
    CLEAN_FINISH_SINGLE_AREA: 1,
    CLEAN_AI_DETECT_TO_CONTROL_BRUSH: 2,
    CLEAN_ROBOT_IS_STUCK: 3,
    OFF_ROBOT_WATER_PUMP: 4
});

/**
 * task/TaskResult.type
 *
 * @enum {number}
 */
EcovacsRobotStateParser.TASK_RESULT_TYPE = Object.freeze({
    GOTO: 0,
    PATROL: 1,
    REMOTE: 2,
    CLEAN: 3,
    RETURN: 4,
    AROMA: 5,
    FASTBUILD: 6,
    FINDPET: 7
});

/**
 * task/TaskResult.result
 *
 * @enum {number}
 */
EcovacsRobotStateParser.TASK_RESULT = Object.freeze({
    SUCCESS: 0,
    FAILED: 1,
    WORKING: 2,
    RETURN_FAILED_FIND_CHARGE: 3,
    RETURN_FAILED_CANNOT_FIND_CHARGE: 4,
    AROMA_SUCCESS_TO_RETURN: 5,
    FAILED_FIND_AREA: 6
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
const FAN_MODE_DECODER = new EcovacsRosMessageDecoder(EcovacsRosDefinitions.FAN_MODE);
const WATER_LEVEL_DECODER = new EcovacsRosMessageDecoder(EcovacsRosDefinitions.WATER_LEVEL);
const TASK_STATE_REPORT_DECODER = new EcovacsRosMessageDecoder(EcovacsRosDefinitions.TASK_STATE_REPORT);
const TASK_RESULT_DECODER = new EcovacsRosMessageDecoder(EcovacsRosDefinitions.TASK_RESULT);

const MIN_LENGTH = 16;

module.exports = EcovacsRobotStateParser;
