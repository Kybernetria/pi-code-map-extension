/**
 * pi-code-map-extension protocol exports.
 *
 * Consumers can import `handlers` and register them with a pi-protocol fabric
 * alongside `pi.protocol.json`.
 */

export {
  buildFloorPlanHandler,
  getSideEffectsHandler,
  traceCallFlowHandler,
  getFunctionCallersHandler,
  getFunctionCalleesHandler,
  getEntryPointsHandler,
  handlers,
} from "./handlers.js";
