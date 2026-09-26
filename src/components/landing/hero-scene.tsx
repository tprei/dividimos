import { cn } from "@/lib/utils";
import { Coaster, Copo, TableArtDefs } from "./table-art";
import { ClinkBottles, FlipCap } from "./table-toys";
import styles from "./hero-scene.module.css";

function Mesa() {
  return (
    <div className={styles.mesa} aria-hidden="true">
      <div className={styles.legs}>
        <i className={cn(styles.leg, styles.legBack, styles.legBackLeft)} />
        <i className={cn(styles.leg, styles.legBack, styles.legBackRight)} />
        <i className={cn(styles.leg, styles.legFront, styles.legFrontLeft)} />
        <i className={cn(styles.leg, styles.legFront, styles.legFrontRight)} />
      </div>
      <div className={cn(styles.slab, styles.side)} />
      <div className={cn(styles.slab, styles.top)} />
    </div>
  );
}

function Shadows() {
  return (
    <>
      <span className={cn(styles.shadowCast, styles.bottle1Cast)} aria-hidden="true" />
      <span className={cn(styles.shadowContact, styles.bottle1Contact)} aria-hidden="true" />
      <span className={cn(styles.shadowCast, styles.bottle2Cast)} aria-hidden="true" />
      <span className={cn(styles.shadowContact, styles.bottle2Contact)} aria-hidden="true" />
      <span className={cn(styles.shadowCast, styles.glassCast)} aria-hidden="true" />
    </>
  );
}

export function HeroScene() {
  return (
    <div className={styles.sceneFit}>
      <div className={styles.scene}>
        <TableArtDefs />
        <Mesa />
        <Shadows />
        <Coaster className={styles.coaster} />
        <ClinkBottles />
        <div className={cn(styles.prop, styles.copo)} aria-hidden="true">
          <Copo />
        </div>
        <FlipCap tone="amber" className={styles.cap1} />
        <FlipCap tone="silver" className={styles.cap2} />
        <FlipCap tone="ink" className={styles.cap3} />
        <FlipCap tone="amber" className={styles.cap4} />
      </div>
    </div>
  );
}
