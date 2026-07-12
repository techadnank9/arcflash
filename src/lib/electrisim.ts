export type ElectrisimSessionState =
  | 'idle'
  | 'starting'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'interrupted'
  | string;

export interface ElectrisimSession {
  id: string;
  state: ElectrisimSessionState;
  agentViewUrl?: string;
  currentUrl?: string;
  summary?: string;
  screenshotUrl?: string;
  workflow?: ElectrisimWorkflow;
}

export interface ElectrisimWorkflow {
  id: string;
  target: string;
  mode: string;
  allowedOrigins: string[];
  checkpoints: Array<{ id: string; label: string }>;
}

export interface ElectrisimBrowserEvent {
  key: string;
  timestamp?: string;
  kind: 'observation' | 'action' | 'status';
  label: string;
  detail?: string;
  currentUrl?: string;
  screenshotUrl?: string;
}

export interface ElectrisimChanges {
  events: ElectrisimBrowserEvent[];
  answer?: string;
  state?: string;
  nextIndex: number;
}

export interface ArcFlashValidation {
  arcing_current_ka: number | null;
  incident_energy_cal_cm2: number | null;
  arc_flash_boundary_in: number | null;
}

export interface ElectrisimCalculationResult {
  equipment_id: string;
  pandapower_bolted_fault_ka: number | null;
  arcflash_validation: ArcFlashValidation;
  verification_status: string;
}

export interface ElectrisimCalculation {
  schema_version: string;
  generated_at: string;
  project: string;
  study_case: string;
  engines: {
    short_circuit: string;
    arc_flash: string;
  };
  disclaimer: string;
  results: ElectrisimCalculationResult[];
}

const TERMINAL_STATES = new Set([
  'completed',
  'failed',
  'timed_out',
  'interrupted',
  'cancelled',
  'canceled',
]);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const firstString = (...values: unknown[]): string | undefined => values.find(
  (value): value is string => typeof value === 'string' && value.trim().length > 0,
);

function answerText(value: unknown, depth = 0): string | undefined {
  if (typeof value === 'string') return firstString(value);
  if (!isRecord(value) || depth > 2) return undefined;
  return firstString(
    value.answer,
    value.content,
    value.text,
    value.message,
    value.summary,
    value.final_answer,
    answerText(value.output, depth + 1),
    answerText(value.result, depth + 1),
  );
}

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  return isRecord(value[key]) ? value[key] : undefined;
}

