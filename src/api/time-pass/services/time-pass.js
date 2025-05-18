"use strict";

/**
 * time-pass service
 */

const { createCoreService } = require("@strapi/strapi").factories;

module.exports = createCoreService("api::time-pass.time-pass");
