const fs = require("fs");
const Logger = require("../Logger");
const path = require("path");

/**
 * Appends every MQTT exchange seen by Ecocloud to a JSON-lines file, redacted, before any filtering happens.
 * These recordings are the raw evidence for implementing capabilities.
 *
 * One file is created per session: ecocloud-<ISO timestamp>.jsonl
 */
class EcocloudRecorder {
    /**
     * @param {object} options
     * @param {string} options.directory
     * @param {import("./EcocloudRedactor")} options.redactor
     */
    constructor(options) {
        this.redactor = options.redactor;

        fs.mkdirSync(options.directory, { recursive: true });
        this.filePath = path.join(
            options.directory,
            `ecocloud-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`
        );
        this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
        this.stream.on("error", (err) => {
            Logger.warn("EcocloudRecorder: Error while writing capture", err);
        });

        Logger.info(`EcocloudRecorder: Recording to ${this.filePath}`);
    }

    /**
     * @param {"in"|"out"} direction
     * @param {string} topic
     * @param {Buffer|string} payload
     * @param {string} [clientId]
     */
    recordMessage(direction, topic, payload, clientId) {
        this.write({
            dir: direction,
            client: clientId,
            topic: topic,
            payload: this.decodePayload(payload)
        });
    }

    /**
     * For connection lifecycle things such as connect, subscribe or disconnect
     *
     * @param {string} type
     * @param {object} [details]
     */
    recordEvent(type, details) {
        this.write({
            dir: "event",
            event: type,
            ...details
        });
    }

    /**
     * @private
     * @param {Buffer|string} payload
     * @returns {any}
     */
    decodePayload(payload) {
        const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? "");
        const str = buf.toString("utf8");

        try {
            return { encoding: "json", data: JSON.parse(str) };
        } catch {
            if (Buffer.from(str, "utf8").equals(buf)) {
                return { encoding: "utf8", data: str };
            } else {
                return { encoding: "base64", data: buf.toString("base64") };
            }
        }
    }

    /**
     * @private
     * @param {object} entry
     */
    write(entry) {
        const redacted = this.redactor.redact({ ts: new Date().toISOString(), ...entry });

        this.stream.write(JSON.stringify(redacted) + "\n");
    }

    /**
     * @returns {Promise<void>}
     */
    shutdown() {
        return new Promise((resolve) => {
            this.stream.end(resolve);
        });
    }
}

module.exports = EcocloudRecorder;
