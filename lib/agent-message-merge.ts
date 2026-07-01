import type { AgentMessage } from "./types";

function textOfUserMessage(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") return message.content;
  const text = message.content.find((block) => block.type === "text");
  return text?.text ?? "";
}

export function appendCompletedMessage(messages: AgentMessage[], completed: AgentMessage): AgentMessage[] {
  if (completed.role !== "user") return [...messages, completed];

  const last = messages[messages.length - 1];
  if (last?.role !== "user") return [...messages, completed];

  if (textOfUserMessage(last) === textOfUserMessage(completed)) {
    return messages;
  }

  return [...messages, completed];
}
