"use strict";

const { makeRegistry } = require("./index");

/**
 * selftest: lance testConnection sur tous les connecteurs.
 * usage: const report = await runSelfTest(config);
 */
async function runSelfTest(connectorsConfig) {
  const reg = makeRegistry(connectorsConfig);
  return await reg.testAll();
}

module.exports = { runSelfTest };
