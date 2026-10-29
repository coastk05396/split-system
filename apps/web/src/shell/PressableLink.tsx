import type { ReactNode } from "react";
import { Link } from "react-router";

/** A light spring press response for links that occupy a whole card or row (off under reduced motion). */
export function PressableLink(props: { to: string; className: string; children: ReactNode }) {
  const { className, ...rest } = props;
  return <Link {...rest} className={`${className} press-card`} />;
}
