const EcovacsRosXmlRpcClient = require("./EcovacsRosXmlRpcClient");
const EcovacsTcpRosFramer = require("./EcovacsTcpRosFramer");
const Logger = require("../../../Logger");
const net = require("net");

/**
 * Raw TCPROS client: subscribe to topics and call services on a ROS1 graph without
 * registering a node of our own. Publishers are found through the master's
 * getSystemState/lookupNode, then asked for a TCPROS endpoint via requestTopic on
 * their own XML-RPC API, exactly as the research toolkit does. Stdlib only.
 *
 * Message bodies are handed out raw; decoding is EcovacsRosMessageDecoder's job.
 */
class EcovacsTcpRosClient {
    /**
     * @param {object} options
     * @param {string} options.masterUri e.g. "http://127.0.0.1:11311"
     * @param {string} [options.callerId]
     */
    constructor(options) {
        this.master = new EcovacsRosXmlRpcClient(options.masterUri);
        this.callerId = options.callerId ?? "/valetudo";
    }

    /**
     * @param {string} topic
     * @returns {Promise<{nodeName: string, nodeUri: string, type: string}>}
     */
    async lookupPublisher(topic) {
        const [code, status, state] = await this.master.call("getSystemState", [this.callerId]);
        if (code !== 1) {
            throw new Error(`getSystemState failed: ${status}`);
        }
        const publishers = state[0].find(entry => {
            return entry[0] === topic;
        });
        if (!publishers || publishers[1].length === 0) {
            throw new Error(`No publisher for ${topic}`);
        }
        const nodeName = publishers[1][0];

        const [, , types] = await this.master.call("getTopicTypes", [this.callerId]);
        const typeEntry = types.find(entry => {
            return entry[0] === topic;
        });
        const [lcode, lstatus, nodeUri] = await this.master.call("lookupNode", [this.callerId, nodeName]);
        if (lcode !== 1) {
            throw new Error(`lookupNode ${nodeName} failed: ${lstatus}`);
        }

        return {
            nodeName: nodeName,
            nodeUri: nodeUri,
            type: typeEntry ? typeEntry[1] : "*"
        };
    }

    /**
     * Subscribes and keeps the connection alive until close() is called. Reconnects
     * with a 3 s backoff on any failure (publisher restart, network blip).
     *
     * @param {string} topic
     * @param {object} handlers
     * @param {(header: Object<string, string>) => void} [handlers.onHeader] publisher header (type, md5sum, message_definition)
     * @param {(body: Buffer) => void} handlers.onMessage raw message body
     * @param {(err: Error) => void} [handlers.onError]
     * @returns {{close: () => void}}
     */
    subscribe(topic, handlers) {
        const sub = { closed: false, socket: null, timer: null };
        const connect = async () => {
            if (sub.closed) {
                return;
            }
            try {
                const pub = await this.lookupPublisher(topic);
                const [code, status, proto] = await new EcovacsRosXmlRpcClient(pub.nodeUri).call("requestTopic", [this.callerId, topic, [["TCPROS"]]]);
                if (code !== 1 || !proto || proto[0] !== "TCPROS") {
                    throw new Error(`requestTopic ${topic} failed: ${status}`);
                }
                if (sub.closed) {
                    return;
                }

                const socket = net.createConnection({ host: proto[1], port: proto[2] });
                sub.socket = socket;
                let gotHeader = false;
                const framer = new EcovacsTcpRosFramer(frame => {
                    if (!gotHeader) {
                        gotHeader = true;
                        const header = EcovacsTcpRosClient.DECODE_HEADER(frame);
                        if (header.error) {
                            socket.destroy(new Error(`Publisher refused ${topic}: ${header.error}`));
                            return;
                        }
                        if (handlers.onHeader) {
                            handlers.onHeader(header);
                        }
                    } else {
                        handlers.onMessage(frame);
                    }
                });

                socket.on("connect", () => {
                    socket.write(EcovacsTcpRosClient.ENCODE_HEADER({
                        callerid: this.callerId,
                        topic: topic,
                        md5sum: "*",
                        type: pub.type,
                        tcp_nodelay: "1"
                    }));
                });
                socket.on("data", chunk => {
                    framer.push(chunk);
                });
                socket.on("error", err => {
                    if (handlers.onError) {
                        handlers.onError(err);
                    }
                });
                socket.on("close", () => {
                    sub.socket = null;
                    if (!sub.closed) {
                        Logger.debug(`TCPROS ${topic} closed, reconnecting in ${RECONNECT_DELAY_MS} ms`);
                        sub.timer = setTimeout(connect, RECONNECT_DELAY_MS);
                    }
                });
            } catch (err) {
                if (handlers.onError) {
                    handlers.onError(err);
                }
                if (!sub.closed) {
                    sub.timer = setTimeout(connect, RECONNECT_DELAY_MS);
                }
            }
        };

        connect().catch(() => { /* handled above */ });

        return {
            close: () => {
                sub.closed = true;
                clearTimeout(sub.timer);
                if (sub.socket) {
                    sub.socket.destroy();
                }
            }
        };
    }

