/* selfcert.js - a throw-away self-signed TLS certificate, made in pure Node (no openssl, no dependency).
 *
 * perf.js serves the page and the stand-ins for its third-party hosts over HTTPS + HTTP/2, the way a real host does, and Chromium is told to
 * ignore certificate errors for that run. Node's crypto can generate a key pair and sign, but it cannot build an X.509 certificate, so this
 * writes the few DER structures a certificate needs (ECDSA P-256, one SAN extension). The certificate lives only in memory for the length
 * of one run and is valid for a week; nothing about it is trusted by anything but the browser that perf.js starts with
 * --ignore-certificate-errors. Not for any other use.
 */
'use strict';
const crypto = require('crypto');

const len = n => {
  if (n < 128) return Buffer.from([n]);
  const b = [];
  for (; n > 0; n = Math.floor(n / 256)) b.unshift(n & 255);
  return Buffer.from([0x80 | b.length].concat(b));
};
const der = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const SEQ = (...p) => der(0x30, ...p), SET = (...p) => der(0x31, ...p);
const oid = s => {
  const a = s.split('.').map(Number);
  const out = [a[0] * 40 + a[1]];
  for (const v of a.slice(2)) {
    const chunk = [v & 127];
    for (let x = Math.floor(v / 128); x > 0; x = Math.floor(x / 128)) chunk.unshift((x & 127) | 128);
    out.push(...chunk);
  }
  return der(0x06, Buffer.from(out));
};
const utcTime = d => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z', 'ascii'));
const name = cn => SEQ(SET(SEQ(oid('2.5.4.3'), der(0x0c, Buffer.from(cn, 'utf8')))));
const pem = (label, buf) => '-----BEGIN ' + label + '-----\n' + buf.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '') + '\n-----END ' + label + '-----\n';

/** { key, cert } as PEM strings, for tls / http2.createSecureServer. `hosts` go into the subject alternative names (DNS names, or dotted IPv4). */
function selfSigned(hosts) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const sigAlg = SEQ(oid('1.2.840.10045.4.3.2'));                       // ecdsa-with-SHA256
  const serial = crypto.randomBytes(16); serial[0] &= 0x7f; if (serial[0] === 0) serial[0] = 1;
  const now = Date.now();
  const san = SEQ(...hosts.map(h => /^\d+\.\d+\.\d+\.\d+$/.test(h) ? der(0x87, Buffer.from(h.split('.').map(Number))) : der(0x82, Buffer.from(h, 'ascii'))));
  const exts = SEQ(
    SEQ(oid('2.5.29.17'), der(0x04, san)),                              // subjectAltName
    SEQ(oid('2.5.29.19'), der(0x01, Buffer.from([0xff])), der(0x04, SEQ()))   // basicConstraints, critical, not a CA
  );
  const tbs = SEQ(
    der(0xa0, der(0x02, Buffer.from([2]))),                             // version 3
    der(0x02, serial), sigAlg, name('perf.local'),
    SEQ(utcTime(new Date(now - 86400e3)), utcTime(new Date(now + 7 * 86400e3))),
    name('perf.local'), publicKey.export({ type: 'spki', format: 'der' }),
    der(0xa3, exts)
  );
  const sig = crypto.sign('sha256', tbs, privateKey);                   // DER-encoded ECDSA signature
  const cert = SEQ(tbs, sigAlg, der(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const out = { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem('CERTIFICATE', cert) };
  /* A certificate Node itself cannot parse would fail later and far from here: say so now. */
  new crypto.X509Certificate(out.cert);
  return out;
}

module.exports = { selfSigned };
