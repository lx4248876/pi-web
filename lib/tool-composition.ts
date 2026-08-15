// Pure helpers for composing the "active tool set" of a pi session.
//
// pi-web lets the user pick a built-in tool *preset* (Off / Low / High), which
// only describes the built-in coding tools (read/bash/edit/write/grep/find/ls).
// But the session also has *extension* tools (subagent, pi-lens, ...) registered
// by installed packages, plus one UI-compat ask-the-user tool pi-web injects
// itself (a single tool named `question`).
//
// Those extension tools must stay available regardless of the preset — otherwise
// features like subagent delegation silently stop working. The only case where
// we disable everything (extensions included) is the "Off" preset, which is the
// user explicitly asking for a fully tool-less agent.
//
// Kept in its own module so it is unit-testable without loading the import-heavy
// rpc-manager (which pulls in the pi SDK and Next.js internals).

// The single ask-the-user tool pi-web exposes.
//
// pi-web needs to directly "ask the user" from inside a web session. The backend
// running the model only exposes this under one name, `question`, and pi-web
// injects exactly one working implementation for it (see createCompatUiTools in
// rpc-manager.ts). Keep this list to exactly one entry: any extra alias would
// show up as a duplicate "ask user" tool to the model.
export const COMPAT_UI_TOOL_NAMES = ["question"] as const;

// The seven built-in coding tools pi-web exposes via presets.
export const CODING_TOOL_NAMES = [
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
] as const;

// Every tool name that is NOT user-toggled via a preset. Used to separate
// "extension tool" (auto-included) from "built-in / UI-compat" (preset-driven).
export const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
    ...CODING_TOOL_NAMES,
    ...COMPAT_UI_TOOL_NAMES,
]);

// Minimal shape of the SDK's ToolInfo — we only need the name.
type ToolLike = { name: string };

/**
 * Return the names of extension tools present in a registry snapshot.
 *
 * Extension tools are everything that is neither a built-in coding tool nor a
 * pi-web UI-compat tool (e.g. "subagent", "pi-lens", "TodoWrite"). They are
 * discovered from the live registry (AgentSession.getAllTools()) so newly
 * installed packages are picked up automatically.
 */
export function extensionToolNamesOf(registry: Iterable<ToolLike>): string[] {
    const names: string[] = [];
    for (const tool of registry) {
        if (!BUILTIN_TOOL_NAMES.has(tool.name)) {
            names.push(tool.name);
        }
    }
    return names;
}

/**
 * Compose the full "active tool names" list to hand to setActiveToolsByName().
 *
 * @param requestedToolNames - built-in tool names chosen via the preset
 *                             (PRESET_NONE / PRESET_DEFAULT / PRESET_FULL)
 * @param registry          - live registry snapshot (AgentSession.getAllTools())
 *
 * - Off preset ([]): returns [] — truly everything off, no extension tools.
 * - Otherwise: requested built-ins + UI-compat tools + all extension tools,
 *   de-duplicated. Extension tools are auto-included so the user never has to
 *   know their names, matching how the pi CLI behaves.
 */
export function composeActiveTools(
    requestedToolNames: string[],
    registry: Iterable<ToolLike>,
): string[] {
    // Off preset: the user wants a completely tool-less agent. Disable extensions
    // too, otherwise the agent would still try to call e.g. subagent.
    if (requestedToolNames.length === 0) {
        return [];
    }
    const merged = [
        ...requestedToolNames,
        ...COMPAT_UI_TOOL_NAMES,
        ...extensionToolNamesOf(registry),
    ];
    return Array.from(new Set(merged));
}
