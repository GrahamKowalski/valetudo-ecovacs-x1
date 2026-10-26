/**
 * Reassembles u32-length-prefixed frames from a byte stream.
 */
class EcovacsTcpRosFramer {
    /**
     * @param {(frame: Buffer) => void} onFrame
     */
    constructor(onFrame) {
        this.onFrame = onFrame;
        this.pending = Buffer.alloc(0);
    }

    /**
     * @param {Buffer} chunk
     */
    push(chunk) {
        this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
        while (this.pending.length >= 4) {
            const len = this.pending.readUInt32LE(0);
            if (this.pending.length < 4 + len) {
                return;
            }
            const frame = this.pending.subarray(4, 4 + len);
            this.pending = this.pending.subarray(4 + len);
            this.onFrame(frame);
        }
    }
}

module.exports = EcovacsTcpRosFramer;
