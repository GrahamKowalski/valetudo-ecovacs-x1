const LZMA = require("lzma");
const { LineMapEntity, MapLayer, PointMapEntity, PolygonMapEntity, ValetudoMap } = require("../../entities/map");

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
     * @param {object} [poses] optional world poses to add as map entities
     * @param {{x: number, y: number, theta: number}} [poses.robot] robot pose (mm, rad)
     * @param {{x: number, y: number, theta: number}} [poses.charger] charger pose (mm, rad)
     * @param {Array<{type: number, dots: Array<{x: number, y: number}>}>} [walls] virtual walls (world mm)
     * @returns {Promise<import("../../entities/map/ValetudoMap")|null>}
     */
    static async PARSE(payload, poses, walls) {
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

        return EcovacsMapParser.BUILD_MAP(grid, mapWidth, mapHeight, resolutionMm, poses, walls);
    }

    /**
     * Decodes a /map/ManipulateVirtualWall response body into virtual walls. Layout:
     * uint8 result, uint32 mapid, VirtualWall[] (uint32 count, then per wall: uint32 vwid,
     * uint8 type, Dot[] = uint32 count + float32 x,y pairs). Dots are world-frame mm.
     *
     * @param {Buffer} buf
     * @returns {Array<{vwid: number, type: number, dots: Array<{x: number, y: number}>}>}
     */
    static PARSE_VIRTUAL_WALLS(buf) {
        if (!Buffer.isBuffer(buf) || buf.length < 9) {
            return [];
        }

        try {
            let off = 1; // skip uint8 result
            off += 4;    // skip uint32 mapid
            const count = buf.readUInt32LE(off); off += 4;
            const walls = [];

            for (let i = 0; i < count; i++) {
                const vwid = buf.readUInt32LE(off); off += 4;
                const type = buf.readUInt8(off); off += 1;
                const dotCount = buf.readUInt32LE(off); off += 4;
                const dots = [];
                for (let j = 0; j < dotCount; j++) {
                    const x = buf.readFloatLE(off); off += 4;
                    const y = buf.readFloatLE(off); off += 4;
                    dots.push({ x: x, y: y });
                }
                walls.push({ vwid: vwid, type: type, dots: dots });
            }

            return walls;
        } catch {
            return [];
        }
    }

    /**
     * Converts a world pose (mm, rad; dock at origin) to a Valetudo PointMapEntity.
     *
     * The CompressMap is the center window of the SLAM grid, so world (0,0) is the grid
     * center. No y-flip (world +y maps to grid +y, i.e. downward). Heading theta=0 points
     * down (grid +y); Valetudo's angle is degrees with 0 = up, so down = 180.
     *
     * @param {string} type PointMapEntity.TYPE value
     * @param {{x: number, y: number, theta: number}} pose world pose in mm and radians
     * @param {number} width grid width in cells
     * @param {number} height grid height in cells
     * @param {number} resolutionMm mm per cell
     * @param {number} pixelSize Valetudo pixel size in cm
     * @returns {import("../../entities/map/entities/PointMapEntity")}
     */
    static POSE_TO_ENTITY(type, pose, width, height, resolutionMm, pixelSize) {
        const px = width / 2 + pose.x / resolutionMm;
        const py = height / 2 + pose.y / resolutionMm;
        const entity = {
            type: type,
            points: [Math.round(px * pixelSize), Math.round(py * pixelSize)]
        };
        if (type === PointMapEntity.TYPE.ROBOT_POSITION) {
            entity.metaData = {
                angle: ((Math.round(180 + pose.theta * 180 / Math.PI)) % 360 + 360) % 360
            };
        }
        return new PointMapEntity(entity);
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
     * @param {Buffer} grid
     * @param {number} gridWidth
     * @param {number} gridHeight
     * @param {Buffer} tile
     * @param {number} tileWidth
     * @param {number} tileHeight
     * @param {number} dstX
     * @param {number} dstY
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
     * @param {object} [poses]
     * @param {Array<{type: number, dots: Array<{x: number, y: number}>}>} [walls]
     * @returns {import("../../entities/map/ValetudoMap")|null}
     */
    static BUILD_MAP(grid, width, height, resolutionMm, poses, walls) {
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

        // Robot/charger poses come from separate feeds (/robot/Robot, /map/ChargerDockInfo),
        // not from the map payload, so they are passed in when available.
        const entities = [];
        if (poses?.charger) {
            entities.push(EcovacsMapParser.POSE_TO_ENTITY(PointMapEntity.TYPE.CHARGER_LOCATION, poses.charger, width, height, resolutionMm, pixelSize));
        }
        if (poses?.robot) {
            entities.push(EcovacsMapParser.POSE_TO_ENTITY(PointMapEntity.TYPE.ROBOT_POSITION, poses.robot, width, height, resolutionMm, pixelSize));
        }

        // Virtual walls and no-go zones (from /map/ManipulateVirtualWall). Each is a list of
        // world-mm dots; two dots are a line wall, more are a closed no-go polygon.
        for (const wall of (Array.isArray(walls) ? walls : [])) {
            if (!wall || !Array.isArray(wall.dots) || wall.dots.length < 2) {
                continue;
            }
            const points = [];
            for (const dot of wall.dots) {
                const px = width / 2 + dot.x / resolutionMm;
                const py = height / 2 + dot.y / resolutionMm;
                points.push(Math.round(px * pixelSize), Math.round(py * pixelSize));
            }
            if (wall.dots.length === 2) {
                entities.push(new LineMapEntity({ type: LineMapEntity.TYPE.VIRTUAL_WALL, points: points }));
            } else {
                entities.push(new PolygonMapEntity({ type: PolygonMapEntity.TYPE.NO_GO_AREA, points: points }));
            }
        }

        return new ValetudoMap({
            size: {
                x: width * pixelSize,
                y: height * pixelSize
            },
            pixelSize: pixelSize,
            layers: layers,
            entities: entities
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
