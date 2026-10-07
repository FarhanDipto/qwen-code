/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import {
  uiTelemetryService,
  type SessionMetrics,
} from '@qwen-code/qwen-code-core/telemetry/uiTelemetry.js';
import { StreamingState, type HistoryItemWithoutId } from '../types.js';

interface TokenSnapshot {
  input: number;
  output: number;
  cached: number;
  total: number;
  requests: number;
}

function readTokens(metrics: SessionMetrics): TokenSnapshot {
  const acc: TokenSnapshot = {
    input: 0,
    output: 0,
    cached: 0,
    total: 0,
    requests: 0,
  };

  // `statsModels` is the provider-normalized view: it reconstructs a total for
  // providers that report none (DeepSeek and most OpenAI-compatible APIs) and
  // avoids double-counting reasoning tokens those APIs fold into output.
  // It only exists on per-session buckets; the global bucket falls back to
  // the raw `models` view.
  const normalized = metrics.statsModels;
  const buckets = normalized
    ? Object.values(normalized)
    : Object.values(metrics.models);

  for (const bucket of buckets) {
    acc.input += bucket.tokens.prompt;
    acc.output += bucket.tokens.candidates;
    acc.cached += bucket.tokens.cached;
    acc.total += bucket.tokens.total;
    acc.requests += bucket.api.totalRequests;
  }

  if (!normalized && acc.total === 0) {
    acc.total = acc.input + acc.output;
  }
  return acc;
}

interface TurnBaseline {
  sessionId: string;
  session: TokenSnapshot;
  global: TokenSnapshot;
  startedAt: number;
}

/**
 * Appends a dim one-line token report to history when a turn finishes.
 *
 * Deltas are taken against a baseline captured on the Idle -> active
 * transition, so the line reflects one turn, not the session. Subagent spend
 * is included: every content generator logs its API responses under the
 * session that owns it.
 */
export function useTurnTokenLog({
  config,
  streamingState,
  addItem,
  enabled = true,
}: {
  config: { getSessionId(): string };
  streamingState: StreamingState;
  addItem: (item: HistoryItemWithoutId, baseTimestamp: number) => unknown;
  enabled?: boolean;
}): void {
  const baseline = useRef<TurnBaseline | null>(null);

  useEffect(() => {
    if (!enabled) return;

    if (streamingState !== StreamingState.Idle) {
      // Responding and WaitingForConfirmation are both mid-turn; latch only
      // on the first transition out of Idle so a tool confirmation doesn't
      // reset the baseline.
      if (baseline.current === null) {
        const sessionId = config.getSessionId();
        baseline.current = {
          sessionId,
          session: readTokens(
            uiTelemetryService.getMetricsForSession(sessionId),
          ),
          global: readTokens(uiTelemetryService.getMetrics()),
          startedAt: Date.now(),
        };
      }
      return;
    }

    const start = baseline.current;
    baseline.current = null;
    if (!start) return;

    const sessionId = config.getSessionId();
    // The session swapped mid-turn (/clear, /resume, /branch): a delta
    // across two different buckets is meaningless, so skip this turn.
    if (sessionId !== start.sessionId) return;

    const sessionEnd = readTokens(
      uiTelemetryService.getMetricsForSession(sessionId),
    );

    // Prefer the per-session bucket (normalized, immune to other sessions).
    // If this build logs events without a session id, that bucket stays
    // empty, so fall back to the process-wide bucket. Both ends of the delta
    // always come from the same source.
    const useSession = sessionEnd.requests > start.session.requests;
    const from = useSession ? start.session : start.global;
    const to = useSession
      ? sessionEnd
      : readTokens(uiTelemetryService.getMetrics());

    const requests = to.requests - from.requests;
    // Local-only turns (slash commands handled without the model) bill nothing.
    if (requests <= 0) return;

    addItem(
      {
        type: 'turn_tokens',
        turnInput: to.input - from.input,
        turnOutput: to.output - from.output,
        turnCached: to.cached - from.cached,
        turnTotal: to.total - from.total,
        sessionTotal: to.total,
        contextTokens: uiTelemetryService.getLastPromptTokenCount(),
        requests,
        durationMs: Date.now() - start.startedAt,
      },
      Date.now(),
    );
  }, [streamingState, config, addItem, enabled]);
}
