import { existsSync } from "fs";
import { parseAgentNewRequest, type AgentNewRequest } from "./agent-new-request";
import type { AgentSessionWrapper } from "./rpc-manager";

export type StartRpcSession = (
	sessionId: string,
	sessionFile: string,
	cwd: string,
	toolNames?: string[],
) => Promise<{ session: AgentSessionWrapper; realSessionId: string }>;

export async function createNewAgentSession(
	body: AgentNewRequest,
	startRpcSession: StartRpcSession,
) {
	const { cwd, provider, modelId, toolNames, thinkingLevel, promptCommand } =
		parseAgentNewRequest(body);

	if (!cwd) {
		return { status: 400, body: { error: "cwd is required" } };
	}
	if (!existsSync(cwd)) {
		return {
			status: 400,
			body: { error: `Directory does not exist: ${cwd}` },
		};
	}

	const tempKey = `__new__${Date.now()}`;
	const { session, realSessionId } = await startRpcSession(
		tempKey,
		"",
		cwd,
		toolNames,
	);

	globalThis.__piAllowedRootsCache?.roots.add(cwd);

	if (provider && modelId) {
		await session.send({ type: "set_model", provider, modelId });
	}

	if (thinkingLevel) {
		await session.send({ type: "set_thinking_level", level: thinkingLevel });
	}

	const result = promptCommand ? await session.send(promptCommand) : null;
	return {
		status: 200,
		body: { success: true, sessionId: realSessionId, data: result },
	};
}
