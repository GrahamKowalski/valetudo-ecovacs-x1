const http = require("http");

/**
 * Minimal XML-RPC client for the ROS master and slave APIs.
 *
 * ROS only needs a handful of value types (int, string, arrays of those, and the
 * occasional boolean/double), so this implements exactly those with no dependency.
 * Every ROS API call returns [code, statusMessage, value].
 */
class EcovacsRosXmlRpcClient {
    /**
     * @param {string} uri e.g. "http://127.0.0.1:11311"
     */
    constructor(uri) {
        this.uri = new URL(uri);
    }

    /**
     * @param {string} method
     * @param {Array<any>} params
     * @param {number} [timeoutMs]
     * @returns {Promise<any>} the decoded <methodResponse> value
     */
    call(method, params, timeoutMs = 5000) {
        const body = EcovacsRosXmlRpcClient.ENCODE_CALL(method, params);

        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: this.uri.hostname,
                port: this.uri.port,
                path: this.uri.pathname || "/",
                method: "POST",
                headers: {
                    "Content-Type": "text/xml",
                    "Content-Length": Buffer.byteLength(body)
                },
                timeout: timeoutMs
            }, res => {
                const chunks = [];
                res.on("data", c => {
                    chunks.push(c);
                });
                res.on("end", () => {
                    try {
                        resolve(EcovacsRosXmlRpcClient.DECODE_RESPONSE(Buffer.concat(chunks).toString("utf8")));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on("timeout", () => {
                req.destroy(new Error(`XML-RPC ${method} timed out`));
            });
            req.on("error", reject);
            req.end(body);
        });
    }

    /**
     * @param {string} method
     * @param {Array<any>} params
     * @returns {string}
     */
    static ENCODE_CALL(method, params) {
        return "<?xml version=\"1.0\"?><methodCall><methodName>" + escapeXml(method) + "</methodName><params>" +
            params.map(p => {
                return "<param>" + encodeValue(p) + "</param>";
            }).join("") +
            "</params></methodCall>";
    }

    /**
     * @param {string} xml
     * @returns {any}
     */
    static DECODE_RESPONSE(xml) {
        const fault = xml.match(/<fault>([\s\S]*?)<\/fault>/);
        if (fault) {
            throw new Error(`XML-RPC fault: ${fault[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`);
        }
        const m = xml.match(/<params>\s*<param>([\s\S]*?)<\/param>\s*<\/params>/);
        if (!m) {
            throw new Error("XML-RPC response has no params");
        }
        const tokens = tokenize(m[1]);
        let pos = 0;
        const value = parseValue();

        return value;

        function parseValue() {
            expect("value");
            const t = tokens[pos];
            let v;
            if (t.type === "close" && t.name === "value") {
                // <value></value> or <value/> is an empty string
                v = "";
            } else if (t.type === "text") {
                // untyped <value>text</value> is a string
                v = t.text;
                pos++;
            } else if (t.type === "open" && t.name === "array") {
                pos++;
                expect("data");
                v = [];
                while (!(tokens[pos].type === "close" && tokens[pos].name === "data")) {
                    v.push(parseValue());
                }
                pos++; // </data>
                expectClose("array");
            } else if (t.type === "open") {
                pos++;
                const text = tokens[pos].type === "text" ? tokens[pos++].text : "";
                expectClose(t.name);
                switch (t.name) {
                    case "int":
                    case "i4":
                        v = parseInt(text, 10);
                        break;
                    case "boolean":
                        v = text.trim() === "1";
                        break;
                    case "double":
                        v = parseFloat(text);
                        break;
                    default:
                        v = text;
                }
            } else {
                throw new Error(`Unexpected XML-RPC token ${JSON.stringify(t)}`);
            }
            expectClose("value");

            return v;
        }
        function expect(name) {
            const t = tokens[pos++];
            if (!t || t.type !== "open" || t.name !== name) {
                throw new Error(`Expected <${name}>, got ${JSON.stringify(t)}`);
            }
        }
        function expectClose(name) {
            const t = tokens[pos++];
            if (!t || t.type !== "close" || t.name !== name) {
                throw new Error(`Expected </${name}>, got ${JSON.stringify(t)}`);
            }
        }
    }
}

/**
 * @param {any} v
 * @returns {string}
 */
function encodeValue(v) {
    if (Array.isArray(v)) {
        return "<value><array><data>" + v.map(encodeValue).join("") + "</data></array></value>";
    }
    if (typeof v === "number") {
        return Number.isInteger(v) ? `<value><int>${v}</int></value>` : `<value><double>${v}</double></value>`;
    }
    if (typeof v === "boolean") {
        return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
    }

    return "<value><string>" + escapeXml(String(v)) + "</string></value>";
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeXml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * @param {string} s
 * @returns {string}
 */
function unescapeXml(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/**
 * Splits XML into open/close/text tokens. Whitespace-only text between tags is dropped,
 * self-closing tags become open + close.
 *
 * @param {string} xml
 * @returns {Array<{type: string, name?: string, text?: string}>}
 */
function tokenize(xml) {
    const tokens = [];
    const re = /<\/?([a-zA-Z0-9]+)\s*\/?>|([^<]+)/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        if (m[1] !== undefined) {
            const raw = m[0];
            if (raw.startsWith("</")) {
                tokens.push({ type: "close", name: m[1] });
            } else if (raw.endsWith("/>")) {
                tokens.push({ type: "open", name: m[1] });
                tokens.push({ type: "close", name: m[1] });
            } else {
                tokens.push({ type: "open", name: m[1] });
            }
        } else if (m[2].trim() !== "") {
            tokens.push({ type: "text", text: unescapeXml(m[2]) });
        }
    }

    return tokens;
}

module.exports = EcovacsRosXmlRpcClient;
