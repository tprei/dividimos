"use client";

import { motion, useIsPresent, type HTMLMotionProps } from "framer-motion";

export const viewLayerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.16 } },
  exit: { opacity: 0, y: 10, transition: { duration: 0.15 } },
};

/** A view animating out stays in the DOM for a moment; it must not take taps or be read. */
export function ViewLayer(props: HTMLMotionProps<"div">) {
  const isPresent = useIsPresent();
  return <motion.div {...props} inert={!isPresent} />;
}
