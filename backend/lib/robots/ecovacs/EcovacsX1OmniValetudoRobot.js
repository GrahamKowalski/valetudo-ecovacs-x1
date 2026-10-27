// Derived from ValetudoEV (https://github.com/itsjfx/ValetudoEV, Copyright itsjfx), a fork of
// Valetudo (https://github.com/Hypfer/Valetudo, Copyright Sören Beye). Licensed Apache-2.0.
// Imported unmodified from ValetudoEV commit d7a48bca; later changes are recorded in git history.

const capabilities = require("./capabilities");
const Ecocloud = require("../../ecovacs/Ecocloud");
const EcocloudRecorder = require("../../ecovacs/EcocloudRecorder");
const EcocloudRedactor = require("../../ecovacs/EcocloudRedactor");
const EcovacsCommandFactory = require("./EcovacsCommandFactory");
const EcovacsMapParser = require("./EcovacsMapParser");
const EcovacsRobotStateParser = require("./EcovacsRobotStateParser");
const EcovacsRosLink = require("./ros/EcovacsRosLink");
const entities = require("../../entities");
const ErrorStateValetudoEvent = require("../../valetudo_events/events/ErrorStateValetudoEvent");
const fs = require("fs");
const LinuxWifiScanCapability = require("../common/linuxCapabilities/LinuxWifiScanCapability");
const Logger = require("../../Logger");
const Tools = require("../../utils/Tools");
const ValetudoRobot = require("../../core/ValetudoRobot");
const ValetudoRobotError = require("../../entities/core/ValetudoRobotError");
const ValetudoSelectionPreset = require("../../entities/core/ValetudoSelectionPreset");
const { MapLayer, PointMapEntity, ValetudoMap } = require("../../entities/map");
const stateAttrs = entities.state.attributes;

// Our own convention next to upstream's DustCA in /etc/ssl/valetudo/, not something the firmware provides
const TLS_KEY_PATH = "/etc/ssl/valetudo/ecocloud.key";
const TLS_CERT_PATH = "/etc/ssl/valetudo/ecocloud.crt";

