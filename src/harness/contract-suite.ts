/**
 * @module harness/contract-suite
 * The shared contract every `HarnessAdapter` must satisfy.
 *
 * This used to live as two hand-copied `describe` blocks, one per vendor, with
 * the same assertions written out twice. That is the failure mode the
 * `HarnessAdapter` interface exists to prevent: a new vendor inherits 300 lines
 * of assertions that may not match what its adapter actually does, and the copy
 * is free to drift from the interface it claims to test.
 *
 * A vendor supplies only a `ContractDriver` — how to build its adapter on top of
 * a fake engine, and what that engine should replay. Every assertion lives here.
 * Vendor behaviour that is genuinely specific (tool-name mapping, error detail
 * extraction, sandbox translation) stays in that vendor's own test file.
 */

import { expect, describe, it } from 'vitest';
import type { HarnessAdapter } from './interface.js';
import type { HarnessEvent, NormalizedUsage, StartSpec } from './types.js';

/** What a vendor's fake engine replays, and what the adapter must make of it. */
export interface ContractScenario {
  /** Session id the engine assigns; the adapter must surface it verbatim. */
  sessionId: string;
  /** Final assistant text the adapter must surface as an `assistant_message`. */
  text: string;
  /** Whether a text delta is expected. Not every vendor streams partial text. */
  streamsTextDeltas?: boolean;
  /** A completed tool call the adapter must surface as `tool_completed`. */
  tool?: { callId: string };
  /** The exact normalized usage the adapter must report for the turn. */
  usage: NormalizedUsage;
}

export interface BlockingTurn {
  adapter: HarnessAdapter;
  /** True once the engine observed the abort. */
  wasAborted: () => boolean;
}

export interface ContractDriver {
  /**
   * The scenario this vendor's fake engine replays. Each driver picks its own,
   * because what a vendor can report differs: Claude reports a dollar cost from
   * the engine, Codex does not, and forcing one expected shape would force a
   * lie in one of the two adapters.
   */
  scenario(): ContractScenario;
  /**
   * Build an adapter wired to a fake engine replaying `scenario`. The fake must
   * behave like the real engine: assign a session id, emit content, then finish
   * the turn with the scenario's usage.
   */
  create(scenario: ContractScenario): HarnessAdapter;
  /**
   * Build an adapter whose turn blocks until aborted, so `interrupt()` can be
   * observed at the engine boundary rather than inferred from adapter internals.
   */
  createBlockingTurn(prompt?: string): BlockingTurn;
  /** Extra start options the vendor needs, e.g. credentials in `env`. */
  startSpec?: Partial<StartSpec>;
}

function startSpec(driver: ContractDriver, prompt: string): StartSpec {
  return {
    prompt,
    workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
    ...driver.startSpec,
  } as StartSpec;
}

async function collectUntil(handle: { events: AsyncIterable<HarnessEvent> }, stop: (event: HarnessEvent) => boolean): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of handle.events) {
    events.push(event);
    if (stop(event)) break;
  }
  return events;
}

export function assertHarnessContract(vendor: string, driver: ContractDriver): void {
  describe(`${vendor} adapter contract`, () => {
    it('resolves the lazy session id and reports the engine-assigned one', async () => {
      const scenario = driver.scenario();
      const handle = await driver.create(scenario).start(startSpec(driver, 'Say hello'));

      // Lazy by contract: the id arrives mid-stream, not from start().
      await expect(handle.sessionId()).resolves.toBe(scenario.sessionId);
      await handle.dispose();
    });

    it('announces the session before any turn content', async () => {
      const scenario = driver.scenario();
      const handle = await driver.create(scenario).start(startSpec(driver, 'Say hello'));
      const events = await collectUntil(handle, (event) => event.type === 'turn_completed');

      const started = events.findIndex((event) => event.type === 'session_started');
      expect(started, 'no session_started event was emitted').toBeGreaterThanOrEqual(0);
      expect(events[started]).toEqual({ type: 'session_started', sessionId: scenario.sessionId });
      const firstContent = events.findIndex(
        (event) => event.type === 'text_delta' || event.type === 'assistant_message' || event.type === 'tool_completed',
      );
      expect(firstContent, 'the turn produced no content events').toBeGreaterThan(started);
      await handle.dispose();
    });

    it('normalizes the assistant text', async () => {
      const scenario = driver.scenario();
      const handle = await driver.create(scenario).start(startSpec(driver, 'Say hello'));
      const events = await collectUntil(handle, (event) => event.type === 'turn_completed');

      expect(events).toContainEqual({ type: 'assistant_message', text: scenario.text });
      if (scenario.streamsTextDeltas) {
        expect(events).toContainEqual({ type: 'text_delta', text: scenario.text });
      }
      await handle.dispose();
    });

    it('normalizes a completed tool call with its id and outcome', async () => {
      const scenario = { ...driver.scenario(), tool: { callId: `${vendor}-call-1` } };
      const handle = await driver.create(scenario).start(startSpec(driver, 'Use a tool'));
      const events = await collectUntil(handle, (event) => event.type === 'turn_completed');

      expect(events).toContainEqual({
        type: 'tool_completed',
        callId: scenario.tool.callId,
        ok: true,
        outputSummary: undefined,
      });
      await handle.dispose();
    });

    it('normalizes token usage and classifies cost confidence', async () => {
      const scenario = driver.scenario();
      const handle = await driver.create(scenario).start(startSpec(driver, 'Say hello'));
      const events = await collectUntil(handle, (event) => event.type === 'turn_completed');

      const completed = events.find((event) => event.type === 'turn_completed');
      expect(completed, 'the turn never completed').toBeDefined();
      const usage = (completed as { usage: NormalizedUsage }).usage;
      expect(usage).toEqual(scenario.usage);
      // Universal across vendors, unlike the exact cost fields: the engine's
      // token counts survive normalization, and a cost is never claimed without
      // saying how confident the adapter is about it.
      expect(usage.inputTokens).toBeGreaterThan(0);
      expect(usage.outputTokens).toBeGreaterThan(0);
      expect(['authoritative', 'estimated', 'absent']).toContain(usage.costConfidence);
      if (usage.costConfidence === 'absent') expect(usage.costUsdEstimate).toBeUndefined();
      await handle.dispose();
    });

    it('aborts an in-flight turn on interrupt(), observed at the engine', async () => {
      const { adapter, wasAborted } = driver.createBlockingTurn('Long running task');
      const handle = await adapter.start(startSpec(driver, 'Long running task'));

      await handle.interrupt();
      expect(wasAborted()).toBe(true);
      await handle.dispose();
    });

    it('terminates the event stream on dispose', async () => {
      const scenario = driver.scenario();
      const handle = await driver.create(scenario).start(startSpec(driver, 'Say hello'));
      await collectUntil(handle, (event) => event.type === 'turn_completed');

      await handle.dispose();
      // The contract is that the stream ends: a further iteration finishes
      // rather than hanging, which is the leak this assertion exists to catch.
      const rest: HarnessEvent[] = [];
      for await (const event of handle.events) rest.push(event);
      expect(rest).toEqual([]);
    });
  });
}
