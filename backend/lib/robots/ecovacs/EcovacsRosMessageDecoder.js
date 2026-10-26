/**
 * Generic ROS1 message decoder and encoder driven by a message definition text.
 *
 * A TCPROS publisher sends the `.msg` text of its topic type in the connection header
 * (`message_definition`), followed by one `=====`-separated section per nested type
 * (`MSG: pkg/Name`). This class parses that text once and then deserializes raw
 * message bodies into plain objects, so any Ecovacs ROS topic can be decoded without
 * hand-maintained byte offsets. Little-endian throughout, as TCPROS is.
 *
 * Port of the research repo's `scripts/rosmsg_decode.py`, validated against the same
 * captures.
 */
class EcovacsRosMessageDecoder {
    /**
     * @param {object} options
     * @param {string} options.type the root message type, e.g. "robot/Robot"
     * @param {string} options.text the definition text (root section first)
     */
    constructor(options) {
        this.rootType = options.type;
        /** @type {Map<string, Array<{name: string, type: string, array: number|null}>>} */
        this.specs = EcovacsRosMessageDecoder.PARSE_DEFINITION(options.text, options.type);
    }

    /**
     * @param {Buffer} buf a raw message body
     * @returns {{message: object, bytesConsumed: number}}
     */
    decode(buf) {
        const cursor = { buf: buf, off: 0 };
        const message = this.decodeMessage(cursor, this.rootType);

        return { message: message, bytesConsumed: cursor.off };
    }

    /**
     * Encodes a plain object into a message body. Missing fields become zero, empty
     * strings or empty arrays, so a request only needs the fields that matter.
     *
     * @param {object} obj
     * @returns {Buffer}
     */
    encode(obj) {
        return this.encodeMessage(obj ?? {}, this.rootType);
    }

    /**
     * @private
     * @param {object} obj
     * @param {string} type
     * @returns {Buffer}
     */
    encodeMessage(obj, type) {
        const pkg = type.split("/")[0];
        const parts = [];

        for (const field of this.specs.get(type)) {
            const resolved = this.resolve(field.type, pkg);
            const value = obj[field.name];

            if (field.array === null) {
                parts.push(this.encodeScalar(value, resolved));
                continue;
            }

            let items = value ?? [];
            if (Buffer.isBuffer(items)) {
                items = [...items];
            }
            if (field.array >= 0 && items.length !== field.array) {
                throw new Error(`${type}.${field.name} needs exactly ${field.array} items`);
            }
            if (field.array < 0) {
                parts.push(u32(items.length));
            }
            for (const item of items) {
                parts.push(this.encodeScalar(item, resolved));
            }
        }

        return Buffer.concat(parts);
    }

    /**
     * @private
     * @param {any} value
     * @param {string} type resolved type name
     * @returns {Buffer}
     */
    encodeScalar(value, type) {
        const builtin = BUILTIN[type];
        if (builtin) {
            const b = Buffer.alloc(builtin.size);
            builtin.write(b, value ?? 0);
            return b;
        }
        if (type === "string") {
            const s = Buffer.from(value ?? "", "utf8");
            return Buffer.concat([u32(s.length), s]);
        }
        if (type === "time" || type === "duration") {
            const v = value ?? 0;
            const secs = Math.trunc(v);
            const b = Buffer.alloc(8);
            if (type === "time") {
                b.writeUInt32LE(secs, 0);
                b.writeUInt32LE(Math.round((v - secs) * 1e9), 4);
            } else {
                b.writeInt32LE(secs, 0);
                b.writeInt32LE(Math.round((v - secs) * 1e9), 4);
            }
            return b;
        }

        return this.encodeMessage(value ?? {}, type);
    }

    /**
     * @private
     * @param {{buf: Buffer, off: number}} cursor
     * @param {string} type
     * @returns {object}
     */
    decodeMessage(cursor, type) {
        const pkg = type.split("/")[0];
        const fields = this.specs.get(type);
        const out = {};

        for (const field of fields) {
            const resolved = this.resolve(field.type, pkg);

            if (field.array === null) {
                out[field.name] = this.decodeScalar(cursor, resolved);
                continue;
            }

            const count = field.array >= 0 ? field.array : readU32(cursor);
            const builtin = BUILTIN[resolved];

            if (builtin && builtin.size === 1 && resolved !== "bool") {
                // byte arrays stay Buffers, as rospy does with uint8[]
                out[field.name] = cursor.buf.subarray(cursor.off, cursor.off + count);
                cursor.off += count;
            } else {
                const items = new Array(count);
                for (let i = 0; i < count; i++) {
                    items[i] = this.decodeScalar(cursor, resolved);
                }
                out[field.name] = items;
            }
        }

        return out;
    }

    /**
     * @private
     * @param {{buf: Buffer, off: number}} cursor
     * @param {string} type resolved type name
     * @returns {any}
     */
    decodeScalar(cursor, type) {
        const builtin = BUILTIN[type];
        if (builtin) {
            const v = builtin.read(cursor.buf, cursor.off);
            cursor.off += builtin.size;
            return v;
        }
        if (type === "string") {
            const len = readU32(cursor);
            const s = cursor.buf.toString("utf8", cursor.off, cursor.off + len);
            cursor.off += len;
            return s;
        }
        if (type === "time" || type === "duration") {
            const secs = type === "time" ? cursor.buf.readUInt32LE(cursor.off) : cursor.buf.readInt32LE(cursor.off);
            const nsecs = type === "time" ? cursor.buf.readUInt32LE(cursor.off + 4) : cursor.buf.readInt32LE(cursor.off + 4);
            cursor.off += 8;
            return secs + nsecs / 1e9;
        }

        return this.decodeMessage(cursor, type);
    }

