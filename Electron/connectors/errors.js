"use strict";

class ConnectorError extends Error {
  constructor(message, { code = "CONNECTOR_ERROR", httpStatus = null, details = null, retryable = false } = {}) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    this.retryable = !!retryable;
  }
}

function toConnectorError(err, fallbackCode = "CONNECTOR_ERROR") {
  if (err instanceof ConnectorError) return err;

  const msg = err?.message || String(err || "Unknown error");
  const httpStatus = err?.httpStatus || err?.status || null;

  return new ConnectorError(msg, {
    code: err?.code || fallbackCode,
    httpStatus,
    details: err?.details || err,
    retryable: !!err?.retryable,
  });
}

module.exports = { ConnectorError, toConnectorError };
