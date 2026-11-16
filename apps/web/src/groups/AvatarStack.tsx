import { type Group, MAX_MEMBER_PREVIEW } from "@split/shared";
import { Avatar } from "./ui.js";

/**
 * A Group's first few Members as overlapping avatars; the count of the rest sits at the end.
 * Inside a `group` parent they spread apart on pointer hover via CSS `.avatar-stack`.
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
    <span aria-hidden="true" className="avatar-stack mt-1 flex items-center -space-x-2.5">
      {shown.map((m, i) => (
        <span
          key={`${m.name}-${String(i)}`}
          className="avatar-stack-item rounded-full ring-2 ring-white"
        >
          <Avatar name={m.name} pictureUrl={m.pictureUrl} className="size-7 text-xs" />
        </span>
      ))}
      {more > 0 && (
        <span className="avatar-stack-item z-10 flex size-7 items-center justify-center rounded-full bg-sprout-150 text-xs font-bold text-sprout-700 ring-2 ring-white">
          +{more}
        </span>
      )}
    </span>
  );
}
