import { APICallError, NoObjectGeneratedError, generateObject } from 'ai';
import type { Project } from '@/types/artboard';
import {
  AgentPlanObjectSchema,
  AgentPlanSchema,
  formatPlanIssues,
  type AgentPlan,
} from './agentPlanSchema';
import type { UploadedScreenshot } from './imageUtils';
import { buildSystemPrompt, buildUserPrompt } from './promptBuilder';
import { buildTemplateCatalog, serializeCatalog } from './templateCatalog';
import { createModel, type AiProviderId } from './providers';

export type AgentErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'invalid-output'
  | 'bad-request'
  | 'unknown';

export class AgentError extends Error {
  readonly kind: AgentErrorKind;
  constructor(kind: AgentErrorKind, message: string) {
    super(message);
    this.name = 'AgentError';
    this.kind = kind;
  }
}

export interface GeneratePlanArgs {
  provider: AiProviderId;
  model: string;
  apiKey: string;
  instruction: string;
  screenshots: UploadedScreenshot[];
  templates: Project[];
  signal?: AbortSignal;
}

export async function generatePlan(args: GeneratePlanArgs): Promise<AgentPlan> {
  const catalog = serializeCatalog(buildTemplateCatalog(args.templates));

  let raw: unknown;
  try {
    const result = await generateObject({
      model: createModel(args.provider, args.model, args.apiKey),
      // The plain object schema goes to the provider; the refined schema below
      // enforces the cross-field rules the JSON Schema cannot express.
      schema: AgentPlanObjectSchema,
      abortSignal: args.signal,
      messages: [
        { role: 'system', content: buildSystemPrompt(catalog) },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildUserPrompt(args.instruction, args.screenshots.length) },
            ...args.screenshots.map((shot) => ({ type: 'image' as const, image: shot.aiDataUrl })),
          ],
        },
      ],
    });
    raw = result.object;
  } catch (error) {
    throw toAgentError(error);
  }

  const parsed = AgentPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgentError(
      'invalid-output',
      `The model returned a plan we could not use (${formatPlanIssues(parsed.error, 2).join('; ')}). Try again, or switch to a stronger model.`
    );
  }
  return parsed.data;
}

function toAgentError(error: unknown): AgentError {
  if (error instanceof AgentError) return error;

  if (NoObjectGeneratedError.isInstance(error)) {
    return new AgentError(
      'invalid-output',
      'The model replied with something that was not a valid design plan. Try again, or switch to a stronger model.'
    );
  }

  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 401 || status === 403) {
      return new AgentError(
        'auth',
        'That API key was rejected. Check the key and make sure it matches the provider you picked.'
      );
    }
    if (status === 429) {
      return new AgentError(
        'rate-limit',
        'The provider rate limited this key. Wait a moment and try again.'
      );
    }
    if (status === 400) {
      return new AgentError('bad-request', error.message || 'The provider rejected the request.');
    }
    if (!status) {
      return new AgentError('network', networkMessage());
    }
    return new AgentError('unknown', error.message || `The provider returned an error (${status}).`);
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new AgentError('unknown', 'Cancelled.');
  }

  if (error instanceof TypeError) {
    return new AgentError('network', networkMessage());
  }

  return new AgentError('unknown', error instanceof Error ? error.message : 'Something went wrong.');
}

function networkMessage(): string {
  return 'Could not reach the provider. This is usually an ad blocker or privacy extension blocking the request, or no internet connection.';
}
