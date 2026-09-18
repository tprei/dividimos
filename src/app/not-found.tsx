import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center px-6 text-center">
      <div className="rounded-2xl bg-muted/50 p-4">
        <FileQuestion className="h-8 w-8 text-muted-foreground/50" />
      </div>
      <h1 className="mt-4 text-base font-semibold">Página não encontrada</h1>
      <p className="mt-1.5 max-w-[260px] text-sm text-muted-foreground">
        O endereço acessado não existe.
      </p>
      <Link
        href="/app"
        className={cn(buttonVariants({ variant: "default" }), "mt-5 min-h-11 rounded-lg")}
      >
        Voltar ao início
      </Link>
    </main>
  );
}
