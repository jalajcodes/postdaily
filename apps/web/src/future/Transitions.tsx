// Page transitions for futuristic mode (Framer Motion). Lazy-loaded with the rest of the mode.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLocation, useOutlet } from "react-router-dom";

export default function Transitions() {
  const location = useLocation();
  const outlet = useOutlet();
  const reduce = useReducedMotion();
  // Posts share one key so editing doesn't re-animate on every save.
  const key = location.pathname.split("/").slice(0, 2).join("/");
  if (reduce) return outlet;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
        transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}
