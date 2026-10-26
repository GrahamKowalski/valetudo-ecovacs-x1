const LZMA = require("lzma");
const { MapLayer, ValetudoMap } = require("../../entities/map");

/**
 * Parses an Ecovacs X1 map/CompressMap payload (as returned by the ROS services
 * GetCurrentCompressMap and ManipulateShowMap) into a ValetudoMap.
 *
 * Wire format (observed on the X1 Plus, zj2102-x3; see the research repo's map-format note):
 *   Response = uint8 result, then CompressMap:
 *     uint32  mapid
 *     MapMetaInfo info  = 7x uint16: mapWidth, mapHeight, cols, rows, submapWidth,
 *                         submapHeight, resolution (mm per cell)
 *     CompressSubMap[]  = uint32 count, then per submap:
 *                           uint16 submapid, uint32 crc32, uint32 length,
 *                           int8[] data (uint32 len, then that many bytes)
 *   Each submap's data is an LZMA1 "alone" stream with an Ecovacs truncated 8-byte header
 *   (reinsert four zero bytes after byte 8). It decompresses to submapWidth*submapHeight
 *   bytes, one byte per cell. Submaps tile the full grid in row-major order.
 *
 * Cell values (observed): 0 unexplored, 2 wall, 5 obstacle, 4 floor not yet assigned to a
 * room, 101..109 floor segmented into rooms.
 */
class EcovacsMapParser {
    /**
     * @param {Buffer} payload a GetCurrentCompressMap/ManipulateShowMap response payload
     * @returns {Promise<import("../../entities/map/ValetudoMap")|null>}
     */
    static async PARSE(payload) {
        if (!Buffer.isBuffer(payload) || payload.length < MIN_HEADER) {
            return null;
        }

        let off = 1; // skip uint8 result
        off += 4; // skip uint32 mapid

        const mapWidth = payload.readUInt16LE(off); off += 2;
        const mapHeight = payload.readUInt16LE(off); off += 2;
        const cols = payload.readUInt16LE(off); off += 2;
        const rows = payload.readUInt16LE(off); off += 2;
        const submapWidth = payload.readUInt16LE(off); off += 2;
        const submapHeight = payload.readUInt16LE(off); off += 2;
        const resolutionMm = payload.readUInt16LE(off); off += 2;

        if (!mapWidth || !mapHeight || !cols || !rows || !submapWidth || !submapHeight || !resolutionMm) {
            return null;
        }

        const submapCount = payload.readUInt32LE(off); off += 4;
        const grid = Buffer.alloc(mapWidth * mapHeight); // zero-filled background

        for (let i = 0; i < submapCount; i++) {
            if (off + 14 > payload.length) {
                break;
            }
            off += 2; // uint16 submapid (a content/version id, not position)
            off += 4; // uint32 crc32
            off += 4; // uint32 length
            const dataLen = payload.readUInt32LE(off); off += 4;
            const data = payload.subarray(off, off + dataLen); off += dataLen;

            const tile = await EcovacsMapParser.DECOMPRESS(data);
            // Submaps tile the grid in row-major order
            const col = i % cols;
            const row = Math.floor(i / cols);
            EcovacsMapParser.BLIT(grid, mapWidth, mapHeight, tile, submapWidth, submapHeight, col * submapWidth, row * submapHeight);
        }

        return EcovacsMapParser.BUILD_MAP(grid, mapWidth, mapHeight, resolutionMm);
    }

    /**
     * Reconstructs the standard .lzma "alone" stream from Ecovacs' truncated header and
     * decompresses it.
     *
     * @param {Buffer} blob
     * @returns {Promise<Buffer>}
     */
    static DECOMPRESS(blob) {
        const stream = Buffer.concat([blob.subarray(0, 8), Buffer.from([0, 0, 0, 0]), blob.subarray(8)]);

        return new Promise((resolve, reject) => {
            LZMA.decompress(new Uint8Array(stream), (result, err) => {
                if (err) {
                    return reject(err);
                }
                resolve(Buffer.from(result));
            });
        });
    }

    /**
     * Copies a submap tile into the full grid at (dstX, dstY).
     *
     * @private
     */
    static BLIT(grid, gridWidth, gridHeight, tile, tileWidth, tileHeight, dstX, dstY) {
        for (let ty = 0; ty < tileHeight; ty++) {
            const gy = dstY + ty;
            if (gy >= gridHeight) {
                break;
            }
            const srcStart = ty * tileWidth;
            if (srcStart + tileWidth > tile.length) {
                break;
            }
            tile.copy(grid, gy * gridWidth + dstX, srcStart, srcStart + tileWidth);
        }
    }

    /**
     * @param {Buffer} grid width*height bytes, one per cell
     * @param {number} width
     * @param {number} height
     * @param {number} resolutionMm
     * @returns {import("../../entities/map/ValetudoMap")|null}
     */
    static BUILD_MAP(grid, width, height, resolutionMm) {
        const floor = [];
        const wall = [];
        /** @type {Object<number, Array<number>>} */
        const segments = {};

        for (let i = 0; i < width * height; i++) {
            const v = grid[i];
            if (v === 0) {
                continue;
            }
            const x = i % width;
            const y = Math.floor(i / width);

            if (v === CELL.WALL || v === CELL.OBSTACLE) {
                wall.push(x, y);
            } else if (v >= CELL.SEGMENT_MIN && v <= CELL.SEGMENT_MAX) {
                floor.push(x, y);
                (segments[v] ??= []).push(x, y);
            } else if (v === CELL.FLOOR_UNSEGMENTED) {
                floor.push(x, y);
            }
            // other values are currently unclassified and skipped
        }

        const layers = [];
        if (floor.length > 0) {
            layers.push(new MapLayer({ type: MapLayer.TYPE.FLOOR, pixels: floor }));
        }
        if (wall.length > 0) {
            layers.push(new MapLayer({ type: MapLayer.TYPE.WALL, pixels: wall }));
        }
        for (const [value, pixels] of Object.entries(segments)) {
            layers.push(new MapLayer({
                type: MapLayer.TYPE.SEGMENT,
                pixels: pixels,
                metaData: {
                    segmentId: value,
                    active: false
                }
            }));
        }

        if (layers.length === 0) {
            return null; // empty map (e.g. a freshly reset grid)
        }

        // Valetudo coordinates are in cm; the robot reports the resolution in mm.
        const pixelSize = Math.round(resolutionMm / 10);

        return new ValetudoMap({
            size: {
                x: width * pixelSize,
                y: height * pixelSize
            },
            pixelSize: pixelSize,
            layers: layers,
            entities: [] // robot/charger pose not present in this payload; added once captured
        });
    }
}

const MIN_HEADER = 23; // result + mapid + 7x uint16 + submap count
const CELL = Object.freeze({
    WALL: 2,
    OBSTACLE: 5,
    FLOOR_UNSEGMENTED: 4,
    SEGMENT_MIN: 101,
    SEGMENT_MAX: 109
});

module.exports = EcovacsMapParser;
