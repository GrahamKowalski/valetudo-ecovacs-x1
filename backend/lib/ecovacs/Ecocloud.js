// Derived from ValetudoEV (https://github.com/itsjfx/ValetudoEV, Copyright itsjfx), a fork of
// Valetudo (https://github.com/Hypfer/Valetudo, Copyright Sören Beye). Licensed Apache-2.0.
// Imported unmodified from ValetudoEV commit d7a48bca; later changes are recorded in git history.

const EcocloudTimeoutError = require("./EcocloudTimeoutError");
const Logger = require("../Logger");
const tls = require("tls");
const { createBroker } = require("aedes");

class Ecocloud {
    /**
     * @param {object} options
     * @param {string} options.deviceId The unique Device-id of your robot
     * @param {string} options.mId      Model ID?
     * @param {string} options.resourceId
     * @param {string} options.bindIP "127.0.0.1" on the robot, "0.0.0.0" in development
     * @param {number} options.bindPort 443 on the robot, 1883 in development
     * @param {string|Buffer} [options.tlsKey] PEM private key of the server certificate. Without key and cert, Ecocloud won't listen
     * @param {string|Buffer} [options.tlsCert] PEM server certificate the robot has to trust
     * @param {number} [options.timeout] P2P request timeout in ms
     * @param {import("./EcocloudRedactor")} options.redactor used for log output
     * @param {import("./EcocloudRecorder")} [options.recorder] if set, every exchange is recorded
     * @param {() => void} options.onConnected  function to call after completing a handshake
     * @param {(msg: any) => boolean} options.onIncomingCloudMessage  function to call for incoming messages
     */
    constructor(options) {
        this.bindIP = options.bindIP;
        this.bindPort = options.bindPort;
        this.deviceId = options.deviceId;
        this.mId = options.mId;
        this.resourceId = options.resourceId;
        this.timeout = options.timeout ?? 500;
        this.redactor = options.redactor;
        this.recorder = options.recorder;
        this.onIncomingCloudMessage = options.onIncomingCloudMessage;
        this.onConnected = options.onConnected;
        this.connected = false;

        this.pendingP2PRequests = {};

        // TODO for some reason Aedes() or new Aedes() complains
        this.aedes = createBroker();

        if (options.tlsKey && options.tlsCert) {
            this.server = tls.createServer({
                key: options.tlsKey,
                cert: options.tlsCert,
            }, this.aedes.handle);

            this.server.listen(this.bindPort, this.bindIP, () => {
                const address = /** @type {import("net").AddressInfo} */ (this.server.address());

                Logger.info(`Ecocloud is listening on ${this.bindIP}:${address.port}`);
            });

            this.server.on("error", (e) => {
                Logger.error("Ecocloud Error: ", e);
            });
        } else {
            Logger.warn("Ecocloud: No TLS key/certificate configured. Not listening.");
        }

        this.aedes.on("subscribe", (subscriptions, client) => {
            const topics = subscriptions.map(s => s.topic);

            Logger.debug(`Ecocloud client: ${this.redactor.redactString(String(client?.id))} subscribed to topics: ${this.redactor.redactString(topics.join(" "))}`);
            this.recorder?.recordEvent("subscribe", { client: client?.id, topics: topics });
        });

        this.aedes.on("unsubscribe", (subscriptions, client) => {
            Logger.debug(`Ecocloud client: ${this.redactor.redactString(String(client?.id))} unsubscribed from topics: ${this.redactor.redactString(subscriptions.join(" "))}`);
            this.recorder?.recordEvent("unsubscribe", { client: client?.id, topics: subscriptions });
        });

        this.aedes.on("client", (client) => {
            Logger.debug(`Ecocloud client: ${this.redactor.redactString(String(client?.id))} connected`);
            this.recorder?.recordEvent("connect", { client: client?.id });
        });

        this.aedes.on("clientDisconnect", (client) => {
            Logger.debug(`Ecocloud client: ${this.redactor.redactString(String(client?.id))} disconnected`);
            this.recorder?.recordEvent("disconnect", { client: client?.id });
        });

        this.aedes.on("publish", async (packet, client) => {
            // internal message or a message from us
            if (!client) {
                return;
            }

            Logger.debug(`Ecocloud client: ${this.redactor.redactString(String(client.id))} published on ${this.redactor.redactString(packet.topic)} with ${this.redactor.redactString(packet.payload.toString())}`);
            this.recorder?.recordMessage("in", packet.topic, packet.payload, client.id);

            const topic = packet.topic.split("/");
            const [iot, topic_type] = topic;
            if (iot !== "iot") {
                // not implemented
                return;
            }

            try {
                packet.payload = JSON.parse(packet.payload.toString("utf8"));
            } catch { /* intentional */ }

            // TODO do this better. detect a handshake
            // TODO disconnect if the robot doesn't send a message / keepalive
            if (!this.connected && typeof this.onConnected === "function") {
                this.connected = true;
                this.onConnected();
            }


            if (topic_type === Ecocloud.MESSAGE_TYPES.P2P) {
                // iot/p2p/getInfo/x/y/z/HelperMQClientId-awsna-sts-ngiot-mqsjmq-21/ecosys/1234/p/S1Ty/j
                const msgId = topic[topic.length - 2];
                const request = this.pendingP2PRequests[msgId];
                if (request) {
                    delete this.pendingP2PRequests[msgId];
                    clearTimeout(request.timeoutId);
                    request.resolve(packet.payload);
                } else {
                    // may have happened during a reboot, or the robot initiated it
                    Logger.debug("<< p2p message without a pending request", msgId);
                }
            }

            // TODO
            // handle default messages if any
            // Everything else is passed on so that unsolicited pushes aren't silently dropped
            this.onIncomingCloudMessage(packet);
        });
    }

