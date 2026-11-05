import { ClarificationPanel } from './Clarification';
import { useState } from 'react';
import { AppShell, LiveBanner, ReviewWorkspace, SampleBanner, UploadPanel, useSession, type Fixture, type UploadDeps, type UploadSlot } from '@skeleton-key/ui';
import { ComparisonMatrix } from './ComparisonMatrix';
import { scopeCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

const NAV = [
  { href: '#matrix-h', label: 'Comparison' },
  { href: '#confirmed-h', label: 'Review queue' },
  { href: '#ne-h', label: 'Not evaluated' },
  { href: '#docs-h', label: 'Documents and values' },
  { href: '#exp-h', label: 'Export' },
  { href: '#upload', label: 'Analyse your own documents' },
];

/** Document slots for the upload path: one RFQ and up to two quotations (2 to 5 quotations is a later task). */
export const SCOPECHECK_SLOTS: UploadSlot[] = [
  { id: 'rfq', role: 'rfq', label: 'RFQ', schemaId: 'scopecheck.rfq.v1', required: true },
  { id: 'quote-1', role: 'quote', label: 'Quotation 1', schemaId: 'scopecheck.quote.v2', required: true },
  { id: 'quote-2', role: 'quote', label: 'Quotation 2', schemaId: 'scopecheck.quote.v2', required: false },
];

/** Base URL of the extraction Worker, set at build time. Unset means: no analysis service is connected. */
const API_URL = (import.meta.env.VITE_EXTRACTION_API_URL as string | undefined) || undefined;

export function App({ deps, baseUrl = API_URL, fixtures = FIXTURES }: { deps?: UploadDeps; baseUrl?: string; /** the sample sets, first one shown by default */ fixtures?: Fixture[] } = {}) {
  const [live, setLive] = useState<Fixture | null>(null);
  const session = useSession(scopeCheckAdapter, live ? [...fixtures, live] : fixtures);
  const { fixture, view } = session;
  return (
    <AppShell
      title="ScopeCheck"
      tagline="Compare supplier quotations against an RFQ. Differences are stated only when the values are validated; everything uncertain stays in Needs review."
      banner={fixture.sample ? <SampleBanner note={fixture.extraction.note} details={fixture.extraction.details} /> : <LiveBanner note={fixture.extraction.note} />}
      nav={NAV}
      announcement={session.announcement}
      haunt={{ view }}
    >
      <section aria-labelledby="set-h" className="space-y-2">
        <h2 id="set-h" className="text-xl font-semibold">
          Sample set
        </h2>
        <label htmlFor="fixture" className="block text-sm font-medium">
          Choose a sample set
        </label>
        <select id="fixture" value={fixture.id} onChange={(e) => session.setFixtureId(e.target.value)} className="max-w-full rounded border border-sk-border px-2 py-1">
          {session.fixtures.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title} ({f.sample ? 'sample' : 'live'})
            </option>
          ))}
        </select>{' '}
        <button type="button" onClick={session.reset} className="rounded border border-sk-border px-3 py-1">
          Reset corrections, decisions and coverage
        </button>
        {!fixture.sample && (
          <>
            {' '}
            <button type="button" onClick={() => session.setFixtureId(fixtures[0]!.id)} className="rounded border border-sk-border px-3 py-1">
              Back to the sample set
            </button>
          </>
        )}
        <p>{fixture.description}</p>
      </section>
      <ReviewWorkspace key={fixture.id} session={session} baseName={fixture.id}>
        <ComparisonMatrix view={view} />
      </ReviewWorkspace>
      <ClarificationPanel view={view} baseName={fixture.id} />
      <UploadPanel
        idPrefix="scopecheck-upload"
        slots={SCOPECHECK_SLOTS}
        baseUrl={baseUrl}
        deps={deps}
        stageNames={view.voice.stages}
        onResult={(f) => {
          setLive(f);
          session.setFixtureId(f.id);
        }}
      />
    </AppShell>
  );
}
