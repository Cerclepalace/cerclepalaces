/**
 * @cbd/domain — règles métier partagées.
 *
 * Ce package ne connaît ni base de données, ni framework web, ni HTTP, ni
 * horloge. Il ne contient que des fonctions pures et des types, pour que la
 * même règle soit appliquée à l'identique par l'API, les back-offices et les
 * tests.
 */

export * from "./roles.js";
export * from "./tenancy/scope.js";

export * from "./order/status.js";
export * from "./order/transitions.js";

export * from "./merchant/status.js";

export * from "./compliance/status.js";
export * from "./catalog/publication.js";

export * from "./delivery/status.js";
export * from "./delivery/assignment.js";
export * from "./delivery/availability.js";
export * from "./delivery/dispatch.js";
export * from "./delivery/proof.js";
export * from "./delivery/payout.js";
export * from "./delivery/replay.js";

export * from "./qr/events.js";
export * from "./pricing/breakdown.js";

export * from "./ports/payment-provider.js";
export * from "./ports/delivery-provider.js";
