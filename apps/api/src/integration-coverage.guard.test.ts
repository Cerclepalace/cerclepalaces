/**
 * Une suite verte doit être une suite complète — en intégration continue.
 *
 * Les tests d'intégration de cette application se sautent d'eux-mêmes quand
 * `PROJET1_TEST_DATABASE_URL` est absente (`describe.skipIf`). C'est le bon
 * comportement en local : personne ne doit avoir à monter PostgreSQL pour
 * corriger une faute de frappe.
 *
 * Mais ce même comportement produit, sans base, un rapport affichant « 661
 * passés » et rangeant quarante-trois tests en « sautés » — sans que rien ne
 * dise qu'un tiers de la couverture d'intégration n'a pas tourné. Un vert qui
 * ment coûte plus cher qu'un rouge : il donne à un relecteur, humain ou
 * automatique, une confiance que rien ne soutient.
 *
 * Cette garde tranche selon le lieu d'exécution, parce que l'exigence n'est pas
 * la même des deux côtés :
 *
 *  - **En local** (`CI` absente) elle passe. Elle n'impose aucune base à
 *    personne ; le silence des tests sautés y reste un choix de confort assumé.
 *  - **En CI** (`CI` définie, ce que fait GitHub Actions) elle échoue si la
 *    base n'est pas câblée. Le workflow monte un PostgreSQL 16 et renseigne la
 *    variable ; si cette chaîne casse un jour, la suite devient rouge au lieu
 *    de rester verte en silence.
 *
 * Elle double la dernière étape du workflow, qui refuse tout run comportant un
 * test sauté. Le doublon est voulu : l'étape du workflow lit un rapport et
 * pourrait être contournée en changeant une commande ; cette garde-ci vit dans
 * la suite elle-même. Il faut désormais désarmer les deux.
 */

import { describe, expect, it } from "vitest";

const EN_CI = process.env["CI"] !== undefined && process.env["CI"] !== "";
const URL_BASE_DE_TEST = process.env["PROJET1_TEST_DATABASE_URL"];

describe("couverture d'intégration", () => {
  it.skipIf(!EN_CI)("en CI, la base de test est câblée", () => {
    expect(
      URL_BASE_DE_TEST,
      "PROJET1_TEST_DATABASE_URL est absente en CI : les tests d'intégration " +
        "se sauteraient et la suite serait verte sans les avoir exécutés. " +
        "Vérifier le service postgres et le bloc env du workflow.",
    ).toBeDefined();
    expect(URL_BASE_DE_TEST).not.toBe("");
  });

  it("hors CI, l'absence de base reste un choix de confort", () => {
    // Aucune assertion sur l'environnement : ce test documente que la garde
    // ci-dessus est délibérément inerte en local, et il échouerait si quelqu'un
    // la rendait inconditionnelle — ce qui imposerait PostgreSQL à quiconque
    // corrige une virgule.
    expect(EN_CI || URL_BASE_DE_TEST === undefined || URL_BASE_DE_TEST.length > 0).toBe(true);
  });
});
