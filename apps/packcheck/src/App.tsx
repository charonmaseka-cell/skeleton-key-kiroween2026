import { AppShell, ReviewWorkspace, SampleBanner, useSession } from '@skeleton-key/ui';
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
];

export function App() {
  const session = useSession(packCheckAdapter, FIXTURES);
  const { fixture, view } = session;
  return (
    <AppShell
      title="PackCheck"
      tagline="Check a grant application pack for missing attachments and inconsistent values. Ambiguous or unsupported values are held for you, never guessed."
      banner={<SampleBanner note={fixture.extraction.note} />}
      nav={NAV}
      announcement={session.announcement}
    >
      <section aria-labelledby="set-h" className="space-y-2">
        <h2 id="set-h" className="text-xl font-semibold">
          Sample pack
        </h2>
        <p>
          <strong>{fixture.title}</strong> (sample). {fixture.description}
        </p>
        <button type="button" onClick={session.reset} className="rounded border border-slate-800 px-3 py-1">
          Reset corrections, decisions and coverage
        </button>
      </section>
      <ReviewWorkspace session={session} baseName={fixture.id}>
        <Checks view={view} />
      </ReviewWorkspace>
    </AppShell>
  );
}
