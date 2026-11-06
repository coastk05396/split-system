import { type Group, MAX_MEMBER_PREVIEW } from "@split/shared";
import { Avatar } from "./ui.js";

/**
 * A Group's first few Members as overlapping avatars; the count of the rest sits at the end.
 * Inside a `group` parent they spread apart on hover and spring open on touch/click
 * (group-active:space-x-1.5 with spring easing).
 */
export function AvatarStack({
  members,
  total,
}: {
  members: Group["memberPreview"];
  total: number;
}) {
  const shown = members.slice(0, MAX_MEMBER_PREVIEW);
  const more = total - shown.length;
  return (
    <span
      aria-hidden="true"
      className="mt-1 flex items-center -space-x-2.5 transition-[margin] duration-300 ease-(--ease-spring) group-hover:-space-x-1 group-active:space-x-1.5 motion-reduce:group-hover:-space-x-2.5 motion-reduce:group-active:-space-x-2.5 motion-reduce:transition-none"
    >
      {shown.map((m, i) => (
        <span
          key={`${m.name}-${String(i)}`}
          className="rounded-full ring-2 ring-white transition-[scale] duration-300 ease-(--ease-spring) group-active:scale-105 motion-reduce:transition-none motion-reduce:group-active:scale-100"
        >
          <Avatar name={m.name} pictureUrl={m.pictureUrl} className="size-7 text-xs" />
        </span>
      ))}
      {more > 0 && (
        <span className="z-10 flex size-7 items-center justify-center rounded-full bg-sprout-150 text-xs font-bold text-sprout-700 ring-2 ring-white transition-[scale] duration-300 ease-(--ease-spring) group-active:scale-105 motion-reduce:transition-none motion-reduce:group-active:scale-100">
          +{more}
        </span>
      )}
    </span>
  );
}
