export function SkeletonLoader({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-muted/60 ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <SkeletonLoader className="size-11 rounded-full" />
        <SkeletonLoader className="h-6 w-32" />
        <SkeletonLoader className="size-11 rounded-full" />
      </div>
      <SkeletonLoader className="h-40 w-full rounded-2xl" />
      <div className="flex gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <SkeletonLoader key={i} className="h-16 flex-1 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SkeletonLoader className="h-36 rounded-2xl" />
        <SkeletonLoader className="h-36 rounded-2xl" />
      </div>
    </div>
  );
}

export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card-soft bg-card p-4 border border-border/40 space-y-2">
          <div className="flex justify-between items-center">
            <SkeletonLoader className="h-4 w-32 rounded-md" />
            <SkeletonLoader className="h-4 w-12 rounded-md" />
          </div>
          <SkeletonLoader className="h-3 w-48 rounded-md" />
          <SkeletonLoader className="h-3 w-24 rounded-md" />
        </div>
      ))}
    </div>
  );
}
