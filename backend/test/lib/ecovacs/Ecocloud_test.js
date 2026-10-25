const assert = require("node:assert");
const crypto = require("crypto");
const forge = require("node-forge");
const fs = require("fs");
const mqtt = require("mqtt");
const os = require("os");
const path = require("path");
const { after, before, describe, it } = require("node:test");

const Ecocloud = require("../../../lib/ecovacs/Ecocloud");
const EcocloudRecorder = require("../../../lib/ecovacs/EcocloudRecorder");
const EcocloudRedactor = require("../../../lib/ecovacs/EcocloudRedactor");

/*
 * Loopback test of the Ecocloud plumbing against a fake robot.
 * Everything the fake robot sends is synthetic. Topic shapes follow the comments in Ecocloud.js,
 * which come from ValetudoEV and have not been verified against a real X1 by us.
 */

const DEVICE_ID = "abcdef12-3456-7890-abcd-ef1234567890";
const M_ID = "x1fake";
const RESOURCE_ID = "Rf4K";

function generateSelfSignedCert() {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const key = forge.pki.privateKeyFromPem(keyPem);
    const cert = forge.pki.createCertificate();

    cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date(Date.now() - 60000);
    cert.validity.notAfter = new Date(Date.now() + 3600000);
    cert.setSubject([{ name: "commonName", value: "localhost" }]);
    cert.setIssuer([{ name: "commonName", value: "localhost" }]);
    cert.sign(key, forge.md.sha256.create());

    return { key: keyPem, cert: forge.pki.certificateToPem(cert) };
}

describe("Ecocloud", () => {
    let captureDir;
    let ecocloud;
    let fakeRobot;
    const incoming = [];

    before(async () => {
        captureDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecocloud-test-"));
        const { key, cert } = generateSelfSignedCert();
        const redactor = new EcocloudRedactor({
            secrets: { deviceId: DEVICE_ID, mId: M_ID, resourceId: RESOURCE_ID }
        });

        ecocloud = new Ecocloud({
            deviceId: DEVICE_ID,
            mId: M_ID,
            resourceId: RESOURCE_ID,
            bindIP: "127.0.0.1",
            bindPort: 0,
            tlsKey: key,
            tlsCert: cert,
            timeout: 2000,
            redactor: redactor,
            recorder: new EcocloudRecorder({ directory: captureDir, redactor: redactor }),
            onConnected: () => {},
            onIncomingCloudMessage: (msg) => {
                incoming.push(msg);

                return true;
            }
        });

        await new Promise(resolve => {
            ecocloud.server.once("listening", resolve);
        });

        fakeRobot = await mqtt.connectAsync(`mqtts://127.0.0.1:${ecocloud.server.address().port}`, {
            clientId: `${DEVICE_ID}@fake`,
            rejectUnauthorized: false
        });

        // Answer every p2p request like the response shape documented in Ecocloud.js
        fakeRobot.on("message", (topic) => {
            const parts = topic.split("/");
            if (parts[parts.length - 3] !== "q") {
                // Our own responses (".../p/<msgId>/j") come back via the wildcard subscription
                return;
            }

            const cmd = parts[2];
            const msgId = parts[parts.length - 2];

            fakeRobot.publish(
                `iot/p2p/${cmd}/${DEVICE_ID}/${M_ID}/${RESOURCE_ID}/HelperMQClientId-awsna-sts-ngiot-mqsjmq-0/ecosys/1234/p/${msgId}/j`,
                JSON.stringify({ body: { data: { synthetic: true, echo: cmd } } })
            );
        });
        await fakeRobot.subscribeAsync("iot/p2p/#");
    });

    after(async () => {
        await fakeRobot?.endAsync();
        await ecocloud?.shutdown();
        fs.rmSync(captureDir, { recursive: true, force: true });
    });

    it("resolves p2p requests with the robot's response", async () => {
        const res = await ecocloud.send(Ecocloud.MESSAGE_TYPES.P2P, "getInfo", ["getBattery"]);

        assert.deepStrictEqual(res, { body: { data: { synthetic: true, echo: "getInfo" } } });
    });

    it("passes unsolicited messages on instead of dropping them", async () => {
        const topic = `iot/atr/onFakePush/${DEVICE_ID}/${M_ID}/${RESOURCE_ID}/j`;
        await fakeRobot.publishAsync(topic, JSON.stringify({ synthetic: true }));

        await new Promise(resolve => {
            setTimeout(resolve, 200);
        });

        assert.ok(incoming.some(msg => {
            return msg.topic === topic;
        }));
    });

    it("rejects unknown message types", async () => {
        await assert.rejects(ecocloud.send("nope", "getInfo"));
    });

    it("records both directions without leaking identifiers", async () => {
        await ecocloud.recorder.shutdown();
        ecocloud.recorder = undefined;

        const files = fs.readdirSync(captureDir);
        assert.strictEqual(files.length, 1);

        const raw = fs.readFileSync(path.join(captureDir, files[0]), "utf-8");
        const entries = raw.trim().split("\n").map(l => {
            return JSON.parse(l);
        });

        assert.ok(entries.some(e => {
            return e.dir === "out" && e.topic.includes("/<deviceId>/<mId>/<resourceId>/q/");
        }));
        assert.ok(entries.some(e => {
            return e.dir === "in" && e.payload.encoding === "json" && e.payload.data.body?.data?.synthetic === true;
        }));
        assert.ok(entries.some(e => {
            return e.dir === "event" && e.event === "subscribe";
        }));

        for (const secret of [DEVICE_ID, M_ID, RESOURCE_ID]) {
            assert.ok(!raw.includes(secret), "capture must not contain identifiers");
        }
    });
});
