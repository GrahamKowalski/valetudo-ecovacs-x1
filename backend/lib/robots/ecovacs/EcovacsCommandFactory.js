const EcovacsRosMessageDecoder = require("./EcovacsRosMessageDecoder");

/**
 * Builds the raw request/payload bytes for the X1 control commands.
 *
 * The robot's live service/message layouts differ from the firmware dump's generated
 * code, so these layouts were recovered empirically on the device (byte-mapping with
 * safe no-op probes, 2026-10-26) and are reconstructed here. Field names that could not
 * be recovered (e.g. CleanWorkData.reserved6) are placeholders; they do not affect the
 * wire bytes, and commands are sent with md5sum "*" so the names are never checked.
 *
 * Verified offsets (see research/control-findings + settings-coverage):
 *   /task/WorkManage request: managetype@0, workType@1, then WorkData; min 53 bytes.
 *     CleanWorkData.ids count @2, poses count @34 (Pose = 28 bytes).
 *   /setting/SettingManage request: manageType@0, settingType@1, SettingData@2; 54 bytes.
 *     WaterLevel.level @20, FanMode.mode @22, FanMode.isSilent @23.
 *   /audio/AudioPlay message: uint32 audiomode @0, uint32 value @4 (8 bytes).
 */
class EcovacsCommandFactory {
    constructor() {
        this.workManage = new EcovacsRosMessageDecoder({
            type: "task/WorkManageRequest",
            text: WORK_MANAGE_REQUEST_TEXT
        });
    }

    // ---- /task/WorkManage (service) -------------------------------------------------

    /**
     * @param {number} manageType EcovacsCommandFactory.WORK_CONTROL
     * @param {number} workType EcovacsCommandFactory.WORK_TYPE
     * @param {object} [data] WorkData overrides (cleanData.ids, extraWorkData.poses, ...)
     * @returns {{service: string, request: Buffer, md5sum: string}}
     */
    workManageCommand(manageType, workType, data) {
        const request = this.workManage.encode({
            managetype: manageType,
            workType: workType,
            data: data ?? {}
        });

        return { service: WORK_MANAGE_SERVICE, request: request, md5sum: "*" };
    }

    start() {
        return this.workManageCommand(WORK_CONTROL.START, WORK_TYPE.AUTO_CLEAN);
    }

    stop() {
        return this.workManageCommand(WORK_CONTROL.STOP, WORK_TYPE.AUTO_CLEAN);
    }

    pause() {
        return this.workManageCommand(WORK_CONTROL.PAUSE, WORK_TYPE.AUTO_CLEAN);
    }

    resume() {
        return this.workManageCommand(WORK_CONTROL.RESUME, WORK_TYPE.AUTO_CLEAN);
    }

    home() {
        return this.workManageCommand(WORK_CONTROL.START, WORK_TYPE.RETURN);
    }

    /**
     * Manually triggers the dock to empty the dustbin ("collect dirt"). Argument-free,
     * so the 53-byte zero tail is correct. Verified on device: the station runs its
     * empty cycle while the robot stays docked.
     */
    collectDirt() {
        return this.workManageCommand(WORK_CONTROL.START, WORK_TYPE.AUTO_COLLECT_DIRT);
    }

    /**
     * @param {Array<number>} segmentIds
     */
    cleanSegments(segmentIds) {
        return this.workManageCommand(WORK_CONTROL.START, WORK_TYPE.AREA_CLEAN, {
            cleanData: { ids: segmentIds }
        });
    }

    /**
     * @param {number} x world x in mm (SLAM frame, dock = origin)
     * @param {number} y world y in mm
     * @param {number} [theta] heading in radians
     */
    goTo(x, y, theta = 0) {
        return this.workManageCommand(WORK_CONTROL.START, WORK_TYPE.GOTO, {
            extraWorkData: {
                poses: [{ header: { frame_id: "" }, x: x, y: y, theta: theta }]
            }
        });
    }

    // ---- /setting/SettingManage (service) -------------------------------------------

