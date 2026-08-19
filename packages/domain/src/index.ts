/**
 * @cbd/domain — règles métier partagées.
 *
 * Ce package ne connaît ni base de données, ni framework web, ni HTTP. Il ne
 * contient que des fonctions pures et des types, pour que la même règle soit
 * appliquée à l'identique par l'API, les back-offices et les tests.
 */

export * from "./roles.js";
export * from "./order/status.js";
export * from "./order/transitions.js";
export * from "./compliance/status.js";
export * from "./qr/events.js";
export * from "./pricing/breakdown.js";
export * from "./delivery/dispatch.js";