    /**
     * Resolves a field type to a builtin name or a key of this.specs.
     * Unqualified names resolve relative to the enclosing package, then by suffix.
     *
     * @private
     * @param {string} type
     * @param {string} pkg
     * @returns {string}
     */
    resolve(type, pkg) {
        if (BUILTIN[type] || type === "string" || type === "time" || type === "duration") {
            return type;
        }
        if (type === "Header") {
            return "std_msgs/Header";
        }
        if (this.specs.has(type)) {
            return type;
        }
        if (!type.includes("/")) {
            const local = `${pkg}/${type}`;
            if (this.specs.has(local)) {
                return local;
            }
            for (const key of this.specs.keys()) {
                if (key.endsWith(`/${type}`)) {
                    return key;
                }
            }
        }

        throw new Error(`Unknown ROS message type "${type}" (from package ${pkg})`);
    }

    /**
     * @param {string} text
     * @param {string} rootType
     * @returns {Map<string, Array<{name: string, type: string, array: number|null}>>}
     */
    static PARSE_DEFINITION(text, rootType) {
        const sections = text.split(SECTION_SEPARATOR);
        const specs = new Map();
        specs.set(rootType, EcovacsRosMessageDecoder.PARSE_SECTION(sections[0]));

        for (const section of sections.slice(1)) {
            const m = section.match(MSG_HEADER);
            if (!m) {
                continue;
            }
            specs.set(m[1], EcovacsRosMessageDecoder.PARSE_SECTION(section.slice(m.index + m[0].length)));
        }

        return specs;
    }

    /**
     * Parses one `.msg` body. Constants (`NAME = value`) and comments are skipped.
     *
     * @param {string} text
     * @returns {Array<{name: string, type: string, array: number|null}>}
     */
    static PARSE_SECTION(text) {
        const fields = [];

        for (const rawLine of text.split("\n")) {
            const line = rawLine.split("#")[0].trim();
            if (!line) {
                continue;
            }
            const m = line.match(FIELD_LINE);
            if (!m || m[5] !== undefined) {
                continue;
            }
            fields.push({
                name: m[4],
                type: m[1],
                array: m[2] === undefined ? null : (m[3] === "" ? -1 : parseInt(m[3], 10))
            });
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

/**
 * @param {{buf: Buffer, off: number}} cursor
 * @returns {number}
 */
function readU32(cursor) {
    const v = cursor.buf.readUInt32LE(cursor.off);
    cursor.off += 4;
    return v;
}

const SECTION_SEPARATOR = /^=+\s*$/m;
const MSG_HEADER = /^MSG:\s*(\S+)\s*$/m;
// type, optional "[N]" (group 2) with N (group 3), name, optional "= constant" (group 5)
const FIELD_LINE = /^([\w/]+)(\[(\d*)\])?\s+(\w+)(?:\s*=(.*))?$/;

const BUILTIN = Object.freeze({
    bool: { size: 1, read: (b, o) => {
        return b.readUInt8(o) !== 0;
    }, write: (b, v) => {
        b.writeUInt8(v ? 1 : 0, 0);
    } },
    int8: { size: 1, read: (b, o) => {
        return b.readInt8(o);
    }, write: (b, v) => {
        b.writeInt8(v, 0);
    } },
    byte: { size: 1, read: (b, o) => {
        return b.readInt8(o);
    }, write: (b, v) => {
        b.writeInt8(v, 0);
    } },
    uint8: { size: 1, read: (b, o) => {
        return b.readUInt8(o);
    }, write: (b, v) => {
        b.writeUInt8(v, 0);
    } },
    char: { size: 1, read: (b, o) => {
        return b.readUInt8(o);
    }, write: (b, v) => {
        b.writeUInt8(v, 0);
    } },
    int16: { size: 2, read: (b, o) => {
        return b.readInt16LE(o);
    }, write: (b, v) => {
        b.writeInt16LE(v, 0);
    } },
    uint16: { size: 2, read: (b, o) => {
        return b.readUInt16LE(o);
    }, write: (b, v) => {
        b.writeUInt16LE(v, 0);
    } },
    int32: { size: 4, read: (b, o) => {
        return b.readInt32LE(o);
    }, write: (b, v) => {
        b.writeInt32LE(v, 0);
    } },
    uint32: { size: 4, read: (b, o) => {
        return b.readUInt32LE(o);
    }, write: (b, v) => {
        b.writeUInt32LE(v, 0);
    } },
    int64: { size: 8, read: (b, o) => {
        return Number(b.readBigInt64LE(o));
    }, write: (b, v) => {
        b.writeBigInt64LE(BigInt(v), 0);
    } },
    uint64: { size: 8, read: (b, o) => {
        return Number(b.readBigUInt64LE(o));
    }, write: (b, v) => {
        b.writeBigUInt64LE(BigInt(v), 0);
    } },
    float32: { size: 4, read: (b, o) => {
        return b.readFloatLE(o);
    }, write: (b, v) => {
        b.writeFloatLE(v, 0);
    } },
    float64: { size: 8, read: (b, o) => {
        return b.readDoubleLE(o);
    }, write: (b, v) => {
        b.writeDoubleLE(v, 0);
    } }
});

module.exports = EcovacsRosMessageDecoder;