    /**
     * A read-only GET request for one setting (manageType 0). The caller sends this,
     * then uses buildSettingSet() on the returned SettingData to change one field,
     * preserving every other byte (read-modify-write).
     *
     * @param {number} settingType EcovacsCommandFactory.SETTING_TYPE
     * @returns {{service: string, request: Buffer, md5sum: string}}
     */
    getSetting(settingType) {
        const request = Buffer.alloc(SETTING_REQUEST_LENGTH);
        request[SETTING_OFFSET.MANAGE_TYPE] = SETTING_MANAGE.GET;
        request[SETTING_OFFSET.SETTING_TYPE] = settingType;

        return { service: SETTING_MANAGE_SERVICE, request: request, md5sum: "*" };
    }

    /**
     * Turns a settingType plus one or more (offset, value) writes into a SET request,
     * starting from the bytes a prior GET returned so untouched settings are preserved.
     *
     * @param {number} settingType
     * @param {Buffer|null} current the SettingData bytes from a GET (its full request/response
     *                               body of SETTING_REQUEST_LENGTH), or null to start from zeros
     * @param {Array<{offset: number, value: number}>} writes
     * @returns {{service: string, request: Buffer, md5sum: string}}
     */
    buildSettingSet(settingType, current, writes) {
        const request = Buffer.alloc(SETTING_REQUEST_LENGTH);
        if (Buffer.isBuffer(current) && current.length >= SETTING_REQUEST_LENGTH) {
            current.copy(request, 0, 0, SETTING_REQUEST_LENGTH);
        }
        request[SETTING_OFFSET.MANAGE_TYPE] = SETTING_MANAGE.SET;
        request[SETTING_OFFSET.SETTING_TYPE] = settingType;
        for (const w of writes) {
            request[w.offset] = w.value;
        }

        return { service: SETTING_MANAGE_SERVICE, request: request, md5sum: "*" };
    }

    /**
     * @param {number} mode FanMode.mode 0 low, 1 high, 2 high_high
     * @param {number} [isSilent]
     * @param {Buffer|null} [current] bytes from a prior getSetting(FAN_LEVEL)
     */
    setFanLevel(mode, isSilent = 0, current = null) {
        return this.buildSettingSet(SETTING_TYPE.FAN_LEVEL, current, [
            { offset: SETTING_OFFSET.FAN_MODE, value: mode },
            { offset: SETTING_OFFSET.FAN_IS_SILENT, value: isSilent }
        ]);
    }

    /**
     * @param {number} level WaterLevel.level 0 low .. 3 ultra
     * @param {Buffer|null} [current] bytes from a prior getSetting(WATER_LEVEL)
     */
    setWaterLevel(level, current = null) {
        return this.buildSettingSet(SETTING_TYPE.WATER_LEVEL, current, [
            { offset: SETTING_OFFSET.WATER_LEVEL, value: level }
        ]);
    }

    /**
     * @param {number} type MopMode.type 0 effective, 1 performance
     * @param {Buffer|null} [current] bytes from a prior getSetting(MOP_MODE)
     */
    setMopMode(type, current = null) {
        return this.buildSettingSet(SETTING_TYPE.MOP_MODE, current, [
            { offset: SETTING_OFFSET.MOP_MODE, value: type }
        ]);
    }

    /**
     * Carpet mode is a CustomSetting: its type byte must equal CARPET_MODE and the value
     * byte carries on/off.
     *
     * @param {boolean} enabled
     * @param {Buffer|null} [current] bytes from a prior getSetting(CARPET_MODE)
     */
    setCarpetMode(enabled, current = null) {
        return this.buildSettingSet(SETTING_TYPE.CARPET_MODE, current, [
            { offset: SETTING_OFFSET.CARPET_CUSTOM_TYPE, value: SETTING_TYPE.CARPET_MODE },
            { offset: SETTING_OFFSET.CARPET_VALUE, value: enabled ? 1 : 0 }
        ]);
    }