// TODO extends EcovacsValetudoRobot
class EcovacsX1OmniValetudoRobot extends ValetudoRobot {
    /**
     *
     * @param {object} options
     * @param {import("../../Configuration")} options.config
     * @param {import("../../ValetudoEventStore")} options.valetudoEventStore
     */
    constructor(options) {
        super(options);
        this.buildMap();

        this.robotConfig = this.config.get("robot");
        this.implConfig = (this.robotConfig && this.robotConfig.implementationSpecificConfig) ?? {};

        this.ecovacsBindIp = this.implConfig["ecovacsBindIp"] ?? (this.config.get("embedded") ? "127.0.0.1" : "0.0.0.0");
        this.ecovacsBindPort = this.implConfig["ecovacsBindPort"] ?? (this.config.get("embedded") ? 443 : 1883);

        this.redactor = new EcocloudRedactor({
            secrets: Object.assign(
                {},
                this.implConfig["ecovacsRedactValues"],
                {
                    deviceId: this.deviceId,
                    mId: this.mId,
                    resourceId: this.resourceId
                }
            )
        });

        const tlsKeyPath = this.implConfig["ecovacsTlsKeyPath"] ?? (this.config.get("embedded") ? TLS_KEY_PATH : undefined);
        const tlsCertPath = this.implConfig["ecovacsTlsCertPath"] ?? (this.config.get("embedded") ? TLS_CERT_PATH : undefined);
        let tlsKey;
        let tlsCert;

        // Pure-local (ROS) mode: the Ecocloud mock is optional. When the ROS link is
        // configured, missing TLS certs are not fatal; state and control use the ROS link.
        const rosConfigured = !!this.implConfig["ecovacsRosMasterUri"];
        let ecocloudDisabled = false;

        if (tlsKeyPath || tlsCertPath) {
            if (!fs.existsSync(tlsKeyPath) || !fs.existsSync(tlsCertPath)) {
                if (!rosConfigured) {
                    throw new Error(`Ecocloud TLS key/certificate not found at "${tlsKeyPath}" and "${tlsCertPath}". Unable to mock the cloud.`);
                }
                Logger.info(`Ecocloud TLS key/certificate not found at "${tlsKeyPath}" and "${tlsCertPath}"; running ROS-only, cloud mock disabled.`);
                ecocloudDisabled = true;
            } else {
                tlsKey = fs.readFileSync(tlsKeyPath);
                tlsCert = fs.readFileSync(tlsCertPath);
            }
        }

        this.ecocloud = ecocloudDisabled ? null : new Ecocloud({
            deviceId: this.deviceId,
            mId: this.mId,
            resourceId: this.resourceId,
            bindIP: this.ecovacsBindIp,
            bindPort: this.ecovacsBindPort,
            tlsKey: tlsKey,
            tlsCert: tlsCert,
            timeout: this.implConfig["ecovacsRequestTimeout"],
            redactor: this.redactor,
            recorder: this.implConfig["ecovacsCaptureDirectory"] ? new EcocloudRecorder({
                directory: this.implConfig["ecovacsCaptureDirectory"],
                redactor: this.redactor
            }) : undefined,
            onConnected: async () => {
                // TODO
            },
            onIncomingCloudMessage: this.onIncomingCloudMessage.bind(this),
        });

        // this.registerCapability(new capabilities.MockWifiConfigurationCapability({robot: this}));
        this.registerCapability(new capabilities.EcovacsWifiConfigurationCapability({
            robot: this,
            networkInterface: "wlan0"
        }));

        this.commandFactory = new EcovacsCommandFactory();

        // Control via the robot's own ROS graph (/task/WorkManage, /setting/SettingManage,
        // /audio/AudioPlay). Active once the ROS link is up (ecovacsRosMasterUri set).
        this.registerCapability(new capabilities.EcovacsBasicControlCapability({ robot: this }));
        this.registerCapability(new capabilities.EcovacsLocateCapability({ robot: this }));
        this.registerCapability(new capabilities.EcovacsGoToLocationCapability({ robot: this }));
        this.registerCapability(new capabilities.EcovacsMapSegmentationCapability({ robot: this }));
        this.registerCapability(new capabilities.EcovacsCarpetModeControlCapability({ robot: this }));
        this.registerCapability(new capabilities.EcovacsFanSpeedControlCapability({
            robot: this,
            presets: [
                new ValetudoSelectionPreset({ name: "low", value: { mode: 0, isSilent: 1 } }),
                new ValetudoSelectionPreset({ name: "medium", value: { mode: 0, isSilent: 0 } }),
                new ValetudoSelectionPreset({ name: "high", value: { mode: 1, isSilent: 0 } }),
                new ValetudoSelectionPreset({ name: "max", value: { mode: 2, isSilent: 0 } })
            ]
        }));
        this.registerCapability(new capabilities.EcovacsWaterUsageControlCapability({
            robot: this,
            presets: [
                new ValetudoSelectionPreset({ name: "low", value: 0 }),
                new ValetudoSelectionPreset({ name: "medium", value: 1 }),
                new ValetudoSelectionPreset({ name: "high", value: 2 }),
                new ValetudoSelectionPreset({ name: "max", value: 3 })
            ]
        }));

        if (this.config.get("embedded") === true) {
            this.registerCapability(new LinuxWifiScanCapability({
                robot: this,
                networkInterface: "wlan0"
            }));
        }

        // this.registerCapability(new capabilities.MockBasicControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockCarpetModeControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockConsumableMonitoringCapability({robot: this}));
        // this.registerCapability(new capabilities.MockDoNotDisturbCapability({robot: this}));
        // this.registerCapability(new capabilities.MockFanSpeedControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockWaterUsageControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockSpeakerVolumeControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockSpeakerTestCapability({robot: this}));
        // this.registerCapability(new capabilities.MockKeyLockCapability({robot: this}));
        // this.registerCapability(new capabilities.MockObstacleAvoidanceControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockLocateCapability({robot: this}));
        // this.registerCapability(new capabilities.MockWifiConfigurationCapability({robot: this}));
        // this.registerCapability(new capabilities.MockWifiScanCapability({robot: this}));
        // this.registerCapability(new capabilities.MockGoToLocationCapability({robot: this}));
        // this.registerCapability(new capabilities.MockMapResetCapability({robot: this}));
        // this.registerCapability(new capabilities.MockPersistentMapControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockPendingMapChangeHandlingCapability({robot: this}));
        // this.registerCapability(new capabilities.MockMapSegmentationCapability({robot: this}));
        // this.registerCapability(new capabilities.MockZoneCleaningCapability({robot: this}));
        // this.registerCapability(new capabilities.MockAutoEmptyDockManualTriggerCapability({robot: this}));
        // this.registerCapability(new capabilities.MockAutoEmptyDockAutoEmptyControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockMappingPassCapability({robot: this}));
        // this.registerCapability(new capabilities.MockVoicePackManagementCapability({robot: this}));
        // this.registerCapability(new capabilities.MockManualControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockCurrentStatisticsCapability({robot: this}));
        // this.registerCapability(new capabilities.MockTotalStatisticsCapability({robot: this}));
        // this.registerCapability(new capabilities.MockOperationModeControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockPetObstacleAvoidanceControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockCollisionAvoidantNavigationControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockCarpetSensorModeControlCapability({robot: this}));
        // this.registerCapability(new capabilities.MockMopDockCleanManualTriggerCapability({robot: this}));
        // this.registerCapability(new capabilities.MockMopDockDryManualTriggerCapability({robot: this}));

        // // Raise events to make them visible in the UI
        // options.valetudoEventStore.raise(new DustBinFullValetudoEvent({}));
        // options.valetudoEventStore.raise(new MopAttachmentReminderValetudoEvent({}));
        // options.valetudoEventStore.raise(new PendingMapChangeValetudoEvent({}));
        // options.valetudoEventStore.raise(new ErrorStateValetudoEvent({
        //     message: "This is an error message"
        // }));

        // this.state.upsertFirstMatchingAttribute(new entities.state.attributes.DockStatusStateAttribute({
        //     value: entities.state.attributes.DockStatusStateAttribute.VALUE.IDLE
        // }));
    }

