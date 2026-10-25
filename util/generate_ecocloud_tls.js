/*
 * Generates a private CA and an Ecocloud server certificate signed by it for local development/capture.
 *
 *   node util/generate_ecocloud_tls.js [outDir] [hostname...]
 *
 * outDir defaults to ./local/ecocloud-tls (gitignored). Hostnames default to localhost.
 * Pass the hostname(s) the robot connects to once known from a capture; that is not established yet.
 *
 * ca.crt is what the robot needs to trust. ca.key and server.key are secrets and must never be committed.
 * Existing files are never overwritten.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const forge = require("node-forge");

const outDir = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "local", "ecocloud-tls"));
const hostnames = process.argv.length > 3 ? process.argv.slice(3) : ["localhost"];

function generateKeyPair() {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const key = forge.pki.privateKeyFromPem(keyPem);

    return { keyPem: keyPem, key: key, publicKey: forge.pki.setRsaPublicKey(key.n, key.e) };
}

function createCert(publicKey, subject, issuer, years, extensions) {
    const cert = forge.pki.createCertificate();

    cert.publicKey = publicKey;
    cert.serialNumber = "01" + crypto.randomBytes(19).toString("hex"); // rfc5280 4.1.2.2
    cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
    cert.validity.notAfter = new Date(new Date().setFullYear(new Date().getFullYear() + years));
    cert.setSubject(subject);
    cert.setIssuer(issuer);
    cert.setExtensions(extensions);

    return cert;
}

const files = ["ca.key", "ca.crt", "server.key", "server.crt"].map(f => path.join(outDir, f));
const existing = files.filter(f => fs.existsSync(f));
if (existing.length > 0) {
    console.error(`Refusing to overwrite existing files:\n  ${existing.join("\n  ")}`);
    process.exit(1);
}

const ca = generateKeyPair();
const caSubject = [{ name: "commonName", value: "Ecocloud Local Dev CA" }];
const caCert = createCert(ca.publicKey, caSubject, caSubject, 30, [
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" }
]);
caCert.sign(ca.key, forge.md.sha256.create());

const server = generateKeyPair();
const serverCert = createCert(server.publicKey, [{ name: "commonName", value: hostnames[0] }], caSubject, 30, [
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: hostnames.map(h => ({ type: 2, value: h })) }
]);
serverCert.sign(ca.key, forge.md.sha256.create());

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(files[0], ca.keyPem, { mode: 0o600 });
fs.writeFileSync(files[1], forge.pki.certificateToPem(caCert));
fs.writeFileSync(files[2], server.keyPem, { mode: 0o600 });
fs.writeFileSync(files[3], forge.pki.certificateToPem(serverCert));

console.log(`Wrote CA and server certificate for ${hostnames.join(", ")} to ${outDir}`);