function safeImageUrl(value: unknown, type?: unknown, mediaType?: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  if (type === 'base64') {
    const safeMediaType = typeof mediaType === 'string' && /^image\/(png|jpeg|webp)$/i.test(mediaType)
      ? mediaType.toLowerCase()
      : 'image/png';
    return `data:${safeMediaType};base64,${value}`;
  }
  if (value.startsWith('data:image/png;base64,')
    || value.startsWith('data:image/jpeg;base64,')
    || value.startsWith('data:image/webp;base64,')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function imageFromRecord(value: unknown): string | undefined {
  if (typeof value === 'string') return safeImageUrl(value);
  if (!isRecord(value)) return undefined;
  const source = isRecord(value.source) ? value.source : undefined;
  return safeImageUrl(
    typeof value.source === 'string' ? value.source : source?.url ?? source?.data,
    value.type ?? source?.type,
    value.media_type ?? value.mediaType ?? source?.media_type ?? source?.mediaType,
  );
}

function sessionState(value: unknown, depth = 0): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (!isRecord(value) || depth > 4) return undefined;
  return sessionState(value.status, depth + 1) ?? sessionState(value.state, depth + 1);
}

function normalizeWorkflow(value: unknown): ElectrisimWorkflow | undefined {
  if (!isRecord(value)) return undefined;
  const id = firstString(value.id);
  const target = firstString(value.target);
  if (!id || !target) return undefined;
  const checkpoints = Array.isArray(value.checkpoints)
    ? value.checkpoints.flatMap((checkpoint): Array<{ id: string; label: string }> => {
      if (!isRecord(checkpoint)) return [];
      const checkpointId = firstString(checkpoint.id);
      const label = firstString(checkpoint.label);
      return checkpointId && label ? [{ id: checkpointId, label }] : [];
    })
    : [];
  return {
    id,
    target,
    mode: firstString(value.mode) ?? 'public-unsaved-draw',
    allowedOrigins: Array.isArray(value.allowedOrigins)
      ? value.allowedOrigins.filter((origin): origin is string => typeof origin === 'string')
      : [],
    checkpoints,
  };
}

export function normalizeElectrisimSession(
  payload: unknown,
  fallbackId?: string,
  fallbackState: ElectrisimSessionState = 'running',
): ElectrisimSession | null {
  if (!isRecord(payload)) return fallbackId ? { id: fallbackId, state: fallbackState } : null;

  const session = nestedRecord(payload, 'session');
  const result = nestedRecord(payload, 'result');
  const output = nestedRecord(payload, 'output');
  const status = nestedRecord(payload, 'status');
  const observation = nestedRecord(payload, 'latest_observation') ?? nestedRecord(payload, 'observation');
  const id = firstString(
    payload.id,
    payload.session_id,
    payload.sessionId,
    session?.id,
    fallbackId,
  );
  if (!id) return null;

  return {
    id,
    state: sessionState(payload) ?? sessionState(session) ?? fallbackState,
    agentViewUrl: firstString(
      payload.agent_view_url,
      payload.agentViewUrl,
      session?.agent_view_url,
      session?.agentViewUrl,
    ),
    currentUrl: firstString(
      payload.current_url,
      payload.currentUrl,
      session?.current_url,
      session?.currentUrl,
      result?.current_url,
      result?.currentUrl,
    ),
    summary: firstString(
      answerText(payload.latest_answer),
      answerText(payload.answer),
      payload.final_summary,
      payload.finalSummary,
      payload.summary,
      result?.final_summary,
      result?.finalSummary,
      result?.summary,
      result?.answer,
      result?.message,
      typeof payload.output === 'string' ? payload.output : undefined,
      output?.final_summary,
      output?.summary,
      output?.answer,
      status?.message,
    ),
    screenshotUrl: firstString(
      imageFromRecord(payload.screenshot),
      imageFromRecord(payload.image),
      imageFromRecord(session?.screenshot),
      imageFromRecord(session?.image),
      imageFromRecord(observation?.image),
    ),
    workflow: normalizeWorkflow(payload.workflow) ?? normalizeWorkflow(session?.workflow),
  };
}

export function isTerminalElectrisimState(state: string): boolean {
  return TERMINAL_STATES.has(state.toLowerCase());
}

export function readElectrisimApiError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  const detail = nestedRecord(payload, 'detail');
  return firstString(detail?.message, payload.message, payload.code) ?? fallback;
}