    async pollState() {
        // With the ROS link active, the state attributes are kept current by the topic
        // subscriptions (handleRobotState/handleWorkState), so there is nothing to poll.
        if (this.rosLink) {
            return this.state;
        }

        const data = await this.ecocloud.send(Ecocloud.MESSAGE_TYPES.P2P, "getInfo", ["getStationState", "getBattery", "getChargeState", "getStats"]);

        this.parseAndUpdateState(data);

        return this.state;
    }

    parseAndUpdateState(data) {
        if (data.body.data.getBattery && data.body.data.getChargeState) {
            /** @type {import("../../entities/state/attributes/BatteryStateAttribute").BatteryStateAttributeFlag} */
            let flag = stateAttrs.BatteryStateAttribute.FLAG.NONE;

            const level = data.body.data.getBattery.data.value;
            if (data.body.data.getChargeState.data.isCharging === 1) {
                if (level === 100) {
                    flag = stateAttrs.BatteryStateAttribute.FLAG.CHARGED;
                } else {
                    flag = stateAttrs.BatteryStateAttribute.FLAG.CHARGING;
                }
            } else {
                flag = stateAttrs.BatteryStateAttribute.FLAG.DISCHARGING;
            }
            this.state.upsertFirstMatchingAttribute(new stateAttrs.BatteryStateAttribute({
                level: level,
                flag: flag,
            }));
        }
    }

    onIncomingCloudMessage(msg) {
        // TODO: handle pushes here once they've been captured from the real device
        Logger.debug(`Cloud message on ${this.redactor.redactString(msg.topic)}`);

        return true;
    }

    static IMPLEMENTATION_AUTO_DETECTION_HANDLER() {
        return true;
    }

    // TODO
    // use mdsctl mid
    // TODO stubbed
    get deviceId() {
        return this.implConfig.deviceId;
    }

    get mId() {
        return this.implConfig.mId;
    }

    get resourceId() {
        return this.implConfig.resourceId;
    }

    startup() {
        // Reflash-free data path: read state and map straight from the robot's ROS graph.
        // Only possible when the backend can reach the master (i.e. runs on the robot).
        if (this.implConfig["ecovacsRosMasterUri"]) {
            this.rosLink = new EcovacsRosLink({
                robot: this,
                masterUri: this.implConfig["ecovacsRosMasterUri"],
                mapPollIntervalMs: this.implConfig["ecovacsRosMapPollInterval"] ?? 30000
            });
            this.rosLink.start();
            Logger.info(`ROS link started against ${this.implConfig["ecovacsRosMasterUri"]}`);

            // The /setting/* topics only publish on change, so read the current presets once
            // via SettingManage GET. The master can be slow right after boot, so retry a bit.
            this.refreshSettingsWithRetry(SETTINGS_REFRESH_ATTEMPTS);
        }

        // Only state whether they're set. The values are device secrets and logs tend to get shared
        Logger.info(`DeviceId ${this.deviceId ? "configured" : "missing"}`);
        Logger.info(`Mid ${this.mId ? "configured" : "missing"}`);
        Logger.info(`ResourceId ${this.resourceId ? "configured" : "missing"}`);
    }

