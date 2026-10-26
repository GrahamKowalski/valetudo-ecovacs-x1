/**
 * Parses an Ecovacs X1 /robot/Robot ROS message into plain state fields.
 *
 * Message layout (robot/Robot, observed on the X1 Plus):
 *   std_msgs/Header header
 *   prediction/PredictPose pose   (two prediction/Pose: predictPose, pose)
 *   power/Battery battery          (uint8 battery, uint8 isLowVoltageToPowerOff)
 *   power/ChargeState chargestate  (uint8 isOnCharger, uint8 chargeState)
 *   ... (motor currents, range detects, onOffInfo[], bump[], dirtbox, carpet,
 *        waterbox, ...) which sit after variable-length arrays and are not parsed yet
 *
 * prediction/Pose = std_msgs/Header header, float32 x, float32 y, float32 theta.
 * std_msgs/Header = uint32 seq, uint32 sec, uint32 nsec, string frame_id.
 *
 * Only the fixed-offset fields up to chargestate are decoded here; battery and charge
 * are what Valetudo needs first. Pose x,y are in mm (SLAM frame), theta in radians.
 */
class EcovacsRobotStateParser {
    /**
     * @param {Buffer} buf a /robot/Robot message body
     * @returns {{pose: {x: number, y: number, theta: number}, battery: number, lowVoltage: number, isOnCharger: number, chargeState: number}|null}
     */
    static PARSE(buf) {
        if (!Buffer.isBuffer(buf) || buf.length < MIN_LENGTH) {
            return null;
        }

        const cursor = { buf: buf, off: 0 };

        try {
            EcovacsRobotStateParser.SKIP_HEADER(cursor);                 // Robot.header
            EcovacsRobotStateParser.SKIP_HEADER(cursor); cursor.off += 12; // predictPose: header + 3x float32
            EcovacsRobotStateParser.SKIP_HEADER(cursor);                 // pose: header
            const x = buf.readFloatLE(cursor.off);
            const y = buf.readFloatLE(cursor.off + 4);
            const theta = buf.readFloatLE(cursor.off + 8);
            cursor.off += 12;

            const battery = buf.readUInt8(cursor.off);
            const lowVoltage = buf.readUInt8(cursor.off + 1);
            const isOnCharger = buf.readUInt8(cursor.off + 2);
            const chargeState = buf.readUInt8(cursor.off + 3);

            return {
                pose: { x: x, y: y, theta: theta },
                battery: battery,
                lowVoltage: lowVoltage,
                isOnCharger: isOnCharger,
                chargeState: chargeState
            };
        } catch {
            return null;
        }
    }

    /**
     * Advances the cursor past a std_msgs/Header (seq, sec, nsec, string frame_id).
     *
     * @private
     * @param {{buf: Buffer, off: number}} cursor
     */
    static SKIP_HEADER(cursor) {
        cursor.off += 12; // seq + sec + nsec
        const frameIdLen = cursor.buf.readUInt32LE(cursor.off);
        cursor.off += 4 + frameIdLen;
    }
}

const MIN_LENGTH = 16;

module.exports = EcovacsRobotStateParser;
