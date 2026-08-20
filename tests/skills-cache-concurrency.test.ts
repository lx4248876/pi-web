import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Regression gate for the skills-cache cross-cwd isolation bug: a single
// module-level in-flight promise handed a DIFFERENT cwd's scan to a concurrent
// caller and cached it under the wrong key (cross-session skills pollution).
// We alias `@earendil-works/pi-coding-agent` to a stub so we exercise only the
// pending-map/cache logic; each stub loader reports a per-cwd skill name.
const require = createRequire(import.meta.url);
const stubPath = require.resolve("./_skill-loader-stub.cjs");

const { createJiti } = require("jiti");
const jiti = createJiti(pathToFileURL(import.meta.url).href, {
	alias: { "@earendil-works/pi-coding-agent": stubPath },
});

test("skills cache stays isolated per cwd under concurrency", async () => {
	const skills = jiti(
		require.resolve("../lib/skills-cache.ts"),
	) as unknown as typeof import("../lib/skills-cache");
	skills.clearSkillsCache();

	const nameOf = (s: { skills: unknown[] }) => (s.skills[0] as { name: string }).name;

	// Cross-cwd: each cwd must get ITS OWN result, never the other cwd's.
	const [ra, rb] = await Promise.all([
		skills.loadSkillsCached("/tmp/sess/a"),
		skills.loadSkillsCached("/tmp/sess/b"),
	]);
	assert.equal(nameOf(ra), "skill-a", "cwd-a must not receive cwd-b's scan");
	assert.equal(nameOf(rb), "skill-b", "cwd-b must not receive cwd-a's scan");

	// Same-cwd concurrent loads deduplicate but still return the same value.
	const [r1, r2] = await Promise.all([
		skills.loadSkillsCached("/tmp/sess/same"),
		skills.loadSkillsCached("/tmp/sess/same"),
	]);
	assert.equal(nameOf(r1), "skill-same");
	assert.deepEqual(r1, r2);
});