    getManufacturer() {
        return "Ecovacs";
    }

    getModelName() {
        return "X1 Omni";
    }

    getModelDetails() {
        return Object.assign(
            {},
            super.getModelDetails(),
            {
                supportedAttachments: [
                    stateAttrs.AttachmentStateAttribute.TYPE.DUSTBIN,
                    stateAttrs.AttachmentStateAttribute.TYPE.WATERTANK,
                    stateAttrs.AttachmentStateAttribute.TYPE.MOP,
                ]
            }
        );
    }

    /**
     * @return {object}
     */
    getProperties() {
        const superProps = super.getProperties();
        const ourProps = {
            [ValetudoRobot.WELL_KNOWN_PROPERTIES.FIRMWARE_VERSION]: Tools.GET_VALETUDO_VERSION()
        };

        return Object.assign(
            {},
            superProps,
            ourProps
        );
    }

    // /**
    //  * @public
    //  */
    // emitStateUpdated() {
    //     super.emitStateUpdated();
    // }

    // /**
    //  * @public
    //  */
    // emitStateAttributesUpdated() {
    //     super.emitStateAttributesUpdated();
    // }

    // /**
    //  * @public
    //  */
    // emitMapUpdated() {
    //     super.emitMapUpdated();
    // }

    /**
     * Parse a raw map/ManipulateShowMap payload and publish it as the current map.
     * This is the real map path. buildMap() below is a placeholder used until live map
     * acquisition (the ROS ManipulateShowMap service / cloud onMajorMap) is wired up.
     *
     * @public
     * @param {Buffer} payload
     * @param {object} [poses] optional robot/charger world poses (from /robot/Robot and /map/ChargerDockInfo)
     */
    async handleMapData(payload, poses) {
        const map = await EcovacsMapParser.PARSE(payload, poses);
        if (map) {
            this.state.map = map;
            this.emitMapUpdated();
        }
    }

    /**
     * Parse a /robot/Robot message and update battery and charge state.
     *
     * @public
     * @param {Buffer} payload
     */
    handleRobotState(payload) {
        const s = EcovacsRobotStateParser.PARSE(payload);
        if (!s) {
            return;
        }
        this.lastRobotState = s;

        if (s.isOnCharger !== 0 && this.lastError) {
            // Back on the dock (by itself or carried there): the error is resolved.
            this.lastError = null;
            this.lastErrorCode = "";
        }

        let flag = stateAttrs.BatteryStateAttribute.FLAG.DISCHARGING;
        if (s.isOnCharger !== 0) {
            flag = s.battery >= 100 ?
                stateAttrs.BatteryStateAttribute.FLAG.CHARGED :
                stateAttrs.BatteryStateAttribute.FLAG.CHARGING;
        }

        this.state.upsertFirstMatchingAttribute(new stateAttrs.BatteryStateAttribute({
            level: s.battery,
            flag: flag
        }));

        if (s.dustbinIn !== null) {
            this.state.upsertFirstMatchingAttribute(new stateAttrs.AttachmentStateAttribute({
                type: stateAttrs.AttachmentStateAttribute.TYPE.DUSTBIN,
                attached: s.dustbinIn
            }));
        }
        if (s.module !== null) {
            // The module bay holds either the mop plate (with its water path) or the
            // vacuum-only/aromatherapy module. Valetudo's "watertank" is the mop plate here.
            const mop = s.module === EcovacsRobotStateParser.MODULE.MOP;
            this.state.upsertFirstMatchingAttribute(new stateAttrs.AttachmentStateAttribute({
                type: stateAttrs.AttachmentStateAttribute.TYPE.MOP,
                attached: mop
            }));
            this.state.upsertFirstMatchingAttribute(new stateAttrs.AttachmentStateAttribute({
                type: stateAttrs.AttachmentStateAttribute.TYPE.WATERTANK,
                attached: mop
            }));
        }

        this.updateStatus();
    }

