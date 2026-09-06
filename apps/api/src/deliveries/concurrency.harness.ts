/**
 * Harnais de concurrence.
 *
 * Tester une race condition en appelant deux fonctions à la suite ne prouve
 * rien : la seconde voit déjà le résultat de la première. Pour qu'une course
 * soit réelle, il faut que les deux appels **lisent le même état** avant que
 * l'un des deux écrive.
 *
 * Ce harnais fournit les deux outils nécessaires :
 *
 *  1. `Barrier` — toutes les tâches attendent que le dernier participant soit
 *     arrivé, puis partent ensemble. Sans ça, `Promise.all` lance simplement
 *     les tâches dans l'ordre, et la première a le temps de finir.
 *
 *  2. `InterleavePoint` — un point d'arrêt injecté **entre la lecture et
 *     l'écriture** du dépôt. C'est là que la fenêtre de course s'ouvre en
 *     production ; le reproduire ici rend le test fidèle plutôt
 *     qu'approximatif.
 *
 * Node exécute JavaScript sur un seul fil : sans ces deux mécanismes, aucune
 * interruption ne se produit et les tests passeraient même sur du code cassé.
 */

/** Point de rendez-vous : personne ne repart avant que tout le monde soit là. */
export class Barrier {
  private waiting = 0;
  private release!: () => void;
  private readonly gate: Promise<void>;

  constructor(private readonly participants: number) {
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  async arrive(): Promise<void> {
    this.waiting += 1;
    if (this.waiting >= this.participants) this.release();
    await this.gate;
  }
}

/**
 * Point d'interleaving contrôlé par le test.
 *
 * Le dépôt l'attend avant chaque écriture. Le test décide quand — et dans quel
 * ordre — les écritures reprennent.
 */
export class InterleavePoint {
  private readonly pending: Array<() => void> = [];
  private readonly arrivals: Array<() => void> = [];

  /** Appelé par le dépôt : bloque jusqu'à `releaseAll` ou `releaseNext`. */
  wait(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.pending.push(resolve);
      this.arrivals.shift()?.();
    });
  }

  /** Attend qu'au moins `count` tâches soient bloquées au point d'arrêt. */
  async waitForArrivals(count: number): Promise<void> {
    while (this.pending.length < count) {
      await new Promise<void>((resolve) => {
        this.arrivals.push(resolve);
        // Filet de sécurité : si personne n'arrive, on ne bloque pas le test.
        setTimeout(resolve, 0);
      });
    }
  }

  /** Libère toutes les tâches en attente, dans leur ordre d'arrivée. */
  releaseAll(): void {
    while (this.pending.length > 0) this.pending.shift()?.();
  }

  /** Libère une seule tâche — permet d'imposer un ordre d'écriture précis. */
  releaseNext(): void {
    this.pending.shift()?.();
  }

  get blocked(): number {
    return this.pending.length;
  }
}

/**
 * Lance `count` tâches qui démarrent toutes au même instant.
 *
 * Renvoie les résultats *settled* : dans une course, une partie des tâches
 * échoue par conception, et c'est précisément ce qu'on veut observer.
 */
export async function runConcurrently<T>(
  count: number,
  task: (index: number) => Promise<T>,
): Promise<readonly PromiseSettledResult<T>[]> {
  const barrier = new Barrier(count);

  return Promise.allSettled(
    Array.from({ length: count }, async (_unused, index) => {
      await barrier.arrive();
      return task(index);
    }),
  );
}

export function fulfilled<T>(results: readonly PromiseSettledResult<T>[]): readonly T[] {
  return results
    .filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled")
    .map((r) => r.value);
}

export function rejected<T>(results: readonly PromiseSettledResult<T>[]): readonly unknown[] {
  return results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason);
}
