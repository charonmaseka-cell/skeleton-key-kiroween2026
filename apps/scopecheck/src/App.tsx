import { AppShell, ReviewWorkspace, SampleBanner, useSession } from '@skeleton-key/ui';
import { ComparisonMatrix } from './ComparisonMatrix';
import { scopeCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

const NAV = [
  { href: '#matrix-h', label: 'Comparison' },
  { href: '#confirmed-h', label: 'Review queue' },
  { href: '#ne-h', label: 'Not evaluated' },
  { href: '#docs-h', label: 'Documents and values' },
  { href: '#exp-h', label: 'Export' },
];

export function App() {
  const session = useSession(scopeCheckAdapter, FIXTURES);
  const { fixture, view } = session;
  return (
    <AppShell
      title="ScopeCheck"
      tagline="Compare supplier quotations against an RFQ. Differences are stated only when the values are validated; everything uncertain stays in Needs review."
      banner={<SampleBanner note={fixture.extraction.note} />}
      nav={NAV}
      announcement={session.announcement}
    >
      <section aria-labelledby="set-h" className="space-y-2">
        <h2 id="set-h" className="text-xl font-semibold">
          Sample set
        </h2>
        <label htmlFor="fixture" className="block text-sm font-medium">
          Choose a sample set
        </label>
        <select id="fixture" value={fixture.id} onChange={(e) => session.setFixtureId(e.target.value)} className="rounded border border-slate-700 px-2 py-1">
          {session.fixtures.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title} (sample)
            </option>
          ))}
        </select>{' '}
        <button type="button" onClick={session.reset} className="rounded border border-slate-800 px-3 py-1">
          Reset corrections, decisions and coverage
        </button>
        <p>{fixture.description}</p>
      </section>
      <ReviewWorkspace session={session} baseName={fixture.id}>
        <ComparisonMatrix view={view} />
      </ReviewWorkspace>
    </AppShell>
  );
}