    /**
     * @public
     * @param {Buffer} payload a raw /task/WorkState message body
     */
    handleWorkState(payload) {
        const w = EcovacsRobotStateParser.PARSE_WORK_STATE(payload);
        if (!w) {
            return;
        }
        const previous = this.lastWorkState;
        this.lastWorkState = w;

        const WS = EcovacsRobotStateParser.WORK_STATE;
        if (w.state === WS.RUNNING && (!previous || previous.state !== WS.RUNNING)) {
            // A task (re)started: whatever went wrong before is over.
            this.lastError = null;
            this.lastErrorCode = "";
        } else if (w.state === WS.IDLE && w.workcause === EcovacsRobotStateParser.WORK_CAUSE.ALERT && !this.lastError) {
            this.setError(ERRORS.ALERT_STOP, "workcause " + w.workcause);
            return;
        }

        this.updateStatus();
    }

    /**
     * @public
     * @param {Buffer} payload a raw /map/ChargerDockInfo message body
     */
    handleChargerDockInfo(payload) {
        const d = EcovacsRobotStateParser.PARSE_CHARGER_DOCK_INFO(payload);
        if (!d) {
            return;
        }

        if (d.dock) {
            // Stored dock pose (mm, rad, SLAM frame). Used to place the charger on the map.
            this.lastDockPose = d.dock;
        }
    }

    /**
     * @public
     * @param {Buffer} payload a raw /setting/FanMode message body
     */
    handleFanMode(payload) {
        const f = EcovacsRobotStateParser.PARSE_FAN_MODE(payload);
        if (!f) {
            return;
        }

        this.updateFanSpeedPreset(f.mode, f.isSilent);
    }

    /**
     * @public
     * @param {Buffer} payload a raw /setting/WaterLevel message body
     */
    handleWaterLevel(payload) {
        const w = EcovacsRobotStateParser.PARSE_WATER_LEVEL(payload);
        if (!w) {
            return;
        }

        this.updateWaterGradePreset(w.level);
    }

    /**
     * Stores the fan preset matching a FanMode {mode, isSilent} pair as the current
     * FAN_SPEED state attribute. Unknown pairs are ignored (attribute left as is).
     *
     * @public
     * @param {number} mode
     * @param {number} isSilent
     */
    updateFanSpeedPreset(mode, isSilent) {
        const cap = this.capabilities[capabilities.EcovacsFanSpeedControlCapability.TYPE];
        const preset = cap?.presets.find(p => {
            return p.value.mode === mode && p.value.isSilent === isSilent;
        });
        if (!preset) {
            return;
        }

        this.state.upsertFirstMatchingAttribute(new stateAttrs.PresetSelectionStateAttribute({
            type: stateAttrs.PresetSelectionStateAttribute.TYPE.FAN_SPEED,
            value: preset.name
        }));
    }

    /**
     * @public
     * @param {number} level WaterLevel.level 0..3
     */
    updateWaterGradePreset(level) {
        const cap = this.capabilities[capabilities.EcovacsWaterUsageControlCapability.TYPE];
        const preset = cap?.presets.find(p => {
            return p.value === level;
        });
        if (!preset) {
            return;
        }

        this.state.upsertFirstMatchingAttribute(new stateAttrs.PresetSelectionStateAttribute({
            type: stateAttrs.PresetSelectionStateAttribute.TYPE.WATER_GRADE,
            value: preset.name
        }));
    }

    /**
     * Reads the fan and water settings through SettingManage GET and stores them as
     * preset attributes. Used once at startup since the topics are not latched.
     *
     * @public
     * @returns {Promise<void>}
     */
    async refreshSettings() {
        const O = EcovacsCommandFactory.SETTING_OFFSET;
        const T = EcovacsCommandFactory.SETTING_TYPE;

        const fan = await this.callRosService(this.commandFactory.getSetting(T.FAN_LEVEL));
        const mode = EcovacsCommandFactory.READ_SETTING_BYTE(fan, O.FAN_MODE);
        const isSilent = EcovacsCommandFactory.READ_SETTING_BYTE(fan, O.FAN_IS_SILENT);
        if (mode !== null && isSilent !== null) {
            this.updateFanSpeedPreset(mode, isSilent);
        }

        const water = await this.callRosService(this.commandFactory.getSetting(T.WATER_LEVEL));
        const level = EcovacsCommandFactory.READ_SETTING_BYTE(water, O.WATER_LEVEL);
        if (level !== null) {
            this.updateWaterGradePreset(level);
        }
    }

