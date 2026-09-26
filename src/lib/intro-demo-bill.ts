import {
  allocateByWeights,
  allocateEvenly,
  computeServiceFeeCents,
  type ValidationResult,
} from "@/lib/expense-money";

export type IntroPersonId = "voce" | "bia" | "leo";
export type IntroItemId = "chopp" | "batata" | "caipirinha" | "pastel" | "guarana";

export interface IntroPerson {
  id: IntroPersonId;
  name: string;
  initials: string;
  avatarTone: number;
}

export interface IntroItem {
  id: IntroItemId;
  name: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

export type IntroSharers = Readonly<Record<IntroItemId, readonly IntroPersonId[]>>;

export interface IntroSplit {
  subtotalCents: Readonly<Record<IntroPersonId, number>>;
  serviceCents: Readonly<Record<IntroPersonId, number>>;
  totalCents: Readonly<Record<IntroPersonId, number>>;
  unassignedCents: number;
}

export const INTRO_PEOPLE: readonly IntroPerson[] = [
  { id: "voce", name: "Você", initials: "VC", avatarTone: 0 },
  { id: "bia", name: "Bia", initials: "BI", avatarTone: 2 },
  { id: "leo", name: "Léo", initials: "LE", avatarTone: 5 },
];

function introItem(id: IntroItemId, name: string, quantity: number, unitCents: number): IntroItem {
  return { id, name, quantity, unitCents, totalCents: quantity * unitCents };
}

export const INTRO_ITEMS: readonly IntroItem[] = [
  introItem("chopp", "Chopp", 2, 1290),
  introItem("batata", "Porção de batata", 1, 3300),
  introItem("caipirinha", "Caipirinha", 1, 1800),
  introItem("pastel", "Pastel (6 un)", 1, 2800),
  introItem("guarana", "Guaraná", 1, 700),
];

export const INTRO_DEFAULT_SHARERS: IntroSharers = {
  chopp: ["voce", "leo"],
  batata: ["voce", "bia", "leo"],
  caipirinha: ["bia"],
  pastel: ["bia", "leo"],
  guarana: ["voce"],
};

function unwrap<T>(result: ValidationResult<T>): T {
  if (!result.ok) throw new Error(result.issue.code);
  return result.value;
}

export const INTRO_SERVICE_FEE_BASIS_POINTS = 1000;
export const INTRO_SUBTOTAL_CENTS = INTRO_ITEMS.reduce((sum, item) => sum + item.totalCents, 0);
export const INTRO_SERVICE_CENTS: number = unwrap(
  computeServiceFeeCents(INTRO_SUBTOTAL_CENTS, INTRO_SERVICE_FEE_BASIS_POINTS),
);
export const INTRO_TOTAL_CENTS = INTRO_SUBTOTAL_CENTS + INTRO_SERVICE_CENTS;

function byPerson(values: readonly number[]): Record<IntroPersonId, number> {
  const record: Record<IntroPersonId, number> = { voce: 0, bia: 0, leo: 0 };
  INTRO_PEOPLE.forEach((person, index) => {
    record[person.id] = values[index];
  });
  return record;
}

/** Splits each item evenly among its sharers in `INTRO_PEOPLE` order, then the service by subtotal once every item has someone. */
export function splitIntroBill(sharers: IntroSharers): IntroSplit {
  const subtotals = INTRO_PEOPLE.map(() => 0);
  let unassignedCents = 0;
  for (const item of INTRO_ITEMS) {
    const chosen = sharers[item.id];
    const indexes = INTRO_PEOPLE.flatMap((person, index) => (chosen.includes(person.id) ? [index] : []));
    if (indexes.length === 0) {
      unassignedCents += item.totalCents;
      continue;
    }
    const parts = unwrap(allocateEvenly(item.totalCents, indexes.length));
    indexes.forEach((personIndex, k) => {
      subtotals[personIndex] += parts[k];
    });
  }
  const service: readonly number[] =
    unassignedCents === 0
      ? unwrap(allocateByWeights(INTRO_SERVICE_CENTS, subtotals))
      : INTRO_PEOPLE.map(() => 0);
  return {
    subtotalCents: byPerson(subtotals),
    serviceCents: byPerson(service),
    totalCents: byPerson(subtotals.map((cents, index) => cents + service[index])),
    unassignedCents,
  };
}
