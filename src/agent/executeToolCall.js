import { ToolMessage } from '@langchain/core/messages';

import { getToolByName } from './toolRegistry.js';

export async function executeToolCall(toolCall) {
  const tool = getToolByName(toolCall.name);

  if (!tool) {
    return new ToolMessage({
      content: JSON.stringify({
        error: `Unknown tool: ${toolCall.name}`,
      }),
      tool_call_id: toolCall.id,
      name: toolCall.name,
    });
  }

  try {
    const result = await tool.invoke(toolCall.args);

    return new ToolMessage({
      content:
        typeof result === 'string'
          ? result
          : JSON.stringify(result),
      tool_call_id: toolCall.id,
      name: toolCall.name,
    });
  } catch (error) {
    return new ToolMessage({
      content: JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : 'Tool execution failed.',
      }),
      tool_call_id: toolCall.id,
      name: toolCall.name,
    });
  }
}