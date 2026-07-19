import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';

function normalizeContent(content) {
  if (content === null || content === undefined) {
    return '';
  }

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (typeof part?.text === 'string') {
          return part.text;
        }

        return JSON.stringify(part);
      })
      .join('');
  }

  return JSON.stringify(content);
}

export function toLangChainMessages(history) {
  return history.map((message) => {
    switch (message.role) {
      case 'system':
        return new SystemMessage(message.content ?? '');

      case 'user':
        return new HumanMessage(message.content ?? '');

      case 'assistant':
        return new AIMessage({
          content: message.content ?? '',
          tool_calls: message.tool_calls ?? [],
        });

      case 'tool':
        return new ToolMessage({
          content: message.content ?? '',
          tool_call_id: message.tool_call_id,
          name: message.name,
        });

      default:
        throw new Error(
          `Unsupported message role: ${message.role}`,
        );
    }
  });
}

export function toStoredMessage(message) {
  const type = message.getType();
  const content = normalizeContent(message.content);

  if (type === 'system') {
    return {
      role: 'system',
      content,
    };
  }

  if (type === 'human') {
    return {
      role: 'user',
      content,
    };
  }

  if (type === 'ai') {
    return {
      role: 'assistant',
      content,
      ...(message.tool_calls?.length
        ? { tool_calls: message.tool_calls }
        : {}),
    };
  }

  if (type === 'tool') {
    return {
      role: 'tool',
      content,
      tool_call_id: message.tool_call_id,
      ...(message.name ? { name: message.name } : {}),
    };
  }

  throw new Error(
    `Unsupported LangChain message type: ${type}`,
  );
}