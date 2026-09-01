/**
 * Racine de composition.
 *
 * **Le seul endroit du code applicatif qui connaît Prisma.** Partout ailleurs,
 * services et moteurs dépendent d'interfaces — c'est ce qui permet de tester
 * les règles sans base, et de remplacer un adaptateur sans toucher à une règle.
 *
 * Rien ne décide ici : ce fichier assemble, il n'arbitre pas. S'il commence à
 * contenir une condition métier, c'est qu'elle est au mauvais étage.
 *
 * Le client Prisma est reçu, pas créé : c'est l'appelant (serveur HTTP, tâche
 * planifiée, script d'exploitation) qui décide de son cycle de vie et de sa
 * fermeture. Une racine qui ouvrirait elle-même un pool laisserait chaque
 * consommateur en ouvrir un de plus.
 */

import type { PrismaClient } from "@cbd/db";

import { createDispatchContextReader, type DispatchContextReader } from "./deliveries/dispatch-context.js";
import { createDeliveryStore } from "./deliveries/prisma-repository.js";
import type { DeliveryTransactionalStore, DriverRepository } from "./deliveries/repository.js";
import { createDriverRepository } from "./drivers/prisma-repository.js";
import { createOrderStore } from "./orders/prisma-repository.js";
import type { TransactionalStore as OrderTransactionalStore } from "./orders/service.js";

export interface ApplicationDependencies {
  readonly orders: OrderTransactionalStore;
  readonly deliveries: DeliveryTransactionalStore;
  readonly drivers: DriverRepository;
  readonly dispatchContext: DispatchContextReader;
}

export function createApplication(prisma: PrismaClient): ApplicationDependencies {
  return {
    orders: createOrderStore(prisma),
    deliveries: createDeliveryStore(prisma),
    // Lectures hors transaction : le dépôt driver et le lecteur de contexte
    // servent à préparer une décision, pas à l'écrire. Les leur donner une
    // transaction la tiendrait ouverte pendant des lectures qui n'en ont pas
    // besoin.
    drivers: createDriverRepository(prisma),
    dispatchContext: createDispatchContextReader(prisma),
  };
}