function compactText(value: unknown, limit = 180): string | undefined {
  if (typeof value !== 'string') return undefined;
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

function describeToolRequest(value: unknown): string | undefined {
  const requests = Array.isArray(value) ? value : value === undefined ? [] : [value];
  for (const request of requests) {
    if (typeof request === 'string') return compactText(request);
    if (!isRecord(request)) continue;
    const action = nestedRecord(request, 'action');
    const args = nestedRecord(request, 'arguments') ?? nestedRecord(request, 'args');
    const description = firstString(
      request.description,
      request.text,
      request.name,
      request.tool,
      request.tool_name,
      action?.description,
      action?.name,
      action?.type,
    );
    const target = firstString(
      request.selector,
      request.target,
      args?.selector,
      args?.target,
      args?.text,
      args?.element,
      args?.url,
      action?.target,
    );
    if (description) return compactText(target ? `${description} · ${target}` : description);
  }
  return undefined;
}

const eventLabel = (kind: string): string => {
  if (kind === 'observation_event') return 'Browser observation';
  if (kind === 'policy_event') return 'Browser action';
  return kind.replace(/_event$/i, '').replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
};

export function normalizeElectrisimChanges(payload: unknown, fromIndex = 0): ElectrisimChanges {
  if (!isRecord(payload)) return { events: [], nextIndex: fromIndex };
  const rawEvents = Array.isArray(payload.new_events) ? payload.new_events : [];
  const events = rawEvents.flatMap((rawEvent, offset): ElectrisimBrowserEvent[] => {
    if (!isRecord(rawEvent)) return [];
    const data = nestedRecord(rawEvent, 'data') ?? rawEvent;
    const metadata = nestedRecord(data, 'metadata');
    const kind = firstString(data.kind, rawEvent.type) ?? 'status_event';
    const currentUrl = firstString(metadata?.url, data.url, rawEvent.url);
    const screenshotUrl = imageFromRecord(data.image) ?? imageFromRecord(rawEvent.image);
    const actionDetail = describeToolRequest(data.tool_reqs ?? data.tool_call ?? data.tool_calls);
    const detail = compactText(firstString(
      actionDetail,
      data.text,
      data.message,
      metadata?.title,
      currentUrl,
    ));
    const timestamp = firstString(rawEvent.timestamp, data.timestamp);
    const key = firstString(rawEvent.id, rawEvent.event_id)
      ?? `${fromIndex + offset}:${timestamp ?? ''}:${kind}:${detail ?? ''}`;
    return [{
      key,
      timestamp,
      kind: kind === 'observation_event' ? 'observation' : kind === 'policy_event' ? 'action' : 'status',
      label: eventLabel(kind),
      detail,
      currentUrl,
      screenshotUrl,
    }];
  });
  const explicitNextIndex = typeof payload.next_index === 'number' && Number.isFinite(payload.next_index)
    ? payload.next_index
    : undefined;
  return {
    events,
    answer: compactText(firstString(
      answerText(payload.answer),
      answerText(payload.latest_answer),
      answerText(payload.final_answer),
      payload.summary,
    ), 800),
    state: sessionState(payload),
    nextIndex: explicitNextIndex ?? fromIndex + rawEvents.length,
  };
}

const nullableNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

export function normalizeElectrisimCalculation(payload: unknown): ElectrisimCalculation | null {
  if (!isRecord(payload)) return null;
  const engines = nestedRecord(payload, 'engines');
  if (!Array.isArray(payload.results) || !engines) return null;

  const results = payload.results.flatMap((item): ElectrisimCalculationResult[] => {
    if (!isRecord(item)) return [];
    const validation = nestedRecord(item, 'arcflash_validation');
    const equipmentId = firstString(item.equipment_id);
    if (!equipmentId || !validation) return [];
    return [{
      equipment_id: equipmentId,
      pandapower_bolted_fault_ka: nullableNumber(item.pandapower_bolted_fault_ka),
      arcflash_validation: {
        arcing_current_ka: nullableNumber(validation.arcing_current_ka),
        incident_energy_cal_cm2: nullableNumber(validation.incident_energy_cal_cm2),
        arc_flash_boundary_in: nullableNumber(validation.arc_flash_boundary_in),
      },
      verification_status: firstString(item.verification_status) ?? 'comparison_only',
    }];
  });

  const project = firstString(payload.project);
  const studyCase = firstString(payload.study_case);
  const shortCircuit = firstString(engines.short_circuit);
  const arcFlash = firstString(engines.arc_flash);
  if (!project || !studyCase || !shortCircuit || !arcFlash || results.length === 0) return null;

  return {
    schema_version: firstString(payload.schema_version) ?? 'unknown',
    generated_at: firstString(payload.generated_at) ?? '',
    project,
    study_case: studyCase,
    engines: { short_circuit: shortCircuit, arc_flash: arcFlash },
    disclaimer: firstString(payload.disclaimer) ?? 'Comparison output requires qualified engineer review.',
    results,
  };
}
