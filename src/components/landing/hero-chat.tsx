import type { CSSProperties, ReactNode } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatBRL } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { ANA, BRUNO, DIEGO, type SamplePerson } from "./sample-people";
import styles from "./hero-chat.module.css";

const LABEL =
  "Conversa no grupo Resenha de sexta: Ana manda o link da sala do Boteco da Esquina, 3 de 4 marcaram; Bruno e Diego já marcaram e Carla está entrando.";

function order(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

function Message({ index, person, children }: { index: number; person: SamplePerson; children: ReactNode }) {
  return (
    <li className={styles.message} style={order(index)}>
      <UserAvatar name={person.name} size="sm" className="size-6.5 text-[11.5px]" />
      <div className={styles.bubble}>
        <span className={styles.author}>{person.firstName}</span>
        {children}
      </div>
    </li>
  );
}

function LinkPreview() {
  return (
    <li className={cn(styles.message, styles.continued)} style={order(1)}>
      <div className={cn(styles.bubble, styles.preview)}>
        <div className={styles.previewTop}>
          <svg width="18" height="18" viewBox="0 0 36 36" aria-hidden="true">
            <rect x="2" y="2" width="32" height="32" rx="9" className="fill-primary" />
            <circle cx="10" cy="18" r="3" fill="white" />
            <rect x="15.5" y="10" width="5" height="16" rx="2.5" fill="white" />
            <circle cx="26" cy="18" r="3" fill="white" />
          </svg>
          dividimos.ai
        </div>
        <div className={styles.previewBody}>
          <b>Sala · Boteco da Esquina</b>
          <span className={styles.previewSum}>5 itens · {formatBRL(25289)}</span>
          <div className={styles.progress}>
            <span>3 de 4 marcaram</span>
            <div className={styles.bar}>
              <i />
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

export function HeroChat() {
  return (
    <aside className={styles.card} role="img" aria-label={LABEL}>
      <div className={styles.head}>
        <span className={styles.group}>RS</span>
        <div>
          <b>Resenha de sexta</b>
          <small>Ana, Bruno, Carla, Diego</small>
        </div>
      </div>
      <ol className={styles.messages}>
        <Message index={0} person={ANA}>
          Conta chegou. Marca aí o que cada um pediu
        </Message>
        <LinkPreview />
        <Message index={2} person={BRUNO}>
          marquei o meu
        </Message>
        <Message index={3} person={DIEGO}>
          marquei. Carla, só falta você
        </Message>
        <li className={cn(styles.message, styles.mine)} style={order(4)}>
          <div className={styles.bubble}>tô entrando, pera</div>
        </li>
      </ol>
    </aside>
  );
}
