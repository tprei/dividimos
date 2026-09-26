export type IntroSceneStage = "ready" | "play" | "rest";

export interface IntroSceneProps {
  stage: IntroSceneStage;
  onSettle: () => void;
  onBusy: () => void;
}
