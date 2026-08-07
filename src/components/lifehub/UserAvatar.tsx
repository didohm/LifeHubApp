import { useEffect, useState, memo } from "react";
import { cn } from "@/lib/utils";
import { getCachedPhotoUrl } from "@/lib/photo-cache";

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
 * User avatar that shows the user's real profile photo whenever one exists —
 * instantly, from the persistent photo cache, with NO placeholder flash.
 *
 * - The cached photo URL is resolved synchronously during the first render,
 *   so the real image is on screen immediately after login/app restart.
 * - If a photo URL exists (from Firebase Auth or the Firestore profile), the
 *   actual image is always rendered — the initials monogram is only shown for
 *   users who genuinely have no profile photo at all.
 * - Memoized: identical props skip re-renders entirely (60 FPS friendly).
 */
function UserAvatarImpl({ name, src, alt, className, initialsClassName }: UserAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  // Lazy initializer: synchronously reads the cached photo on first render so
  // the real image appears on the very first frame — no placeholder flicker.
  const [cachedSrc] = useState<string | null>(() => (!src ? getCachedPhotoUrl() : null));

  // Reset image failure state when the photo URL changes
  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  const displaySrc = src || cachedSrc;

  if (displaySrc && !imageFailed) {
    return (
      <img
        src={displaySrc}
        alt={alt || name || "User"}
        className={cn("rounded-full object-cover", className)}
        onError={() => setImageFailed(true)}
        loading="eager"
        // @ts-ignore — fetchPriority attribute
        fetchPriority="high"
        decoding="async"
        draggable={false}
      />
    );
  }

  // Initials monogram — only when no profile photo exists at all.
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

export const UserAvatar = memo(UserAvatarImpl);
