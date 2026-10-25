const NotImplementedError = require("../../core/NotImplementedError");

/**
 * Turns X1 map payloads into a ValetudoMap.
 *
 * Not implemented yet: the map payload format is unknown until it has been captured from the real device.
 * Start by adding a redacted capture to test/lib/robots/ecovacs/res/map/ (see the README there),
 * then implement against that fixture. Other clients' source is fine for orientation, not as the spec.
 */
class EcovacsMapParser {
    /**
     * Will return a ValetudoMap, or null if the entries don't contain a usable map
     *
     * @param {Array<object>} entries the EcocloudRecorder entries that together make up one map
     */
    static PARSE(entries) {
        throw new NotImplementedError("EcovacsMapParser: no captured X1 map payload to implement against yet");
    }
}

module.exports = EcovacsMapParser;
