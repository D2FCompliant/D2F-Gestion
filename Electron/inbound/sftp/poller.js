"use strict";

const SftpClient = require("ssh2-sftp-client");
const path = require("path");

async function pollSftpOnce({
  host,
  port = 22,
  username,
  password,
  privateKey,
  remoteInbox = "/inbox",
  remoteProcessed = "/processed",
  fileGlob = /\.xml$/i,
  maxFiles = 50,
  sourceName = "PDP-SFTP",
  onFile, // async ({ filename, contentType, payload, meta }) => {}
}) {
  const sftp = new SftpClient();

  try {
    await sftp.connect({
      host,
      port,
      username,
      ...(privateKey ? { privateKey } : {}),
      ...(password ? { password } : {}),
      readyTimeout: 20000,
    });

    const list = await sftp.list(remoteInbox);
    const xmls = list
      .filter((f) => f.type === "-" && fileGlob.test(f.name))
      .slice(0, maxFiles);

    for (const f of xmls) {
      const remotePath = path.posix.join(remoteInbox, f.name);
      const payload = await sftp.get(remotePath); // Buffer
      const meta = { sftp: { remotePath, size: f.size, modifyTime: f.modifyTime }, sourceName };

      await onFile({
        filename: f.name,
        contentType: "application/xml",
        payload,
        meta,
      });

      // move to processed (most common)
      const processedPath = path.posix.join(remoteProcessed, f.name);
      try {
        await sftp.rename(remotePath, processedPath);
      } catch (e) {
        // fallback: if rename across devices fails, copy + delete
        try {
          await sftp.put(payload, processedPath);
          await sftp.delete(remotePath);
        } catch (e2) {
          // if ack fails, we don't want to re-download infinitely:
          // you can choose to keep as-is; here we throw so caller logs it.
          throw new Error(`SFTP ack(move) failed for ${f.name}: ${e2.message || e2}`);
        }
      }
    }

    return { ok: true, count: xmls.length };
  } finally {
    try { await sftp.end(); } catch {}
  }
}

module.exports = { pollSftpOnce };
