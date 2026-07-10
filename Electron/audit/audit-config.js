"use strict";

const path = require("node:path");
const { app } = require("electron");

function getAuditLogPath() {
  return path.join(app.getPath("userData"), "audit", "audit.log.jsonl");
}

module.exports = {
  getAuditLogPath,
};