    /**
     * @private
     * @param {number} attemptsLeft
     */
    refreshSettingsWithRetry(attemptsLeft) {
        const timer = setTimeout(() => {
            this.refreshSettings().then(() => {
                Logger.info("ROS settings snapshot read (fan, water)");
            }).catch(err => {
                if (attemptsLeft > 1) {
                    this.refreshSettingsWithRetry(attemptsLeft - 1);
                } else {
                    Logger.warn(`ROS settings snapshot failed: ${err.message}`);
                }
            });
        }, SETTINGS_REFRESH_DELAY_MS);
        timer.unref();
    }

    /**
     * The robot reports itself stuck through TaskStateReport (stateType 3, state 1 on / 0 off).
     *
     * @public
     * @param {Buffer} payload a raw /task/TaskStateReport message body
     */
    handleTaskStateReport(payload) {
        const r = EcovacsRobotStateParser.PARSE_TASK_STATE_REPORT(payload);
        if (!r) {
            return;
        }

        if (r.stateType === EcovacsRobotStateParser.TASK_STATE_TYPE.CLEAN_ROBOT_IS_STUCK) {
            if (r.state === 1) {
                this.setError(ERRORS.STUCK, "stuck");
            } else if (this.lastError === ERRORS.STUCK) {
                this.clearError();
            }
        }
    }

    /**
     * How the last task ended. Failures become the error state; a success clears it.
     *
     * @public
     * @param {Buffer} payload a raw /task/TaskResult message body
     */
    handleTaskResult(payload) {
        const r = EcovacsRobotStateParser.PARSE_TASK_RESULT(payload);
        if (!r) {
            return;
        }

        const error = TASK_RESULT_TO_ERROR[r.result];
        if (error) {
            this.setError(error, "task " + r.type + " result " + r.result);
        } else if (r.result === EcovacsRobotStateParser.TASK_RESULT.SUCCESS) {
            this.clearError();
        }
    }

    /**
     * @private
     * @param {{message: string, subsystem: string, kind: string}} error one of ERRORS
     * @param {string} vendorErrorCode
     */
    setError(error, vendorErrorCode) {
        const isNew = this.lastError !== error;
        this.lastError = error;
        this.lastErrorCode = vendorErrorCode;

        if (isNew) {
            Logger.warn(`Robot error: ${error.message}`);
            if (this.valetudoEventStore) {
                this.valetudoEventStore.raise(new ErrorStateValetudoEvent({
                    message: error.message
                }));
            }
        }

        this.updateStatus();
    }

    /**
     * @private
     */
    clearError() {
        if (!this.lastError) {
            return;
        }
        this.lastError = null;
        this.lastErrorCode = "";

        this.updateStatus();
    }

    /**
     * Derives the StatusStateAttribute from the latest /task/WorkState and /robot/Robot.
     * A pending error (stuck, failed task) wins; otherwise WorkState is authoritative
     * while a task runs, and the charger decides docked vs idle.
     *
     * @private
     */
    updateStatus() {
        const WT = EcovacsRobotStateParser.WORK_TYPE;
        const WS = EcovacsRobotStateParser.WORK_STATE;
        const VALUE = stateAttrs.StatusStateAttribute.VALUE;
        const FLAG = stateAttrs.StatusStateAttribute.FLAG;
        const w = this.lastWorkState;
        const r = this.lastRobotState;

        let value = VALUE.IDLE;
        let flag = FLAG.NONE;

        if (this.lastError) {
            this.state.upsertFirstMatchingAttribute(new stateAttrs.StatusStateAttribute({
                value: VALUE.ERROR,
                flag: FLAG.NONE,
                error: new ValetudoRobotError({
                    severity: {
                        kind: this.lastError.kind,
                        level: ValetudoRobotError.SEVERITY_LEVEL.ERROR
                    },
                    subsystem: this.lastError.subsystem,
                    message: this.lastError.message,
                    vendorErrorCode: this.lastErrorCode || ""
                })
            }));
            return;
        }

        if (w && w.state !== WS.IDLE && w.worktype !== WT.IDLE) {
            switch (w.worktype) {
                case WT.RETURN:
                    value = VALUE.RETURNING;
                    break;
                case WT.GOTO:
                    value = VALUE.MOVING;
                    flag = FLAG.TARGET;
                    break;
                case WT.RELOCATION:
                    value = VALUE.MOVING;
                    break;
                case WT.REMOTE_CONTROL:
                    value = VALUE.MANUAL_CONTROL;
                    break;
                default:
                    value = w.state === WS.PAUSED ? VALUE.PAUSED : VALUE.CLEANING;
                    flag = WORK_TYPE_TO_FLAG[w.worktype] ?? FLAG.NONE;
            }
        } else if (r && r.isOnCharger !== 0) {
            value = VALUE.DOCKED;
        }

        this.state.upsertFirstMatchingAttribute(new stateAttrs.StatusStateAttribute({
            value: value,
            flag: flag
        }));
    }

