"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useReducedMotion } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { parseDemoExpense, type DemoExpenseDraft } from "@/lib/landing-expense-draft";
import { useRipple } from "./click-fx";
import { DraftCard } from "./draft-card";
import styles from "./text-demo.module.css";

type TextLog =
  | { id: number; status: "pending"; text: string }
  | { id: number; status: "done"; text: string; draft: DemoExpenseDraft | null };

const INITIAL_TEXT = "jantar 120 dividido em 4";
const EXAMPLES = ["uber 48 com bia e caio", "mercado 86,40 com a carla", "pizza 90 em 3", INITIAL_TEXT];
const REPLY_DELAY_MS = 750;

export function TextDemo() {
  const reduceMotion = useReducedMotion();
  const { onPointerDown, ripples } = useRipple();
  const [log, setLog] = useState<TextLog>(() => ({
    id: 0,
    status: "done",
    text: INITIAL_TEXT,
    draft: parseDemoExpense(INITIAL_TEXT),
  }));
  const [value, setValue] = useState("");
  const [userDriven, setUserDriven] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoTyping = useRef(true);
  const nextId = useRef(1);
  const replyTimer = useRef<NodeJS.Timeout | undefined>(undefined);

  const send = useCallback(
    (text: string) => {
      const id = nextId.current++;
      setLog({ id, status: "pending", text });
      clearTimeout(replyTimer.current);
      replyTimer.current = setTimeout(
        () => setLog({ id, status: "done", text, draft: parseDemoExpense(text) }),
        reduceMotion ? 0 : REPLY_DELAY_MS,
      );
    },
    [reduceMotion],
  );

  useEffect(() => () => clearTimeout(replyTimer.current), []);

  useEffect(() => {
    const card = formRef.current?.closest("article");
    if (reduceMotion !== false || !card) return;
    let example = 0;
    let timer: NodeJS.Timeout | undefined;

    const typeNext = () => {
      if (!autoTyping.current) return;
      const text = EXAMPLES[example % EXAMPLES.length];
      example += 1;
      let typed = 0;
      const step = () => {
        if (!autoTyping.current) return;
        typed += 1;
        setValue(text.slice(0, typed));
        if (typed < text.length) {
          timer = setTimeout(step, 45 + Math.random() * 60);
          return;
        }
        timer = setTimeout(() => {
          if (!autoTyping.current) return;
          setValue("");
          send(text);
          timer = setTimeout(typeNext, 3400);
        }, 450);
      };
      step();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        clearTimeout(timer);
        if (!autoTyping.current) {
          observer.disconnect();
          return;
        }
        if (entries.some((entry) => entry.isIntersecting)) {
          timer = setTimeout(typeNext, 1400);
          return;
        }
        setValue("");
      },
      { threshold: 0.5 },
    );
    observer.observe(card);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [reduceMotion, send]);

  const stopAutoTyping = () => {
    setUserDriven(true);
    if (!autoTyping.current) return;
    autoTyping.current = false;
    setValue("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = autoTyping.current ? "" : value.trim();
    stopAutoTyping();
    if (!text) {
      inputRef.current?.focus();
      return;
    }
    send(text);
    setValue("");
  };

  return (
    <>
      <div className={styles.log} aria-live={userDriven ? "polite" : "off"}>
        <p key={`text-${log.id}`} className={styles.userBubble}>
          <span className={styles.clamp}>{log.text}</span>
        </p>
        {log.status === "pending" && (
          <p className={styles.typing}>
            <span className="sr-only">Montando o rascunho</span>
            <i aria-hidden="true" />
            <i aria-hidden="true" />
            <i aria-hidden="true" />
          </p>
        )}
        {log.status === "done" && log.draft && <DraftCard key={`draft-${log.id}`} draft={log.draft} />}
        {log.status === "done" && !log.draft && (
          <p className={styles.miss}>Faltou o valor. Tenta “pizza 90 em 3”.</p>
        )}
      </div>
      <form ref={formRef} className={styles.form} onSubmit={submit}>
        <label className="sr-only" htmlFor="landing-text-demo">
          Descreva a despesa
        </label>
        <input
          ref={inputRef}
          id="landing-text-demo"
          type="text"
          className={styles.input}
          autoComplete="off"
          enterKeyHint="send"
          placeholder="pizza 90 em 3"
          maxLength={80}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={stopAutoTyping}
          onPointerDown={stopAutoTyping}
        />
        <button type="submit" className={styles.send} aria-label="Enviar" onPointerDown={onPointerDown}>
          <ArrowUp aria-hidden="true" strokeWidth={2.4} />
          {ripples}
        </button>
      </form>
    </>
  );
}
