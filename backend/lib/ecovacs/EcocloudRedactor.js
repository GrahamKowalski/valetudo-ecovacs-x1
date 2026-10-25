/**
 * Masks known device identifiers in strings and parsed payloads so that logs and captures can be shared.
 *
 * Only values it has been told about (plus anything shaped like a MAC address) are masked.
 * Payloads may contain identifiers nobody knows about yet, so captures still need a manual review before publishing.
 */
class EcocloudRedactor {
    /**
     * @param {object} options
     * @param {Object<string, string>} options.secrets map of placeholder name to secret value, e.g. {deviceId: "..."}
     */
    constructor(options) {
        this.rules = Object.entries(options.secrets ?? {})
            .filter(([, value]) => {
                return typeof value === "string" && value.length >= MIN_SECRET_LENGTH;
            })
            // Replace longer values first so that a secret containing another one is masked as a whole
            .sort(([, a], [, b]) => {
                return b.length - a.length;
            })
            .map(([name, value]) => {
                return {
                    // Only match whole tokens so that short secrets don't mangle e.g. base64 map data
                    regex: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(value)}(?![A-Za-z0-9])`, "g"),
                    placeholder: `<${name}>`
                };
            });
    }

    /**
     * @param {string} str
     * @returns {string}
     */
    redactString(str) {
        let result = str;

        for (const rule of this.rules) {
            result = result.replace(rule.regex, rule.placeholder);
        }

        return result.replace(MAC_ADDRESS_REGEX, "<mac>");
    }

    /**
     * Deep-redacts strings in objects and arrays. Object keys are left untouched.
     *
     * @param {any} value
     * @returns {any}
     */
    redact(value) {
        if (typeof value === "string") {
            return this.redactString(value);
        } else if (Array.isArray(value)) {
            return value.map(v => {
                return this.redact(v);
            });
        } else if (value !== null && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([k, v]) => {
                return [k, this.redact(v)];
            }));
        } else {
            return value;
        }
    }
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MIN_SECRET_LENGTH = 4;
const MAC_ADDRESS_REGEX = /(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f])/g;

module.exports = EcocloudRedactor;