    /**
     * @public
     * Placeholder mock map, replaced by handleMapData() once map acquisition is implemented.
     */
    buildMap() {
        this.mockMap = {
            size: 5000,
            pixelSize: 5,
            range: {
                min: 200,
                max: 800
            }
        };
        this.state.map = new ValetudoMap({
            metaData: {
                pendingMapChange: true,
            },
            size: {
                x: this.mockMap.size,
                y: this.mockMap.size
            },
            pixelSize: this.mockMap.pixelSize,
            layers: [this.buildFloor(), this.buildWall()],
            entities: [this.buildCharger(), this.buildRobot()]
        });
        this.emitMapUpdated();
    }

    /**
     * @private
     */
    buildFloor() {
        let pixels = [];
        for (let x = this.mockMap.range.min; x <= this.mockMap.range.max; x++) {
            for (let y = this.mockMap.range.min; y <= this.mockMap.range.max; y++) {
                pixels.push(x, y);
            }
        }

        return new MapLayer({
            type: MapLayer.TYPE.FLOOR,
            pixels: pixels
        });
    }

    /**
     * @private
     */
    buildWall() {
        let pixels = [];
        for (let x = this.mockMap.range.min; x <= this.mockMap.range.max; x++) {
            pixels.push(x, this.mockMap.range.min, x, this.mockMap.range.max);
        }
        for (let y = this.mockMap.range.min; y <= this.mockMap.range.max; y++) {
            pixels.push(this.mockMap.range.min, y, this.mockMap.range.max, y);
        }
        return new MapLayer({
            type: MapLayer.TYPE.WALL,
            pixels: pixels
        });
    }

    /**
     * @private
     */
    buildCharger() {
        return new PointMapEntity({
            type: PointMapEntity.TYPE.CHARGER_LOCATION,
            points: [this.mockMap.range.min * this.mockMap.pixelSize + 50, this.mockMap.range.min * this.mockMap.pixelSize]
        });
    }

    /**
     * @private
     */
    buildRobot() {
        return new PointMapEntity({
            type: PointMapEntity.TYPE.ROBOT_POSITION,
            points: [this.mockMap.range.min * this.mockMap.pixelSize + 50, this.mockMap.range.min * this.mockMap.pixelSize + 50],
            metaData: {
                angle: 180
            }
        });
    }

    /**
     * Calls a ROS service described by the command factory. Throws if the ROS control
     * link is not active (it is only available when the backend can reach the master,
     * i.e. running on the robot with ecovacsRosMasterUri configured).
     *
     * @param {{service: string, request: Buffer, md5sum: string}} command
     * @returns {Promise<Buffer>} the response body
     */
    async callRosService(command) {
        if (!this.rosLink) {
            throw new Error("ROS control link not active; set implementationSpecificConfig.ecovacsRosMasterUri");
        }

        return this.rosLink.callService(command.service, command.request, command.md5sum);
    }

    /**
     * Publishes a one-shot message to a topic the robot subscribes to (e.g. the locate sound).
     *
     * @param {{topic: string, type: string, payload: Buffer}} command
     * @returns {Promise<void>}
     */
    async publishRosMessage(command) {
        if (!this.rosLink) {
            throw new Error("ROS control link not active; set implementationSpecificConfig.ecovacsRosMasterUri");
        }

        await this.rosLink.publish(command.topic, command.type, command.payload);
    }

    /**
     * Read-modify-write a setting: GET the current SettingData, apply the byte writes,
     * SET it back, so unrelated settings are preserved.
     *
     * @param {number} settingType
     * @param {Array<{offset: number, value: number}>} writes
     * @returns {Promise<void>}
     */
    async applySetting(settingType, writes) {
        const current = await this.callRosService(this.commandFactory.getSetting(settingType));
        await this.callRosService(this.commandFactory.buildSettingSet(settingType, current, writes));
    }