    // cloud sends a 4 character alphanumeric request id
    // TOOD semaphore?
    generateMessageId() {
        let messageId = "";
        do {
            for (let i = 0; i < REQUEST_ID_LEN; i++) {
                messageId += REQUEST_ID_CHARS.charAt(Math.floor(Math.random() * REQUEST_ID_CHARS.length));
            }
        } while (messageId in this.pendingP2PRequests);
        // immediately allocate a spot
        this.pendingP2PRequests[messageId] = null;
        return messageId;
    }

    /**
     * @private
     * @param {string} cmd
     * @param {object?} body
     */
    sendP2P(cmd, body) {
        return new Promise((resolve, reject) => {
            // not every message fits this shape
            // but most do
            // TODO see how enforced this is
            const msg = {
                header: {
                    pri: 2,
                    ts: Date.now(),
                    tzm: 600,
                    ver: "0.0.22",
                },
            };
            if (body) {
                msg["body"] = { data: body };
            }
            const msgId = this.generateMessageId();
            this.pendingP2PRequests[msgId] = {
                resolve: resolve,
                reject: reject,
                onTimeout: () => {
                    Logger.debug(`request ${msgId} timed out`);
                    delete this.pendingP2PRequests[msgId];
                    reject(new EcocloudTimeoutError(cmd, msg));
                },
                timeout: null,
            };
            // iot/p2p/getMajorMap/HelperMQClientId-awsna-sts-ngiot-mqsjmq-0/ecosys/1234/x/x/x/q/H5sW/j
            // the temptation is high to name HelperMqClientId... an arbitrary name
            // but a firmware upgrade could check for it
            // so try emulate the real topic name as much as possible
            this.publish({
                topic: `iot/p2p/${cmd}/HelperMQClientId-awsna-sts-ngiot-mqsjmq-0/ecosys/1234/${this.deviceId}/${this.mId}/${this.resourceId}/q/${msgId}/j`,
                payload: JSON.stringify(msg),
            })
                .catch(reject);

            this.pendingP2PRequests[msgId].timeoutId = setTimeout(() => this.pendingP2PRequests[msgId].onTimeout(), this.timeout);
        });
    }

    /**
     * @param {EcocloudMessageTypes} type
     * @param {string} cmd
     * @param {object} body
     */
    async send(type, cmd, body) {
        if (type === Ecocloud.MESSAGE_TYPES.P2P) {
            return this.sendP2P(cmd, body);
        } else {
            Logger.debug(`Unhandled message type: ${type}`);
            throw new Error(`Invalid message type: ${type}`);
        }
    }

    //  * @param {import("aedes").PublishPacket} packet
    /**
     *
     * @private
     * @param {object} packet
     * @returns {Promise<void>}
     */
    publish(packet) {
        this.recorder?.recordMessage("out", packet.topic, packet.payload);

        return new Promise((resolve, reject) => {
            this.aedes.publish(packet, (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }

    handleIncomingCloudMessage(msg) {
        // some default handling.
        //

        // if (!this.onIncomingCloudMessage(msg)) {
        // }
    }

    /**
     * Shutdown Ecocloud
     *
     * @returns {Promise<void>}
     */
    async shutdown() {
        Logger.debug("Ecocloud shutdown in progress...");

        for (const request of Object.values(this.pendingP2PRequests)) {
            if (request) {
                clearTimeout(request.timeoutId);
            }
        }

        await new Promise((resolve) => {
            this.aedes.close(() => {
                resolve();
            });
        });

        if (this.server) {
            await new Promise((resolve) => {
                this.server.close(resolve);
            });
        }

        await this.recorder?.shutdown();

        Logger.debug("Ecocloud shutdown done");
    }
}

// cfg, dtgcfg
/**
 *  @typedef {string} EcocloudMessageTypes
 *  @enum {string}
 *
 */
Ecocloud.MESSAGE_TYPES = Object.freeze({
    P2P: "p2p",
    ATR: "atr",
});

const REQUEST_ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const REQUEST_ID_LEN = 4;

module.exports = Ecocloud;
