"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  KeyRound,
  Receipt,
  Shield,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Skeleton } from "@/components/shared/skeleton";
import { Button } from "@/components/ui/button";
import { formatBillAmount } from "@/lib/currency";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import toast from "react-hot-toast";
import type { UserProfile } from "@/types";

export default function BillInvitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: billId } = use(params);
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [billTitle, setBillTitle] = useState("");
  const [totalAmount, setTotalAmount] = useState(0);
  const [billStatus, setBillStatus] = useState("");
  const [inviterName, setInviterName] = useState("");
  const [participantProfiles, setParticipantProfiles] = useState<UserProfile[]>([]);
  const [responding, setResponding] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    if (!user) return;

    async function load() {
      const { data: bill } = await supabase
        .from("bills")
        .select("title, total_amount, creator_id, status")
        .eq("id", billId)
        .single();

      if (!bill) {
        router.push("/app");
        return;
      }

      setBillTitle(bill.title);
      setTotalAmount(bill.total_amount);
      setBillStatus(bill.status);

      const { data: creatorProfile } = await supabase
        .from("user_profiles")
        .select("name")
        .eq("id", bill.creator_id)
        .single();

      setInviterName(creatorProfile?.name ?? "");

      const { data: participants } = await supabase
        .from("bill_participants")
        .select("user_id")
        .eq("bill_id", billId);

      const userIds = (participants ?? []).map((p) => p.user_id);
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("user_profiles")
          .select("*")
          .in("id", userIds);

        setParticipantProfiles(
          (profiles ?? []).map((p) => ({
            id: p.id,
            handle: p.handle,
            name: p.name,
            avatarUrl: p.avatar_url ?? undefined,
          })),
        );
      }

      const { data: myParticipation } = await supabase
        .from("bill_participants")
        .select("status")
        .eq("bill_id", billId)
        .eq("user_id", user!.id)
        .single();

      if (myParticipation?.status !== "invited") {
        router.push(`/app/bill/${billId}`);
        return;
      }

      setLoading(false);
    }

    load();
  }, [user, billId]);

  const handleAccept = async () => {
    if (!user) return;
    setResponding(true);
    await supabase
      .from("bill_participants")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("bill_id", billId)
      .eq("user_id", user.id);
    toast.success("Convite aceito");
    router.push(`/app/bill/${billId}`);
  };

  const handleDecline = async () => {
    if (!user) return;
    setResponding(true);
    await supabase
      .from("bill_participants")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("bill_id", billId)
      .eq("user_id", user.id);
    toast.success("Convite recusado");
    router.push("/app");
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/app"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-semibold">Convite para conta</h1>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="mt-6"
      >
        <div className="rounded-2xl gradient-primary p-5 text-white shadow-lg shadow-primary/20">
          <p className="text-sm text-white/70">Conta</p>
          <p className="mt-1 text-xl font-bold">{billTitle}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums">
            {formatBillAmount(billStatus, totalAmount)}
          </p>
          <p className="mt-2 text-sm text-white/70">
            Convidado por {inviterName}
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        className="mt-5"
      >
        <h2 className="mb-3 text-sm font-semibold flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Participantes
        </h2>
        <div className="space-y-2">
          {participantProfiles.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-xl border bg-card p-3"
            >
              <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
              <div>
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">@{p.handle}</p>
              </div>
              {p.id === user?.id && (
                <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  Voce
                </span>
              )}
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="mt-5"
      >
        <div className="rounded-2xl border-2 border-warning/30 bg-warning/5 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
            <div>
              <h3 className="font-semibold text-warning-foreground">
                Aviso sobre chave Pix
              </h3>
              <p className="mt-2 text-sm text-warning-foreground/80">
                Ao aceitar este convite, sua chave Pix podera ser usada para
                gerar codigos de cobranca QR Code nesta conta. A chave e
                exibida no codigo Copia e Cola.
              </p>
              <p className="mt-2 text-sm text-warning-foreground/80">
                Recomendamos usar uma chave aleatoria (UUID) em vez de CPF ou
                telefone para proteger seus dados pessoais.
              </p>
              <Link
                href="/app/profile"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary"
              >
                <KeyRound className="h-4 w-4" />
                Alterar chave Pix
              </Link>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4 }}
        className="mt-6 space-y-3"
      >
        <Button
          size="lg"
          className="w-full gap-2"
          onClick={handleAccept}
          disabled={responding}
        >
          <Check className="h-4 w-4" />
          {responding ? "Processando..." : "Aceitar e participar"}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="w-full gap-2 text-destructive"
          onClick={handleDecline}
          disabled={responding}
        >
          <X className="h-4 w-4" />
          Recusar convite
        </Button>
      </motion.div>

      <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <Shield className="h-3 w-3" />
        <span>Sua chave Pix e protegida com criptografia de alto nivel.</span>
      </div>
    </div>
  );
}
