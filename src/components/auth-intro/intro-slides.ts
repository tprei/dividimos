import type { ComponentType } from "react";
import { ChargeScene } from "./charge-scene";
import { ScanScene } from "./scan-scene";
import type { IntroSceneProps } from "./scene-stage";
import { SplitScene } from "./split-scene";

export interface IntroSlide {
  title: string;
  support: string;
  Scene: ComponentType<IntroSceneProps>;
}

export const INTRO_SLIDES: readonly IntroSlide[] = [
  {
    title: "Escaneie a notinha",
    support: "Tira uma foto do cupom e os itens aparecem sozinhos",
    Scene: ScanScene,
  },
  {
    title: "Bota quem comeu o quê",
    support: "Cada um toca no que consumiu",
    Scene: SplitScene,
  },
  {
    title: "Cobre sem dar briga",
    support: "Pix no valor certinho e a conta sai justa pra todo mundo",
    Scene: ChargeScene,
  },
];

export const LOGIN_SLIDE_TITLE = "Entrar";
