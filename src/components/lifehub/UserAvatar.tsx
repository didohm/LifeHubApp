import { useState } from "react";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  name?: string | null;
  src?: string | null;
  alt?: string;
  className?: string;
  initialsClassName?: string;
}

function getInitials(name?: string | null): string {
  return (name || "?")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * User avatar that shows the user's real photo when available and falls back
 * to an initials monogram — never a generic person placeholder image.
 */
export function UserAvatar({ name, src, alt, className, initialsClassName }: UserAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);

  const displaySrc = src || "/illustration/default-avatar.png";

  if (displaySrc && !imageFailed) {
    const isDefault = !src;
    return (
      <img
        src={displaySrc}
        alt={alt || name || "User"}
        className={cn(
          "rounded-full",
          isDefault
            ? "object-contain bg-gradient-to-br from-[#E8E2FF] to-[#D5C9FF] p-0.5"
            : "object-cover",
          className,
        )}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={alt || name || "User"}
      className={cn(
        "flex items-center justify-center rounded-full bg-[#7C5CFC] text-white font-extrabold select-none",
        initialsClassName,
        className,
      )}
    >
      {getInitials(name)}
    </div>
  );
}
