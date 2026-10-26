const assert = require("node:assert");
const http = require("node:http");
const { after, before, describe, it } = require("node:test");

const EcovacsRosXmlRpcClient = require("../../../../../lib/robots/ecovacs/ros/EcovacsRosXmlRpcClient");

describe("EcovacsRosXmlRpcClient", () => {
    it("encodes a methodCall with strings, ints and nested arrays", () => {
        const xml = EcovacsRosXmlRpcClient.ENCODE_CALL("requestTopic", ["/valetudo", "/robot/Robot", [["TCPROS"]]]);

        assert.strictEqual(xml,
            "<?xml version=\"1.0\"?><methodCall><methodName>requestTopic</methodName><params>" +
            "<param><value><string>/valetudo</string></value></param>" +
            "<param><value><string>/robot/Robot</string></value></param>" +
            "<param><value><array><data><value><array><data><value><string>TCPROS</string></value></data></array></value></data></array></value></param>" +
            "</params></methodCall>");
    });

    it("decodes a ROS-style [code, status, value] response", () => {
        const xml = "<?xml version='1.0'?>\n<methodResponse>\n<params>\n<param>\n<value><array><data>\n" +
            "<value><int>1</int></value>\n<value><string>current state</string></value>\n" +
            "<value><array><data>\n<value><array><data>\n" +
            "<value><array><data><value><string>/robot/Robot</string></value><value><array><data><value><string>/node</string></value></data></array></value></data></array></value>\n" +
            "</data></array></value>\n<value><array><data></data></array></value>\n<value><array><data/></array></value>\n" +
            "</data></array></value>\n</data></array></value>\n</param>\n</params>\n</methodResponse>\n";

        const v = EcovacsRosXmlRpcClient.DECODE_RESPONSE(xml);

        assert.deepStrictEqual(v, [1, "current state", [[["/robot/Robot", ["/node"]]], [], []]]);
    });

    it("decodes untyped, boolean, double and escaped values", () => {
        const xml = "<methodResponse><params><param><value><array><data>" +
            "<value>plain &amp; text</value><value><boolean>1</boolean></value><value><double>2.5</double></value><value></value>" +
            "</data></array></value></param></params></methodResponse>";

        assert.deepStrictEqual(EcovacsRosXmlRpcClient.DECODE_RESPONSE(xml), ["plain & text", true, 2.5, ""]);
    });

    it("throws on a fault", () => {
        assert.throws(() => {
            EcovacsRosXmlRpcClient.DECODE_RESPONSE("<methodResponse><fault><value><string>nope</string></value></fault></methodResponse>");
        }, /XML-RPC fault: nope/);
    });

    describe("over HTTP", () => {
        let server;
        let port;
        let lastBody;

        before(async () => {
            server = http.createServer((req, res) => {
                const chunks = [];
                req.on("data", c => {
                    chunks.push(c);
                });
                req.on("end", () => {
                    lastBody = Buffer.concat(chunks).toString();
                    res.setHeader("Content-Type", "text/xml");
                    res.end("<methodResponse><params><param><value><array><data><value><int>1</int></value><value><string>ok</string></value><value><string>http://robot:4242/</string></value></data></array></value></param></params></methodResponse>");
                });
            });
            await new Promise(resolve => {
                server.listen(0, "127.0.0.1", resolve);
            });
            port = server.address().port;
        });

        after(() => {
            server.close();
        });

        it("posts the call and returns the decoded value", async () => {
            const client = new EcovacsRosXmlRpcClient(`http://127.0.0.1:${port}`);
            const v = await client.call("lookupNode", ["/valetudo", "/node"]);

            assert.deepStrictEqual(v, [1, "ok", "http://robot:4242/"]);
            assert.ok(lastBody.includes("<methodName>lookupNode</methodName>"));
        });

        it("rejects when the server is unreachable", async () => {
            const client = new EcovacsRosXmlRpcClient("http://127.0.0.1:1");
            await assert.rejects(client.call("getSystemState", ["/valetudo"], 500));
        });
    });
});
