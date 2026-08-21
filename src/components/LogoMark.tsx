export function LogoMark() {
  return (
    <div className="relative h-11 w-11 overflow-hidden rounded-2xl bg-slate-950 shadow-[0_16px_40px_rgba(15,23,42,0.28)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.95),_transparent_42%),linear-gradient(135deg,_#1f4fff,_#0f172a_72%)]" />
      <div className="absolute inset-2 rounded-xl border border-white/15" />
      <div className="absolute bottom-2 left-2 h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.95)]" />
      <div className="absolute right-2 top-2 h-4 w-4 rounded-full border border-white/50" />
    </div>
  );
}
