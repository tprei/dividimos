"use client";

import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openAppSettings } from "@/lib/capacitor/app-settings";
import { cn } from "@/lib/utils";

export function OpenAppSettingsButton({ className }: { className?: string }) {
  return (
    <Button type="button" variant="outline" size="lg" className={cn("w-full", className)} onClick={openAppSettings}>
      <Settings aria-hidden="true" />
      Abrir Ajustes
    </Button>
  );
}
