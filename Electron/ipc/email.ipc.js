"use strict";

const nodemailer = require("nodemailer");
const { ipcMain } = require("electron");

module.exports = function registerEmailIpc(ipcMain, getDbFn) {

  ipcMain.handle("email:send", async (_, payload = {}) => {

    const {
      to,
      subject,
      text,
      attachmentPath,
      attachmentName
    } = payload;

    const db = getDbFn();

    const company =
  db.prepare("SELECT * FROM company WHERE id=1").get();

console.log(company);

    if (!company) {
      throw new Error("Société introuvable");
    }

console.log("SMTP CONFIG =", {
  host: company.smtp_host,
  port: company.smtp_port,
  user: company.smtp_user,
  from: company.smtp_from_name,
});

    const transporter = nodemailer.createTransport({
      host: company.smtp_host,
      port: Number(company.smtp_port || 587),
      secure: Number(company.smtp_port) === 465,

      auth: {
        user: company.smtp_user,
        pass: company.smtp_password,
      },
    });

    const result = await transporter.sendMail({
      from: `"${company.legal_name}" <${company.smtp_user}>`,
      to,
      subject,
      text,

      attachments: [
        {
          filename: attachmentName,
          path: attachmentPath,
        },
      ],
    });

    return {
      ok: true,
      messageId: result.messageId,
    };
  });

  console.log("[IPC] loaded: email.ipc.js");
};