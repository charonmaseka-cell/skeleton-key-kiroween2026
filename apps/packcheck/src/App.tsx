import { useState } from 'react';
import { AppShell, LiveBanner, ReviewWorkspace, SampleBanner, UploadPanel, useSession, type Fixture, type UploadDeps, type UploadSlot } from '@skeleton-key/ui';
import { Checks } from './Checks';
import { packCheckAdapter } from './adapter';
import { FIXTURES } from './fixtures';

const NAV = [
  { href: '#attach-h', label: 'Attachment checks' },
  { href: '#fields-h', label: 'Field checks' },
  { href: '#confirmed-h', label: 'Review queue' },
  { href: '#ne-h', label: 'Not evaluated' },
  { href: '#docs-h', label: 'Documents and values' },
  { href: '#exp-h', label: 'Export' },
  { href: '#upload', label: 'Analyse your own documents' },
];

/**
 * Document slots for the upload path. The slot id is the document id and its role, which the PackCheck adapter reads:
 * a pack needs the requirements and the application form; the budget and registration documents are optional.
 * All slots use the one pack profile (packcheck.grant.v2, chosen by the 2026-11-01 benchmark).
 */
export const PACKCHECK_SLOTS: UploadSlot[] = [
  { id: 'requirements', role: 'requirements', label: 'Application requirements', schemaId: 'packcheck.grant.v2', required: true },
  { id: 'application-form', role: 'application-form', label: 'Application form', schemaId: 'packcheck.grant.v2', required: true },
  { id: 'budget', role: 'budget', label: 'Budget summary', schemaId: 'packcheck.grant.v2', required: false },
  { id: 'registration', role: 'registration', label: 'Registration certificate', schemaId: 'packcheck.grant.v2', required: false },
];

/** Base URL of the extraction Worker, set at build time. Unset means: no analysis service is connected. */
const API_URL = (import.meta.env.VITE_EXTRACTION_API_URL as string | undefined) || undefined;

export function App({ deps, baseUrl = API_URL }: { deps?: UploadDeps; baseUrl?: string } = {}) {
  const [live, setLive] = useState<Fixture | null>(null);
  const session = useSession(packCheckAdapter, live ? [...FIXTURES, live] : FIXTURES);
  const { fixture, view } = session;
  return (
    <AppShell
      title="PackCheck"
      tagline="Check a grant application pack for missing attachments and inconsistent values. Ambiguous or unsupported values are held for you, never guessed."
      banner={fixture.sample ? <SampleBanner note={fixture.extraction.note} /> : <LiveBanner note={fixture.extraction.note} />}
      nav={NAV}
      announcement={session.announcement}
    >
      <section aria-labelledby="set-h" className="space-y-2">
        <h2 id="set-h" className="text-xl font-semibold">
          {fixture.sample ? 'Sample pack' : 'Your pack'}
        </h2>
        <p>
          <strong>{fixture.title}</strong> ({fixture.sample ? 'sample' : 'live'}). {fixture.description}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={session.reset} className="rounded border border-slate-800 px-3 py-1">
            Reset corrections, decisions and coverage
          </button>
          {!fixture.sample && (
            <button type="button" onClick={() => session.setFixtureId(FIXTURES[0]!.id)} className="rounded border border-slate-800 px-3 py-1">
              Back to the sample pack
            </button>
          )}
        </div>
      </section>
      <ReviewWorkspace key={fixture.id} session={session} baseName={fixture.id}>
        <Checks view={view} />
      </ReviewWorkspace>
      <UploadPanel
        idPrefix="packcheck-upload"
        slots={PACKCHECK_SLOTS}
        baseUrl={baseUrl}
        deps={deps}
        onResult={(f) => {
          setLive(f);
          session.setFixtureId(f.id);
        }}
      />
    </AppShell>
  );
}
