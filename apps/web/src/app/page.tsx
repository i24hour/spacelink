import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background to-muted px-6 text-center">
      <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">DeadlineAI</h1>
      <p className="mt-4 max-w-lg text-lg text-muted-foreground">
        An AI memory system for internet opportunities. Save any page. We extract deadlines and remind you intelligently.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/dashboard">
          <Button size="lg">Go to Dashboard</Button>
        </Link>
      </div>
    </main>
  );
}