    /**
     * Do Not Disturb (BlockTimeSetting): an on/off flag plus a start and end time. Only
     * the hour and minute of each DateTime are written; the robot's own block-time file
     * is driven from these fields (verified on device). Offsets cross-checked against the
     * firmware's settingBlock.json (end hour at offset 16, end minute at 17).
     *
     * @param {boolean} enabled
     * @param {{hour: number, minute: number}} start
     * @param {{hour: number, minute: number}} end
     * @param {Buffer|null} [current] bytes from a prior getSetting(BLOCK_TIME)
     */
    setDoNotDisturb(enabled, start, end, current = null) {
        return this.buildSettingSet(SETTING_TYPE.BLOCK_TIME, current, [
            { offset: SETTING_OFFSET.BLOCK_ON, value: enabled ? 1 : 0 },
            { offset: SETTING_OFFSET.BLOCK_START_HOUR, value: start.hour },
            { offset: SETTING_OFFSET.BLOCK_START_MIN, value: start.minute },
            { offset: SETTING_OFFSET.BLOCK_END_HOUR, value: end.hour },
            { offset: SETTING_OFFSET.BLOCK_END_MIN, value: end.minute }
        ]);
    }

    /**
     * Reads a single setting byte from the body a getSetting() call returned (response
     * layout: response@0, settingType@1, SettingData@2, same field offsets as the request).
     *
     * @param {Buffer} responseBody
     * @param {number} offset
     * @returns {number|null}
     */
    static READ_SETTING_BYTE(responseBody, offset) {
        if (!Buffer.isBuffer(responseBody) || offset >= responseBody.length) {
            return null;
        }

        return responseBody[offset];
    }

    // ---- /setting/AromatherapyLevel (publish) ---------------------------------------

    /**
     * Scent intensity is set by publishing to its topic (the robot subscribes).
     *
     * @param {number} level 0 off, 1 on, 2 low, 3 mid, 4 high, 5 ultra
     * @returns {{topic: string, type: string, payload: Buffer}}
     */
    setScent(level) {
        return {
            topic: AROMATHERAPY_TOPIC,
            type: "setting/AromatherapyLevel",
            payload: Buffer.from([level])
        };
    }

    // ---- /omni/control (publish) ----------------------------------------------------

    /**
     * Toggles the station child lock by publishing to /omni/control (type 1).
     *
     * @param {boolean} enabled
     * @returns {{topic: string, type: string, payload: Buffer}}
     */
    childLock(enabled) {
        const payload = Buffer.alloc(5);
        payload.writeUInt32LE(OMNI_CONTROL.CHILD_LOCK, 0);
        payload[4] = enabled ? 1 : 0;

        return { topic: OMNI_CONTROL_TOPIC, type: "omni/control", payload: payload };
    }

    // ---- /audio/AudioPlay (publish) -------------------------------------------------

    /**
     * @param {number} audioId EcovacsCommandFactory.AUDIO (e.g. I_AM_HERE for locate)
     * @returns {{topic: string, type: string, payload: Buffer}}
     */
    playAudio(audioId) {
        const payload = Buffer.alloc(8);
        payload.writeUInt32LE(AUDIO_PLAY_MODE, 0);
        payload.writeUInt32LE(audioId, 4);

        return { topic: AUDIO_PLAY_TOPIC, type: "audio/AudioPlay", payload: payload };
    }

    locate() {
        return this.playAudio(AUDIO.I_AM_HERE);
    }
}

const WORK_MANAGE_SERVICE = "/task/WorkManage";
const SETTING_MANAGE_SERVICE = "/setting/SettingManage";
const AUDIO_PLAY_TOPIC = "/audio/AudioPlay";
const SETTING_REQUEST_LENGTH = 54;
const AUDIO_PLAY_MODE = 0; // AUDIO_PLAY_PLAY_AUDIO

/** task/WorkControlType */
const WORK_CONTROL = Object.freeze({
    START: 0,
    STOP: 1,
    PAUSE: 2,
    RESUME: 3
});

/** task/WorkType (subset used for control) */
const WORK_TYPE = Object.freeze({
    AUTO_CLEAN: 0,
    AREA_CLEAN: 1,
    RETURN: 5,
    GOTO: 6,
    AUTO_COLLECT_DIRT: 13
});

/** setting/SettingManage manageType */
const SETTING_MANAGE = Object.freeze({
    GET: 0,
    SET: 1
});

