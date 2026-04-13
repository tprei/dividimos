"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function ProfileError() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-bold">Algo deu errado</h1>
        <p className="text-muted-foreground">
          Não foi possível carregar este perfil. Tente novamente mais tarde.
        </p>
        <Link
          href="/"
          className={buttonVariants({ size: "lg", className: "w-full" })}
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
