'use strict';

// A missing provider stub must fail the test, never contact a real service.
const isLoopback = (host) => ['127.0.0.1', '::1', '[::1]'].includes(host);
const fail = () => { throw new Error('External network access is disabled in regression tests; stub the provider boundary'); };
const { Socket } = require('node:net');
const originalConnect = Socket.prototype.connect;
Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  // Permit only explicit loopback TCP connections for the real HTTP tests.
  if (!options || typeof options !== 'object' || !isLoopback(options.host)) fail();
  return originalConnect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!isLoopback(url.hostname)) fail();
  return originalFetch(input, init);
};
