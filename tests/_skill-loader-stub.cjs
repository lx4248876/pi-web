// CommonJS test double for @earendil-works/pi-coding-agent used by the
// skills-cache concurrency test. Each loader reports a per-cwd skill name so we
// can prove caching/scans are isolated per cwd and never share a wrong scan
// across sessions.
"use strict";
const scans = [];
function delay(ms) {
	return new Promise((r) => setTimeout(r, ms));
}
class DefaultResourceLoader {
	constructor({ cwd }) {
		this.cwd = cwd;
	}
	async reload() {
		scans.push(this.cwd);
		await delay(5);
		return this;
	}
	getSkills() {
		const label = this.cwd.split("/").pop();
		return {
			skills: [{ name: `skill-${label}` }],
			diagnostics: [],
		};
	}
}
module.exports = {
	DefaultResourceLoader,
	getAgentDir: () => "/fake/agent-dir",
	__scanLog: () => scans,
};