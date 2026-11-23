import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading leaderboard">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-16 w-full" />
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
