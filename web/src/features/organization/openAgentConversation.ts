import { routePath, type AppRoute } from '../../app/routing';

interface DirectConversation {
  id: string;
}

interface OpenAgentConversationDeps {
  createConversation(input: {
    kind: 'direct';
    agentIds: [string];
  }): Promise<DirectConversation>;
  closeMenu(): void;
  pushState(state: AppRoute, title: string, path: string): void;
  notifyNavigation(): void;
}

export async function openAgentConversation(
  agentId: string,
  deps: OpenAgentConversationDeps,
): Promise<void> {
  const conversation = await deps.createConversation({
    kind: 'direct',
    agentIds: [agentId],
  });
  const route: AppRoute = {
    view: 'messages',
    conversationId: conversation.id,
  };
  deps.closeMenu();
  deps.pushState(route, '', routePath(route));
  deps.notifyNavigation();
}
