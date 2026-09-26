import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { ReceiptStubs } from "./receipt-stubs";
import { ANA, BRUNO, CARLA, DIEGO, type SamplePerson } from "./sample-people";
import styles from "./hero-receipt.module.css";

interface ReceiptClaim {
  person: SamplePerson;
  units?: number;
}

interface ReceiptItem {
  qty: number;
  name: string;
  cents: number;
  claims: ReceiptClaim[];
}

const ITEMS: ReceiptItem[] = [
  { qty: 1, name: "Picanha na chapa", cents: 8990, claims: [{ person: ANA }, { person: BRUNO }, { person: DIEGO }] },
  {
    qty: 1,
    name: "Porção de fritas",
    cents: 3200,
    claims: [{ person: ANA }, { person: BRUNO }, { person: CARLA }, { person: DIEGO }],
  },
  { qty: 5, name: "Chopp 300ml", cents: 6450, claims: [{ person: BRUNO, units: 3 }, { person: DIEGO, units: 2 }] },
  { qty: 2, name: "Caipirinha", cents: 3600, claims: [{ person: ANA }, { person: CARLA }] },
  { qty: 1, name: "Guaraná lata", cents: 750, claims: [{ person: CARLA }] },
];

const SUBTOTAL_CENTS = 22990;
const SERVICE_FEE_CENTS = 2299;
const TOTAL_CENTS = 25289;

const LABEL = "Notinha do Boteco da Esquina, dividida entre Ana, Bruno, Carla e Diego";

function ItemRow({ item }: { item: ReceiptItem }) {
  return (
    <li className={styles.item}>
      <div className={styles.line}>
        <span className={styles.qty}>{item.qty}</span>
        <span>{item.name}</span>
        <span className={cn(styles.amount, styles.money)}>{formatBRL(item.cents)}</span>
      </div>
      <div className={styles.chips}>
        {item.claims.map((claim) => (
          <span key={claim.person.name} className={styles.chip}>
            <UserAvatar name={claim.person.name} size="xs" className="size-5 text-[9.5px]" />
            {claim.units !== undefined && <span className={styles.units}>×{claim.units}</span>}
          </span>
        ))}
      </div>
    </li>
  );
}

function TotalRow({ label, cents, final = false }: { label: string; cents: number; final?: boolean }) {
  return (
    <div className={cn(styles.row, final && styles.finalRow)}>
      <span>{label}</span>
      <span className={styles.money}>{formatBRL(cents)}</span>
    </div>
  );
}

export function HeroReceipt() {
  return (
    <figure className={styles.figure} aria-label={LABEL}>
      <div className={styles.receipt}>
        <div className={cn(styles.teeth, styles.teethTop)} aria-hidden="true" />
        <div className={styles.paper}>
          <div className={styles.head}>
            <p className={styles.store}>Boteco da Esquina</p>
            <p className={styles.meta}>Cupom não fiscal · Mesa 07</p>
          </div>
          <div className={styles.rule} />
          <ul className={styles.items}>
            {ITEMS.map((item) => (
              <ItemRow key={item.name} item={item} />
            ))}
          </ul>
          <div className={styles.rule} />
          <div className={styles.totals}>
            <TotalRow label="Subtotal" cents={SUBTOTAL_CENTS} />
            <TotalRow label="Garçom 10%" cents={SERVICE_FEE_CENTS} />
            <TotalRow label="Total" cents={TOTAL_CENTS} final />
          </div>
        </div>
        <div className={styles.tear} />
        <ReceiptStubs />
        <div className={cn(styles.teeth, styles.teethBottom)} aria-hidden="true" />
      </div>
    </figure>
  );
}
