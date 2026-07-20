import { once } from "node:events";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export type SmtpConnectionConfiguration = {
  host: string;
  port: number;
  user: string;
  password: string;
};

type SmtpConfiguration = SmtpConnectionConfiguration & {
  senderEmail: string;
  senderName: string;
};

type SmtpMessage = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
};

function cleanHeader(value: string, max = 500) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function validEmail(value: string) {
  const email = cleanHeader(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function encodedHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(cleanHeader(value), "utf8").toString("base64")}?=`;
}

function wrappedBase64(value: string) {
  return Buffer.from(String(value || "").replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .match(/.{1,76}/g)?.join("\r\n") || "";
}

function timeout<T>(promise: Promise<T>, socket: TLSSocket, milliseconds = 15000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Délai SMTP dépassé"));
    }, milliseconds);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function smtpReader(socket: TLSSocket) {
  const iterator = socket[Symbol.asyncIterator]();
  let buffer = "";
  let responseLines: string[] = [];

  return async function readResponse() {
    for (;;) {
      const separator = buffer.indexOf("\r\n");
      if (separator >= 0) {
        const line = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        responseLines.push(line);
        const match = line.match(/^(\d{3})([ -])/);
        if (match?.[2] === " ") {
          const lines = responseLines;
          responseLines = [];
          return { code: Number(match[1]), lines };
        }
        continue;
      }
      const chunk = await iterator.next();
      if (chunk.done) throw new Error("Connexion SMTP fermée prématurément");
      buffer += Buffer.isBuffer(chunk.value) ? chunk.value.toString("utf8") : String(chunk.value);
    }
  };
}

async function writeLine(socket: TLSSocket, value: string) {
  if (!socket.write(`${value}\r\n`, "utf8")) await once(socket, "drain");
}

function assertResponse(response: { code: number; lines: string[] }, accepted: number[]) {
  if (accepted.includes(response.code)) return;
  const detail = response.lines.join(" ").replace(/\s+/g, " ").slice(0, 500);
  throw new Error(`SMTP ${response.code}: ${detail}`);
}

export function smtpConfiguration(): SmtpConfiguration | null {
  const host = String(process.env.D2F_SUPPORT_SMTP_HOST || "").trim();
  const port = Number(process.env.D2F_SUPPORT_SMTP_PORT || "465");
  const user = validEmail(String(process.env.D2F_SUPPORT_SMTP_USER || ""));
  const password = String(process.env.D2F_SUPPORT_SMTP_PASSWORD || "");
  const senderEmail = validEmail(String(process.env.D2F_SUPPORT_EMAIL || user));
  const senderName = cleanHeader(String(process.env.D2F_SUPPORT_SMTP_SENDER_NAME || "D2F Support"), 120);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !password || !senderEmail) return null;
  return { host, port, user, password, senderEmail, senderName };
}

function validatedSmtpConnection(input: SmtpConnectionConfiguration): SmtpConnectionConfiguration {
  const host = cleanHeader(input.host, 253).toLowerCase();
  const port = Number(input.port);
  const user = validEmail(input.user);
  const password = String(input.password || "");
  const publicHostname = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    && !/(?:^|\.)(?:localhost|local|internal|lan|home|invalid)$/.test(host);
  if (!publicHostname) throw new Error("Serveur SMTP public invalide");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port SMTP invalide");
  if (!user) throw new Error("Utilisateur SMTP invalide");
  if (!password || password.length > 2048) throw new Error("Mot de passe SMTP requis");
  return { host, port, user, password };
}

export async function testSmtpConnection(input: SmtpConnectionConfiguration) {
  const configuration = validatedSmtpConnection(input);
  const socket = tlsConnect({ host: configuration.host, port: configuration.port, servername: configuration.host, rejectUnauthorized: true });
  socket.setNoDelay(true);
  const readResponse = smtpReader(socket);
  try {
    await timeout(Promise.race([
      once(socket, "secureConnect").then(() => undefined),
      once(socket, "error").then(([error]) => Promise.reject(error)),
    ]), socket);
    assertResponse(await timeout(readResponse(), socket), [220]);
    await writeLine(socket, "EHLO gestion.d2fcompliant.org");
    assertResponse(await timeout(readResponse(), socket), [250]);
    const credentials = Buffer.from(`\u0000${configuration.user}\u0000${configuration.password}`, "utf8").toString("base64");
    await writeLine(socket, `AUTH PLAIN ${credentials}`);
    assertResponse(await timeout(readResponse(), socket), [235]);
    await writeLine(socket, "QUIT");
    assertResponse(await timeout(readResponse(), socket).catch(() => ({ code: 221, lines: [] })), [221]);
    return { ok: true, host: configuration.host, port: configuration.port };
  } finally {
    socket.destroy();
  }
}

export async function sendSmtpMessage(configuration: SmtpConfiguration, message: SmtpMessage) {
  const recipient = validEmail(message.to);
  const replyTo = validEmail(message.replyTo || configuration.senderEmail);
  if (!recipient) throw new Error("Destinataire SMTP invalide");

  const socket = tlsConnect({ host: configuration.host, port: configuration.port, servername: configuration.host, rejectUnauthorized: true });
  socket.setNoDelay(true);
  const readResponse = smtpReader(socket);
  try {
    await timeout(Promise.race([
      once(socket, "secureConnect").then(() => undefined),
      once(socket, "error").then(([error]) => Promise.reject(error)),
    ]), socket);
    assertResponse(await timeout(readResponse(), socket), [220]);

    await writeLine(socket, "EHLO gestion.d2fcompliant.org");
    assertResponse(await timeout(readResponse(), socket), [250]);

    const credentials = Buffer.from(`\u0000${configuration.user}\u0000${configuration.password}`, "utf8").toString("base64");
    await writeLine(socket, `AUTH PLAIN ${credentials}`);
    assertResponse(await timeout(readResponse(), socket), [235]);

    await writeLine(socket, `MAIL FROM:<${configuration.senderEmail}>`);
    assertResponse(await timeout(readResponse(), socket), [250]);
    await writeLine(socket, `RCPT TO:<${recipient}>`);
    assertResponse(await timeout(readResponse(), socket), [250, 251]);
    await writeLine(socket, "DATA");
    assertResponse(await timeout(readResponse(), socket), [354]);

    const headers = [
      `From: ${encodedHeader(configuration.senderName)} <${configuration.senderEmail}>`,
      `To: <${recipient}>`,
      `Reply-To: <${replyTo}>`,
      `Subject: ${encodedHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@d2fcompliant.com>`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    ];
    await writeLine(socket, `${headers.join("\r\n")}\r\n\r\n${wrappedBase64(message.text)}\r\n.`);
    assertResponse(await timeout(readResponse(), socket, 30000), [250]);
    await writeLine(socket, "QUIT");
    assertResponse(await timeout(readResponse(), socket).catch(() => ({ code: 221, lines: [] })), [221]);
  } finally {
    socket.destroy();
  }
}
