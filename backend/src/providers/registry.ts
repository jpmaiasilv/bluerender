import { RenderProvider } from './types';
import { bflProvider } from './bfl';
import { openaiRenderProvider } from './openaiRenderProvider';
import { geminiRenderProvider } from './geminiRenderProvider';

// Register additional providers (Replicate, Stability AI, ...) here.
const providers: Record<string, RenderProvider> = {
  [bflProvider.id]: bflProvider,
  [openaiRenderProvider.id]: openaiRenderProvider,
  [geminiRenderProvider.id]: geminiRenderProvider,
};

export function getProvider(id: string): RenderProvider | undefined {
  return providers[id];
}

export function listProviders(): RenderProvider[] {
  return Object.values(providers);
}
