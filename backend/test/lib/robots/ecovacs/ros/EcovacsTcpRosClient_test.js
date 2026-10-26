const assert = require("node:assert");
const http = require("node:http");
const net = require("node:net");
const { after, before, describe, it } = require("node:test");

const EcovacsTcpRosClient = require("../../../../../lib/robots/ecovacs/ros/EcovacsTcpRosClient");
const EcovacsTcpRosFramer = require("../../../../../lib/robots/ecovacs/ros/EcovacsTcpRosFramer");

// A tiny fake ROS graph: one XML-RPC "master" that also answers the slave API for the
// single publisher node, one TCPROS publisher for /demo/Topic, one TCPROS service.

/**
 * @param {number} n
 * @returns {Buffer}
 */
function u32(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
}
function frame(buf) {
    return Buffer.concat([u32(buf.length), buf]);
}
function xmlArray(items) {
    return "<value><array><data>" + items.join("") + "</data></array></value>";
}
function xmlStr(s) {
    return `<value><string>${s}</string></value>`;
}
function xmlInt(n) {
    return `<value><int>${n}</int></value>`;
}
function response(valueXml) {
    return `<methodResponse><params><param>${valueXml}</param></params></methodResponse>`;
}

describe("EcovacsTcpRosClient", () => {
    let master;
    let publisher;
    let service;
    let masterPort;
    let publisherPort;
    let servicePort;
    const published = [Buffer.from("first"), Buffer.from("second message")];
    let lastServiceHeader;
    let lastServiceRequest;

    before(async () => {
        publisher = net.createServer(socket => {
            let gotHeader = false;
            socket.on("data", () => {
                if (gotHeader) {
                    return;
                }
                gotHeader = true;
                socket.write(EcovacsTcpRosClient.ENCODE_HEADER({
                    callerid: "/node",
                    type: "demo/Topic",
                    md5sum: "abc",
                    message_definition: "uint8 a\nstring b\n",
                    latching: "0"
                }));
                // deliberately split one message across two writes
                socket.write(frame(published[0]));
                const second = frame(published[1]);
                socket.write(second.subarray(0, 7));
                setTimeout(() => {
                    socket.write(second.subarray(7));
                }, 10);
            });
        });
        service = net.createServer(socket => {
            let stage = 0;
            let pending = Buffer.alloc(0);
            socket.on("data", chunk => {
                pending = Buffer.concat([pending, chunk]);
                while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32LE(0)) {
                    const body = pending.subarray(4, 4 + pending.readUInt32LE(0));
                    pending = pending.subarray(4 + body.length);
                    if (stage === 0) {
                        stage = 1;
                        lastServiceHeader = EcovacsTcpRosClient.DECODE_HEADER(body);
                        if (lastServiceHeader.md5sum === "wrong") {
                            socket.end(EcovacsTcpRosClient.ENCODE_HEADER({ error: "client wants service /demo/Srv to have md5sum wrong, but it has right" }));
                            return;
                        }
                        socket.write(EcovacsTcpRosClient.ENCODE_HEADER({ callerid: "/node", type: "demo/Srv", request_type: "demo/SrvRequest", response_type: "demo/SrvResponse" }));
                    } else {
                        lastServiceRequest = body;
                        if (body[0] === 0xff) {
                            socket.end(Buffer.concat([Buffer.from([0]), frame(Buffer.from("boom"))]));
                        } else {
                            socket.end(Buffer.concat([Buffer.from([1]), frame(Buffer.from([body[0] + 1]))]));
                        }
                    }
                }
            });
        });
        await new Promise(resolve => {
            publisher.listen(0, "127.0.0.1", resolve);
        });
        await new Promise(resolve => {
            service.listen(0, "127.0.0.1", resolve);
        });
        publisherPort = publisher.address().port;
        servicePort = service.address().port;

        master = http.createServer((req, res) => {
            const chunks = [];
            req.on("data", c => {
                chunks.push(c);
            });
            req.on("end", () => {
                const body = Buffer.concat(chunks).toString();
                const method = body.match(/<methodName>(\w+)<\/methodName>/)[1];
                let out;
                switch (method) {
                    case "getSystemState":
                        out = xmlArray([xmlInt(1), xmlStr("ok"), xmlArray([
                            xmlArray([xmlArray([xmlStr("/demo/Topic"), xmlArray([xmlStr("/node")])])]),
                            xmlArray([]),
                            xmlArray([xmlArray([xmlStr("/demo/Srv"), xmlArray([xmlStr("/node")])])])
                        ])]);
                        break;
                    case "getTopicTypes":
                        out = xmlArray([xmlInt(1), xmlStr("ok"), xmlArray([xmlArray([xmlStr("/demo/Topic"), xmlStr("demo/Topic")])])]);
                        break;
                    case "lookupNode":
                        out = xmlArray([xmlInt(1), xmlStr("ok"), xmlStr(`http://127.0.0.1:${masterPort}/`)]);
                        break;
                    case "requestTopic":
                        out = xmlArray([xmlInt(1), xmlStr("ok"), xmlArray([xmlStr("TCPROS"), xmlStr("127.0.0.1"), xmlInt(publisherPort)])]);
                        break;
                    case "lookupService":
                        out = xmlArray([xmlInt(1), xmlStr("ok"), xmlStr(`rosrpc://127.0.0.1:${servicePort}`)]);
                        break;
                    default:
                        out = xmlArray([xmlInt(-1), xmlStr(`unknown ${method}`), xmlInt(0)]);
                }
                res.setHeader("Content-Type", "text/xml");
                res.end(response(out));
            });
        });
        await new Promise(resolve => {
            master.listen(0, "127.0.0.1", resolve);
        });
        masterPort = master.address().port;
    });

    after(() => {
        master.close();
        publisher.close();
        service.close();
    });

    it("reassembles length-prefixed frames across chunk boundaries", () => {
        const frames = [];
        const framer = new EcovacsTcpRosFramer(f => {
            frames.push(f.toString());
        });
        const stream = Buffer.concat([frame(Buffer.from("ab")), frame(Buffer.from("cde")), frame(Buffer.alloc(0))]);
        framer.push(stream.subarray(0, 5));
        framer.push(stream.subarray(5, 9));
        framer.push(stream.subarray(9));

        assert.deepStrictEqual(frames, ["ab", "cde", ""]);
    });

    it("round-trips headers", () => {
        const h = { callerid: "/x", topic: "/t", md5sum: "*", "with=equals": "a=b" };
        const decoded = EcovacsTcpRosClient.DECODE_HEADER(EcovacsTcpRosClient.ENCODE_HEADER(h).subarray(4));

        assert.deepStrictEqual(decoded, { callerid: "/x", topic: "/t", md5sum: "*", with: "equals=a=b" });
    });

    it("subscribes: resolves the publisher, exchanges headers and delivers messages", async () => {
        const client = new EcovacsTcpRosClient({ masterUri: `http://127.0.0.1:${masterPort}`, callerId: "/test" });
        const headers = [];
        const messages = [];
        const errors = [];
        const sub = client.subscribe("/demo/Topic", {
            onHeader: h => {
                headers.push(h);
            },
            onMessage: m => {
                messages.push(m.toString());
            },
            onError: e => {
                errors.push(e);
            }
        });
        await new Promise(resolve => {
            setTimeout(resolve, 150);
        });
        sub.close();

        assert.deepStrictEqual(errors, []);
        assert.strictEqual(headers.length, 1);
        assert.strictEqual(headers[0].type, "demo/Topic");
        assert.strictEqual(headers[0].message_definition, "uint8 a\nstring b\n");
        assert.deepStrictEqual(messages, ["first", "second message"]);
    });

    it("reports an error and keeps retrying when the topic has no publisher", async () => {
        const client = new EcovacsTcpRosClient({ masterUri: `http://127.0.0.1:${masterPort}` });
        const errors = [];
        const sub = client.subscribe("/demo/Missing", {
            onMessage: () => {},
            onError: e => {
                errors.push(e.message);
            }
        });
        await new Promise(resolve => {
            setTimeout(resolve, 100);
        });
        sub.close();

        assert.deepStrictEqual(errors, ["No publisher for /demo/Missing"]);
    });

    it("calls a service and returns the response body", async () => {
        const client = new EcovacsTcpRosClient({ masterUri: `http://127.0.0.1:${masterPort}`, callerId: "/test" });
        const res = await client.callService("/demo/Srv", Buffer.from([41]), { md5sum: "right" });

        assert.deepStrictEqual([...res], [42]);
        assert.deepStrictEqual([...lastServiceRequest], [41]);
        assert.strictEqual(lastServiceHeader.service, "/demo/Srv");
        assert.strictEqual(lastServiceHeader.md5sum, "right");
    });

    it("rejects with the server's error text when the service fails", async () => {
        const client = new EcovacsTcpRosClient({ masterUri: `http://127.0.0.1:${masterPort}` });

        await assert.rejects(client.callService("/demo/Srv", Buffer.from([0xff])), /Service \/demo\/Srv error: boom/);
    });

    it("rejects when the server refuses the md5sum", async () => {
        const client = new EcovacsTcpRosClient({ masterUri: `http://127.0.0.1:${masterPort}` });

        await assert.rejects(client.callService("/demo/Srv", Buffer.from([1]), { md5sum: "wrong" }), /refused: client wants service/);
    });
});
