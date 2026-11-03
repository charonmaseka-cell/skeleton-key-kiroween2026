import { StatusBadge } from './Badges';

// The stages of an analysis, in order, each with a plain state: reading (on your device), extracting (the AI service), matching and
// checking (on your device, with the results). Text, never colour alone. A stage that did not happen says why.

export type StageId = 'reading' | 'extracting' | 'matching' | 'checking';
export type StageState = 'waiting' | 'active' | 'done' | 'stopped' | 'not_run';
export type Stage = { id: StageId; state: StageState; detail?: string };

export const STAGE_LABEL: Record<StageId, string> = { reading: 'Reading', extracting: 'Extracting', matching: 'Matching', checking: 'Checking' };
const STAGE_WHAT: Record<StageId, string> = {
  reading: 'your documents are read on your device',
  extracting: 'the AI service reads the extracted text, part by part',
  matching: 'values are matched across the documents, on your device',
  checking: 'the rules check the matched values, on your device',
};
const STATE_TEXT: Record<StageState, string> = { waiting: 'Waiting', active: 'In progress', done: 'Done', stopped: 'Stopped', not_run: 'Not run' };

export const initialStages = (): Stage[] => (['reading', 'extracting', 'matching', 'checking'] as StageId[]).map((id) => ({ id, state: 'waiting' as StageState }));

export function setStage(stages: Stage[], id: StageId, state: StageState, detail?: string): Stage[] {
  return stages.map((s) => (s.id === id ? { id, state, detail } : s));
}

export function ProgressView({ stages }: { stages: Stage[] }) {
  return (
    <section aria-label="Analysis progress" data-progress="" className="space-y-1">
      <h3 className="font-medium">Progress</h3>
      <ol className="space-y-1">
        {stages.map((s, i) => (
          <li key={s.id} data-stage={s.id} data-state={s.state} aria-current={s.state === 'active' ? 'step' : undefined}>
            <span className="font-medium">
              {i + 1}. {STAGE_LABEL[s.id]}
            </span>{' '}
            <StatusBadge kind={s.state === 'done' ? 'validated' : s.state === 'active' ? 'open' : s.state === 'stopped' ? 'needs_review' : 'not_evaluated'} label={STATE_TEXT[s.state]} />{' '}
            <span className="text-sm">{s.detail ?? STAGE_WHAT[s.id]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
