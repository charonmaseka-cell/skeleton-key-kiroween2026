import { AppShell } from '@skeleton-key/ui';
import { ENGINE_NAME, ENGINE_VERSION } from '@skeleton-key/engine';

export function App() {
  return (
    <AppShell title="ScopeCheck" tagline="Compare supplier quotations against an RFQ.">
      <p>
        Scaffold only. No document processing yet. Engine: {ENGINE_NAME} v{ENGINE_VERSION}.
      </p>
    </AppShell>
  );
}