    /**
     * GETs one setting and returns a single byte of its SettingData (e.g. the carpet
     * on/off flag), for capabilities that need to read current state.
     *
     * @param {number} settingType
     * @param {number} offset
     * @returns {Promise<number|null>}
     */
    async readSetting(settingType, offset) {
        const body = await this.callRosService(this.commandFactory.getSetting(settingType));

        return EcovacsCommandFactory.READ_SETTING_BYTE(body, offset);
    }

    /**
     * Grid geometry for coordinate conversion (GoTo). Taken from the current map when
     * available, else the X1's fixed 800x800 @ 50 mm (5 cm pixels).
     *
     * @returns {{width: number, height: number, resolutionMm: number, pixelSize: number}}
     */
    getMapGeometry() {
        const map = this.state.map;
        const pixelSize = (map && map.pixelSize) ? map.pixelSize : 5;

        return {
            width: map ? Math.round(map.size.x / pixelSize) : 800,
            height: map ? Math.round(map.size.y / pixelSize) : 800,
            resolutionMm: 50,
            pixelSize: pixelSize
        };
    }

    async shutdown() {
        await super.shutdown();
        if (this.rosLink) {
            this.rosLink.stop();
        }
        if (this.ecocloud) {
            await this.ecocloud.shutdown();
        }
    }
}

const SETTINGS_REFRESH_DELAY_MS = 5000;
const SETTINGS_REFRESH_ATTEMPTS = 6;

/**
 * Error conditions the robot reports over ROS. Kept as constants so handlers can
 * compare identity (e.g. only the stuck report may clear the stuck error).
 */
const ERRORS = Object.freeze({
    STUCK: Object.freeze({
        message: "Robot is stuck",
        subsystem: ValetudoRobotError.SUBSYSTEM.NAVIGATION,
        kind: ValetudoRobotError.SEVERITY_KIND.TRANSIENT
    }),
    ALERT_STOP: Object.freeze({
        message: "Task stopped by an alert",
        subsystem: ValetudoRobotError.SUBSYSTEM.CORE,
        kind: ValetudoRobotError.SEVERITY_KIND.TRANSIENT
    }),
    TASK_FAILED: Object.freeze({
        message: "Task failed",
        subsystem: ValetudoRobotError.SUBSYSTEM.CORE,
        kind: ValetudoRobotError.SEVERITY_KIND.TRANSIENT
    }),
    DOCK_UNREACHABLE: Object.freeze({
        message: "Could not reach the charging dock",
        subsystem: ValetudoRobotError.SUBSYSTEM.DOCK,
        kind: ValetudoRobotError.SEVERITY_KIND.TRANSIENT
    }),
    DOCK_NOT_FOUND: Object.freeze({
        message: "Could not find the charging dock",
        subsystem: ValetudoRobotError.SUBSYSTEM.DOCK,
        kind: ValetudoRobotError.SEVERITY_KIND.TRANSIENT
    }),
    AREA_NOT_FOUND: Object.freeze({
        message: "Could not find the requested area",
        subsystem: ValetudoRobotError.SUBSYSTEM.NAVIGATION,
        kind: ValetudoRobotError.SEVERITY_KIND.TRANSIENT
    })
});

const TASK_RESULT_TO_ERROR = Object.freeze({
    [EcovacsRobotStateParser.TASK_RESULT.FAILED]: ERRORS.TASK_FAILED,
    [EcovacsRobotStateParser.TASK_RESULT.RETURN_FAILED_FIND_CHARGE]: ERRORS.DOCK_UNREACHABLE,
    [EcovacsRobotStateParser.TASK_RESULT.RETURN_FAILED_CANNOT_FIND_CHARGE]: ERRORS.DOCK_NOT_FOUND,
    [EcovacsRobotStateParser.TASK_RESULT.FAILED_FIND_AREA]: ERRORS.AREA_NOT_FOUND
});

const WORK_TYPE_TO_FLAG = Object.freeze({
    [EcovacsRobotStateParser.WORK_TYPE.AREA_CLEAN]: stateAttrs.StatusStateAttribute.FLAG.SEGMENT,
    [EcovacsRobotStateParser.WORK_TYPE.CUSTOM_CLEAN]: stateAttrs.StatusStateAttribute.FLAG.ZONE,
    [EcovacsRobotStateParser.WORK_TYPE.CIRCLE_CLEAN]: stateAttrs.StatusStateAttribute.FLAG.SPOT
});

EcovacsX1OmniValetudoRobot.ERRORS = ERRORS;

module.exports = EcovacsX1OmniValetudoRobot;
