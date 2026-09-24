/**
 * M0 placeholder. The marketing landing page is built in M6, and the dashboard
 * lives behind (app)/[workspace]. This exists so `next build` has a route and
 * so the token system is visible while the backend milestones are underway.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <p className="font-mono text-xs tracking-widest text-(--text-muted) uppercase">
        Foundation · M0
      </p>

      <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-(--text-primary)">
        DevIntel
      </h1>

      <p className="mt-4 text-(--text-secondary)">
        Turns raw development activity — commits, pull requests, reviews, issues — into
        explained, measurable, actionable engineering insight.
      </p>

      <div className="mt-10 rounded-(--radius-md) border bg-(--surface-1) p-5">
        <h2 className="text-sm font-bold text-(--text-primary)">Scaffold in place</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-(--text-secondary)">
          <li>Prisma schema — 28 models, tenant-scoped by construction</li>
          <li>Analytics layer — pure, zero I/O, curve table under test</li>
          <li>Provider interface — seed and GitHub behind one contract</li>
          <li>Express API and BullMQ worker bootstrapped</li>
        </ul>
        <p className="mt-4 text-xs text-(--text-muted)">
          Next: M1 — authentication, workspaces and tenant isolation. See ROADMAP.md.
        </p>
      </div>
    </main>
  );
}