    /**
     * One-shot service call.
     *
     * @param {string} service
     * @param {Buffer} request encoded request body
     * @param {object} [options]
     * @param {string} [options.md5sum] "*" skips the server-side check
     * @param {number} [options.timeoutMs]
     * @returns {Promise<Buffer>} the encoded response body
     */
    async callService(service, request, options = {}) {
        const [code, status, uri] = await this.master.call("lookupService", [this.callerId, service]);
        if (code !== 1) {
            throw new Error(`lookupService ${service} failed: ${status}`);
        }
        const m = uri.match(/^rosrpc:\/\/(.+):(\d+)$/);
        if (!m) {
            throw new Error(`Unexpected service URI ${uri}`);
        }

        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: m[1], port: parseInt(m[2], 10) });
            const timer = setTimeout(() => {
                socket.destroy(new Error(`Service call ${service} timed out`));
            }, options.timeoutMs ?? 10000);
            let stage = 0; // 0 header, 1 ok byte, 2 response
            let okByte = null;
            const framer = new EcovacsTcpRosFramer(frame => {
                if (stage === 0) {
                    const header = EcovacsTcpRosClient.DECODE_HEADER(frame);
                    if (header.error) {
                        socket.destroy(new Error(`Service ${service} refused: ${header.error}`));
                        return;
                    }
                    stage = 1;
                    socket.write(Buffer.concat([u32(request.length), request]));
                } else {
                    clearTimeout(timer);
                    socket.end();
                    if (okByte === 1) {
                        resolve(frame);
                    } else {
                        reject(new Error(`Service ${service} error: ${frame.toString("utf8")}`));
                    }
                }
            });

            socket.on("connect", () => {
                socket.write(EcovacsTcpRosClient.ENCODE_HEADER({
                    callerid: this.callerId,
                    service: service,
                    md5sum: options.md5sum ?? "*",
                    persistent: "0"
                }));
            });
            socket.on("data", chunk => {
                // after the header, the response is preceded by a bare ok byte
                if (stage === 1 && okByte === null && chunk.length > 0) {
                    okByte = chunk[0];
                    chunk = chunk.subarray(1);
                    stage = 2;
                }
                framer.push(chunk);
            });
            socket.on("error", err => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    /**
     * @param {Object<string, string>} fields
     * @returns {Buffer}
     */
    static ENCODE_HEADER(fields) {
        const parts = Object.entries(fields).map(([k, v]) => {
            const kv = Buffer.from(`${k}=${v}`, "utf8");
            return Buffer.concat([u32(kv.length), kv]);
        });
        const body = Buffer.concat(parts);

        return Buffer.concat([u32(body.length), body]);
    }

    /**
     * @param {Buffer} body header body (without the outer length)
     * @returns {Object<string, string>}
     */
    static DECODE_HEADER(body) {
        /** @type {Object<string, string>} */
        const fields = {};
        let off = 0;
        while (off + 4 <= body.length) {
            const len = body.readUInt32LE(off);
            off += 4;
            const kv = body.toString("utf8", off, off + len);
            off += len;
            const eq = kv.indexOf("=");
            if (eq > 0) {
                fields[kv.slice(0, eq)] = kv.slice(eq + 1);
            }
        }

        return fields;
    }
}


/**
 * @param {number} n
 * @returns {Buffer}
 */
function u32(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
}

const RECONNECT_DELAY_MS = 3000;

module.exports = EcovacsTcpRosClient;
