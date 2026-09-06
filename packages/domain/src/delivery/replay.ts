/**
 * Reconstruction d'un état depuis le journal d'événements.
 *
 * Deux usages, tous deux critiques :
 *
 *  1. **Vérification de cohérence.** L'état stocké sur `Delivery` et la suite
 *     d'événements de `DeliveryStatusEvent` doivent raconter la même histoire.
 *     S'ils divergent, quelque chose a écrit un statut sans passer par le
 *     service — exactement ce que l'architecture interdit.
 *
 *  2. **Audit et litige.** Rejouer permet de répondre à « dans quel état était
 *     cette course à 18 h 42 ? » sans conserver de photographie périodique.
 *
 *  Le rejeu est **déterministe** : même journal, même état final, toujours.
 *  Il ne consulte ni horloge ni base.
 */

import {
  findDeliveryTransition,
  isTerminalDeliveryStatus,
  type DeliveryStatus,
} from "./status.js";

export interface ReplayableEvent {
  readonly fromStatus: DeliveryStatus | null;
  readonly toStatus: DeliveryStatus;
  readonly createdAt: Date;
}

export type ReplayResult =
  | { readonly ok: true; readonly finalStatus: DeliveryStatus; readonly steps: number }
  | {
      readonly ok: false;
      readonly code: "GAP" | "ILLEGAL_TRANSITION" | "AFTER_TERMINAL" | "EMPTY";
      readonly message: string;
      readonly atIndex: number;
    };

/**
 * Rejoue un journal et renvoie l'état final.
 *
 * Trois incohérences sont détectées, et chacune signale un bug réel :
 *
 * - **GAP** — le `fromStatus` d'un événement ne correspond pas au `toStatus` du
 *   précédent. Un changement d'état a eu lieu sans laisser de trace.
 * - **ILLEGAL_TRANSITION** — une transition absente de la table a été écrite.
 * - **AFTER_TERMINAL** — un événement suit un état terminal.
 *
 * Le journal doit être fourni **trié par `createdAt` croissant** ; la fonction
 * ne trie pas, pour que l'ordre reste la responsabilité de la requête et que le
 * rejeu reflète exactement ce que la base contient.
 */
export function replayDeliveryEvents(
  events: readonly ReplayableEvent[],
  initialStatus: DeliveryStatus = "PENDING_DISPATCH",
): ReplayResult {
  if (events.length === 0) {
    return {
      ok: false,
      code: "EMPTY",
      message: "Aucun événement à rejouer.",
      atIndex: -1,
    };
  }

  let current = initialStatus;

  for (const [index, event] of events.entries()) {
    if (isTerminalDeliveryStatus(current)) {
      return {
        ok: false,
        code: "AFTER_TERMINAL",
        message: `Un événement suit l'état terminal ${current}.`,
        atIndex: index,
      };
    }

    // Le premier événement peut porter un `fromStatus` nul (création).
    if (event.fromStatus !== null && event.fromStatus !== current) {
      return {
        ok: false,
        code: "GAP",
        message: `Trou dans le journal : attendu ${current}, l'événement part de ${event.fromStatus}.`,
        atIndex: index,
      };
    }

    if (!findDeliveryTransition(current, event.toStatus)) {
      return {
        ok: false,
        code: "ILLEGAL_TRANSITION",
        message: `Transition ${current} → ${event.toStatus} absente de la table.`,
        atIndex: index,
      };
    }

    current = event.toStatus;
  }

  return { ok: true, finalStatus: current, steps: events.length };
}

/**
 * Vérifie que l'état stocké correspond à ce que raconte le journal.
 *
 * À passer en tâche de contrôle périodique : une divergence signifie qu'un
 * chemin d'écriture contourne le service, et doit être traitée comme un
 * incident, pas comme une donnée à corriger discrètement.
 */
export function eventsMatchStoredStatus(
  events: readonly ReplayableEvent[],
  storedStatus: DeliveryStatus,
  initialStatus: DeliveryStatus = "PENDING_DISPATCH",
): boolean {
  const result = replayDeliveryEvents(events, initialStatus);
  return result.ok && result.finalStatus === storedStatus;
}

/** État de la livraison à un instant donné, reconstitué depuis le journal. */
export function statusAt(
  events: readonly ReplayableEvent[],
  when: Date,
  initialStatus: DeliveryStatus = "PENDING_DISPATCH",
): DeliveryStatus {
  let current = initialStatus;
  for (const event of events) {
    if (event.createdAt.getTime() > when.getTime()) break;
    current = event.toStatus;
  }
  return current;
}
