/**
 * Routes barrel.
 */

export type {
  RouteHandler,
  RouteDeps,
  AuthAdapter,
  EnvAdapter,
} from './types.js';

export { jsonResponse, errorResponse, withAdmin } from './types.js';

export { createBackdropRoutes, type BackdropRoutes } from './backdrop/index.js';