/** setting/SettingType */
const SETTING_TYPE = Object.freeze({
    BLOCK_TIME: 4,
    MOP_MODE: 5,
    WATER_LEVEL: 6,
    FAN_LEVEL: 7,
    CARPET_MODE: 8,
    AC_ON_OFF: 13
});

/** Verified byte offsets inside the 54-byte SettingManage request */
const SETTING_OFFSET = Object.freeze({
    MANAGE_TYPE: 0,
    SETTING_TYPE: 1,
    CARPET_CUSTOM_TYPE: 2, // CustomSetting.type, must equal SETTING_TYPE.CARPET_MODE
    CARPET_VALUE: 3,       // CustomSetting.settingVal, 0 off / 1 on
    BLOCK_ON: 4,           // BlockTimeSetting.isOn, 0 off / 1 on
    BLOCK_START_HOUR: 9,   // BlockTimeSetting.startTime.hour
    BLOCK_START_MIN: 10,   // BlockTimeSetting.startTime.min
    BLOCK_END_HOUR: 16,    // BlockTimeSetting.endTime.hour
    BLOCK_END_MIN: 17,     // BlockTimeSetting.endTime.min
    MOP_MODE: 19,          // MopMode.type, 0 effective / 1 performance
    WATER_LEVEL: 20,
    FAN_MODE: 22,
    FAN_IS_SILENT: 23,
    AC_ON_OFF: 38          // AutoCollectOnOff, 1 auto-empty on / 0 off
});

const AROMATHERAPY_TOPIC = "/setting/AromatherapyLevel";
const OMNI_CONTROL_TOPIC = "/omni/control";

/** /omni/control type field */
const OMNI_CONTROL = Object.freeze({
    CHILD_LOCK: 1,
    SLEEP_MODE: 2,
    LIGHT_ALERT: 3
});

/** audio/AudioPlay index (subset) */
const AUDIO = Object.freeze({
    I_AM_HERE: 31
});

EcovacsCommandFactory.WORK_CONTROL = WORK_CONTROL;
EcovacsCommandFactory.WORK_TYPE = WORK_TYPE;
EcovacsCommandFactory.SETTING_MANAGE = SETTING_MANAGE;
EcovacsCommandFactory.SETTING_TYPE = SETTING_TYPE;
EcovacsCommandFactory.SETTING_OFFSET = SETTING_OFFSET;
EcovacsCommandFactory.AUDIO = AUDIO;

/**
 * Reconstructed live /task/WorkManage request layout (see class comment). Encodes
 * byte-exact to the on-device-verified commands. `reserved6` is the empirically-found
 * extra CleanWorkData field whose real name is unknown; it is always empty here.
 */
const WORK_MANAGE_REQUEST_TEXT = [
    "uint8 managetype",
    "uint8 workType",
    "WorkData data",
    "================================================================================",
    "MSG: task/WorkData",
    "CleanWorkData cleanData",
    "ExtraWorkData extraWorkData",
    "================================================================================",
    "MSG: task/CleanWorkData",
    "uint8[] ids",
    "uint8[] reserved6",
    "map/Dot[] customAreas",
    "uint8[] cycles",
    "float32 theta",
    "uint8[] states",
    "uint8[] types",
    "================================================================================",
    "MSG: map/Dot",
    "float32 x",
    "float32 y",
    "================================================================================",
    "MSG: task/ExtraWorkData",
    "uint8[] ids",
    "prediction/Pose[] poses",
    "RemoteMove remotes",
    "uint32 tasktime",
    "uint8[] states",
    "================================================================================",
    "MSG: prediction/Pose",
    "Header header",
    "float32 x",
    "float32 y",
    "float32 theta",
    "================================================================================",
    "MSG: std_msgs/Header",
    "uint32 seq",
    "time stamp",
    "string frame_id",
    "================================================================================",
    "MSG: task/RemoteMove",
    "uint8 RemoteMoveType",
    "uint16 lastTime",
    "int16 v",
    "int16 w"
].join("\n");

module.exports = EcovacsCommandFactory;
