/**
 * The analytics layer's public surface.
 *
 * Everything exported here is a pure function or a type. No module in this
 * directory may import the database, a provider, a cache, the network, the
 * clock or a random source — enforced by boundary B in eslint.config.js.
 */
export * from './normalize.js';
export type * from './types.js';
