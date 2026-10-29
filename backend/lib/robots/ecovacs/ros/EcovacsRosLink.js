const EcovacsRosDefinitions = require("../EcovacsRosDefinitions");
const EcovacsTcpRosClient = require("./EcovacsTcpRosClient");
const Logger = require("../../../Logger");

/**
 * Feeds the X1 robot implementation from the robot's own ROS graph: subscribes to the
 * state topics and periodically fetches the map through the map service. This is the
 * reflash-free, cloud-free data path; it needs the backend to reach the ROS master
 * (127.0.0.1:11311 when running on the robot).
 *
 * The robot object needs the handle*() callbacks used below plus lastRobotState/
 * lastDockPose, which EcovacsX1OmniValetudoRobot has.
 */
class EcovacsRosLink {
    /**
     * @param {object} options
     * @param {import("../EcovacsX1OmniValetudoRobot")} options.robot
     * @param {string} [options.masterUri]
     * @param {EcovacsTcpRosClient} [options.client] injected for tests
     * @param {number} [options.robotStateIntervalMs] throttle for the 50 Hz /robot/Robot topic
     * @param {number} [options.mapPollIntervalMs] 0 disables map polling
     */
    constructor(options) {
        this.robot = options.robot;
        this.client = options.client ?? new EcovacsTcpRosClient({
            masterUri: options.masterUri ?? "http://127.0.0.1:11311",
            callerId: "/valetudo"
        });
        this.robotStateIntervalMs = options.robotStateIntervalMs ?? 1000;
        this.mapPollIntervalMs = options.mapPollIntervalMs ?? 30000;

        this.subscriptions = [];
        this.mapTimer = null;
        this.lastRobotStateAt = 0;
        this.mapPollInFlight = false;
    }

    start() {
        const R = EcovacsRosDefinitions;
        this.subscriptions.push(
            this.client.subscribe(R.ROBOT.topic, {
                onHeader: h => {
                    this.checkMd5(R.ROBOT, h);
                },
                onMessage: body => {
                    const now = Date.now();
                    if (now - this.lastRobotStateAt < this.robotStateIntervalMs) {
                        return;
                    }
                    this.lastRobotStateAt = now;
                    this.robot.handleRobotState(body);
                },
                onError: this.logError(R.ROBOT.topic)
            }),
            this.client.subscribe(R.WORK_STATE.topic, {
                onHeader: h => {
                    this.checkMd5(R.WORK_STATE, h);
                },
                onMessage: body => {
                    this.robot.handleWorkState(body);
                },
                onDisconnect: () => {
                    this.robot.handleTaskInterruption();
                },
                onError: this.logError(R.WORK_STATE.topic)
            }),
            this.client.subscribe(R.CHARGER_DOCK_INFO.topic, {
                onHeader: h => {
                    this.checkMd5(R.CHARGER_DOCK_INFO, h);
                },
                onMessage: body => {
                    this.robot.handleChargerDockInfo(body);
                },
                onError: this.logError(R.CHARGER_DOCK_INFO.topic)
            }),
            this.simpleSubscription(R.FAN_MODE, body => {
                this.robot.handleFanMode(body);
            }),
            this.simpleSubscription(R.WATER_LEVEL, body => {
                this.robot.handleWaterLevel(body);
            }),
            this.simpleSubscription(R.TASK_STATE_REPORT, body => {
                this.robot.handleTaskStateReport(body);
            }),
            this.simpleSubscription(R.TASK_RESULT, body => {
                this.robot.handleTaskResult(body);
            }),
            this.simpleSubscription(R.LIFESPAN_REPORT, body => {
                this.robot.handleLifespanReport(body);
            })
        );

        if (this.mapPollIntervalMs > 0) {
            this.pollMap().catch(() => { /* logged inside */ });
            this.mapTimer = setInterval(() => {
                this.pollMap().catch(() => { /* logged inside */ });
            }, this.mapPollIntervalMs);
        }
    }

    stop() {
        clearInterval(this.mapTimer);
        this.mapTimer = null;
        this.subscriptions.forEach(s => {
            s.close();
        });
        this.subscriptions = [];
    }

    /**
     * @param {string} service
     * @param {Buffer} request
     * @param {string} [md5sum]
     * @returns {Promise<Buffer>} the response body
     */
    callService(service, request, md5sum) {
        return this.client.callService(service, request, {
            md5sum: md5sum ?? "*",
            timeoutMs: 15000
        });
    }

    /**
     * @param {string} topic
     * @param {string} type
     * @param {Buffer} payload
     * @returns {Promise<void>}
     */
    async publish(topic, type, payload) {
        await this.client.publish(topic, type, payload, {});
    }

    /**
     * Fetches the current map (type 0, mapid 0) and hands it to the robot together
     * with the latest robot and charger poses.
     *
     * @returns {Promise<void>}
     */
    async pollMap() {
        if (this.mapPollInFlight) {
            return;
        }
        this.mapPollInFlight = true;
        try {
            const payload = await this.client.callService(MAP_SERVICE, MAP_REQUEST, { md5sum: "*", timeoutMs: 20000 });
            await this.robot.handleMapData(payload, {
                robot: this.robot.lastRobotState ? this.robot.lastRobotState.pose : undefined,
                charger: this.robot.lastDockPose
            });
        } catch (err) {
            Logger.warn(`ROS map poll failed: ${err.message}`);
        } finally {
            this.mapPollInFlight = false;
        }
    }

    /**
     * @private
     * @param {{topic: string, md5sum: string}} def
     * @param {(body: Buffer) => void} onMessage
     */
    simpleSubscription(def, onMessage) {
        return this.client.subscribe(def.topic, {
            onHeader: h => {
                this.checkMd5(def, h);
            },
            onMessage: onMessage,
            onError: this.logError(def.topic)
        });
    }

    /**
     * @private
     * @param {{topic: string, md5sum: string}} def
     * @param {Object<string, string>} header
     */
    checkMd5(def, header) {
        if (header.md5sum && header.md5sum !== def.md5sum) {
            Logger.warn(`ROS ${def.topic} md5 ${header.md5sum} differs from the embedded definition (${def.md5sum}); the firmware may have changed the message layout`);
        } else {
            Logger.info(`ROS ${def.topic} subscribed (${header.type ?? "?"})`);
        }
    }

    /**
     * @private
     * @param {string} topic
     * @returns {(err: Error) => void}
     */
    logError(topic) {
        return err => {
            Logger.warn(`ROS ${topic}: ${err.message}`);
        };
    }
}

const MAP_SERVICE = "/map/GetCurrentCompressMap";
// map/GetCurrentCompressMapRequest: uint8 type (0 = current), uint32 mapid (0 = current)
const MAP_REQUEST = Buffer.from([0, 0, 0, 0, 0]);

module.exports = EcovacsRosLink;
