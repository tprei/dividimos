"use client";

import { motion } from "framer-motion";
import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { User } from "@/types";

interface AddParticipantFormProps {
  onAdd: (user: User) => void;
  onCancel: () => void;
}

let participantIdCounter = 100;

export function AddParticipantForm({ onAdd, onCancel }: AddParticipantFormProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pixKey, setPixKey] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const id = `participant_${participantIdCounter++}`;
    onAdd({
      id,
      name: name.trim(),
      phone: phone || "",
      pixKey: pixKey || phone || "",
      pixKeyType: "phone",
      createdAt: new Date().toISOString(),
    });

    setName("");
    setPhone("");
    setPixKey("");
  };

  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3 }}
      onSubmit={handleSubmit}
      className="overflow-hidden rounded-2xl border bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Adicionar participante</span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <Input
          placeholder="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <Input
          placeholder="Telefone (opcional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          type="tel"
        />
        <Input
          placeholder="Chave Pix (opcional)"
          value={pixKey}
          onChange={(e) => setPixKey(e.target.value)}
        />
      </div>

      <Button type="submit" className="mt-4 w-full gap-2" disabled={!name.trim()}>
        <UserPlus className="h-4 w-4" />
        Adicionar
      </Button>
    </motion.form>
  );
}
