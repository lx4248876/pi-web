import type {
    AssistantMessage,
    AgentMessage,
    ToolCallContent,
    ToolResultMessage,
} from "@/lib/types";

/** Explicit write-to-disk tools emitted by the pi coding-agent. */
export const ARTIFACT_TOOL_NAMES = new Set<string>(["write", "edit"]);

/**
 * Extract the disk file paths written by write/edit tool calls within a single
 * turn segment of messages. Pure, side-effect free.
 *
 * - Only assistant `toolCall` content blocks whose toolName is a write tool.
 * - A path comes from `input.file_path ?? input.path`; non-string values (or a
 *   missing file_path/path) are skipped.
 * - A write whose corresponding toolResult message has `isError: true`
 *   (Boolean) is excluded.
 * - Deduped by path, preserving first-seen order.
 */
export function extractArtifacts(turnMessages: AgentMessage[]): string[] {
    const failedToolCallIds = new Set<string>();
    for (const msg of turnMessages) {
        if (msg.role === "toolResult" && Boolean((msg as ToolResultMessage).isError)) {
            failedToolCallIds.add((msg as ToolResultMessage).toolCallId);
        }
    }

    const seen = new Set<string>();
    const result: string[] = [];
    for (const msg of turnMessages) {
        if (msg.role !== "assistant") continue;
        const content = (msg as AssistantMessage).content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
            if (block.type !== "toolCall") continue;
            const tc = block as ToolCallContent;
            if (!ARTIFACT_TOOL_NAMES.has(tc.toolName)) continue;
            if (failedToolCallIds.has(tc.toolCallId)) continue;
            const raw = tc.input.file_path ?? tc.input.path;
            if (typeof raw !== "string") continue;
            if (seen.has(raw)) continue;
            seen.add(raw);
            result.push(raw);
        }
    }
    return result;
}

export interface ArtifactRef {
    path: string;
    name: string;
}

/**
 * Order a turn's artifacts for a bulk tab-open: keep every non-active file
 * first (original order), and move the clicked (active) file to the end so the
 * file viewer activates it. When the active path isn't present, the original
 * order is returned unchanged.
 */
export function orderedArtifactOpen(
    artifacts: ArtifactRef[],
    activePath: string,
): ArtifactRef[] {
    const others = artifacts.filter((a) => a.path !== activePath);
    const active = artifacts.find((a) => a.path === activePath);
    if (!active) return artifacts;
    return [...others, active];
}