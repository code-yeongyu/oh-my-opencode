import { afterEach, describe, expect, test } from "bun:test"
import { MemorianGateRunner } from "./memorian-runner"
import { CANDIDATE_PATH, fixture, launchInput, nudgeOnce, roots, runnerOptions, scriptedSession } from "./memorian-runner.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))) })

describe("MemorianGateRunner", () => {
  test("#given a compaction accepted mid-flight #when the child finishes #then the stale nudges are discarded instead of written", async () => {
    // given: the child judged transcript T1; a compaction accepted while it ran rewrote that
    // transcript, so its verdict now advises a conversation that no longer exists.
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const warnings: string[] = []
    let epoch = 7
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, {
      createSession: stub.createSession,
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
    }))

    // when: the epoch advances while the child runs
    const pending = runner.launch(launchInput({
      compactionEpoch: epoch,
      currentCompactionEpoch: () => {
        epoch = 8
        return epoch
      },
    }))
    stub.resolve()
    const result = await pending

    // then
    expect(result.status).toBe("dropped")
    if (result.status === "dropped") expect(result.cause).toBe("compaction")
    expect(warnings).toEqual(["memorian gate nudges dropped after compaction"])
  })

  test("#given an unchanged compaction epoch #when the child finishes #then the result is nudged and carries the validated list", async () => {
    // given
    const { identityPaths } = await fixture()
    const stub = scriptedSession(nudgeOnce)
    const runner = new MemorianGateRunner(runnerOptions(identityPaths, { createSession: stub.createSession }))

    // when
    const pending = runner.launch(launchInput({
      compactionEpoch: 3,
      currentCompactionEpoch: () => 3,
    }))
    stub.resolve()
    const result = await pending

    // then
    expect(result).toMatchObject({
      status: "nudged",
      nudges: [{ path: CANDIDATE_PATH, hint: "Drain nodes before a rollout." }],
    })
  })
})
