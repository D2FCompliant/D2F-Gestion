"use strict";

function nowIso() {
  return new Date().toISOString();
}

function log(level, message, meta) {
  const line = {
    ts: nowIso(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

function info(message, meta) {
  log("info", message, meta);
}
function warn(message, meta) {
  log("warn", message, meta);
}
function error(message, meta) {
  log("error", message, meta);
}

module.exports = { info, warn, error };
