import { TopNav } from "@/components/TopNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="px-4 md:px-8 pt-6 pb-2 max-w-6xl mx-auto w-full">
        <div className="text-[11px] font-semibold tracking-[0.2em] text-muted">WATCON INTERNATIONAL</div>
        <h1 className="text-3xl font-bold leading-tight">Conveyance Tracker</h1>
      </header>
      <TopNav />
      <main className="flex-1 min-w-0 px-4 md:px-8 py-6 max-w-6xl mx-auto w-full">{children}</main>
    </div>
  );
}
