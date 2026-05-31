import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="theme-skeleton h-8 w-48" />
          <Skeleton className="theme-skeleton h-10 w-full" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
