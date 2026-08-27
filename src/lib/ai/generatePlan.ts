import { APICallError, NoObjectGeneratedError, generateObject, generateText } from 'ai';
import type { Project } from '@/types/artboard';
import {
  AgentPlanObjectSchema,
  AgentPlanSchema,
  formatPlanIssues,
  type AgentPlan,
} from './agentPlanSchema';
import {
  EMPTY_ALIAS_MAP,
  buildCatalogArtifacts,
  resolveAliases,
  type AliasMap,
} from './aliasCatalog';
import type { UploadedScreenshot } from './imageUtils';
import { extractJsonCandidates } from './jsonExtract';
import { buildJsonReplyInstruction, buildSystemPrompt, buildUserPrompt } from './promptBuilder';
import { buildTemplateCatalog, serializeCatalog } from './templateCatalog';
import {
  createModel,
  normalizeBaseUrl,
  readReplyMode,
  rememberReplyMode,
  type AiProviderId,
} from './providers';

export type AgentErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'invalid-output'
  | 'bad-request'
  | 'not-found'
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
  /**
   * The endpoint the user named, when they named one. Empty for a provider
   * running on its own default host.
   */
  baseUrl?: string;
  instruction: string;
  screenshots: UploadedScreenshot[];
  templates: Project[];
  signal?: AbortSignal;
}

type PlanOutcome = { plan: AgentPlan; issues: null } | { plan: null; issues: string };

/**
 * Aliases are resolved even on the no-alias fallback below: resolveAliases also
 * fills in the nullable fields a provider left out, and losing a whole plan
 * over a key the model had nothing to say about is not worth the strictness.
 */
function validatePlan(raw: unknown, aliasMap: AliasMap | null): PlanOutcome {
  const parsed = AgentPlanSchema.safeParse(resolveAliases(raw, aliasMap ?? EMPTY_ALIAS_MAP));
  if (parsed.success) return { plan: parsed.data, issues: null };
  return { plan: null, issues: formatPlanIssues(parsed.error, 2).join('; ') };
}

function invalidOutputMessage(issues: string | null): string {
  return issues
    ? `The model returned a plan we could not use (${issues}). Try again, or switch to a stronger model.`
    : 'The model replied with something that was not a valid design plan. Try again, or switch to a stronger model.';
}

export async function generatePlan(args: GeneratePlanArgs): Promise<AgentPlan> {
  // Compact aliased catalog; the reply's refs are mapped back to real ids
  // below. Falls back to the legacy full catalog if the compact build fails.
  let catalog: string;
  let aliasMap: AliasMap | null = null;
  try {
    const artifacts = buildCatalogArtifacts(buildTemplateCatalog(args.templates), {
      screenshots: args.screenshots.map((shot) => ({ width: shot.width, height: shot.height })),
      instruction: args.instruction,
    });
    catalog = artifacts.catalogText;
    aliasMap = artifacts.aliasMap;
  } catch {
    catalog = serializeCatalog(buildTemplateCatalog(args.templates));
  }

  const endpoint = normalizeBaseUrl(args.baseUrl);
  const model = createModel({
    provider: args.provider,
    model: args.model,
    apiKey: args.apiKey,
    baseUrl: endpoint,
  });
  // Only an endpoint the user named is an unknown quantity. The four hosts we
  // ship against all honour the schema, so a failure there is a real failure
  // and asking again in prose would hide it rather than fix it.
  const mayFallBack = endpoint.length > 0;

  const system = buildSystemPrompt(catalog);
  const images = args.screenshots.map((shot) => ({ type: 'image' as const, image: shot.aiDataUrl }));
  const userText = buildUserPrompt(args.instruction, args.screenshots.length);

  let issues: string | null = null;
  // Only a rejection of the schema itself is worth remembering. A 502 or a
  // model that simply wrote a bad plan says nothing about what this endpoint
  // supports, and pinning it to the weaker path over one bad day is worse
  // than paying for one more probe next time.
  let schemaRejected = false;

  if (!mayFallBack || readReplyMode(endpoint, args.model) !== 'text') {
    try {
      const result = await generateObject({
        model,
        // The plain object schema goes to the provider; the refined schema in
        // validatePlan enforces the cross-field rules JSON Schema cannot.
        schema: AgentPlanObjectSchema,
        abortSignal: args.signal,
        // The system turn goes in `instructions`, never in `messages`: the SDK
        // rejects a system message inside `messages` before it sends anything.
        instructions: system,
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }, ...images] }],
      });
      const outcome = validatePlan(result.object, aliasMap);
      if (outcome.plan) {
        if (mayFallBack) rememberReplyMode(endpoint, args.model, 'schema');
        return outcome.plan;
      }
      issues = outcome.issues;
      if (!mayFallBack) throw new AgentError('invalid-output', invalidOutputMessage(issues));
    } catch (error) {
      const failure = error instanceof AgentError ? error : toAgentError(error);
      if (!mayFallBack || !worthRetryingAsText(failure, args.signal)) throw failure;
      schemaRejected = failure.kind === 'bad-request';
    }
  }

  // Text fallback: the same contract the relay and free-provider modes use,
  // spelled out in the prompt instead of in a schema, with the reply mined for
  // JSON afterwards. Nothing about the plan changes, only how it was asked for.
  let reply: string;
  try {
    const result = await generateText({
      model,
      abortSignal: args.signal,
      instructions: system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${userText}\n\n${buildJsonReplyInstruction()}` },
            ...images,
          ],
        },
      ],
    });
    reply = result.text;
  } catch (error) {
    throw toAgentError(error);
  }

  // Chatty models lead with an example object and reasoning models emit an
  // empty skeleton first, so every candidate gets a turn and the first one
  // that validates wins.
  for (const candidate of extractJsonCandidates(reply)) {
    const outcome = validatePlan(candidate, aliasMap);
    if (outcome.plan) {
      if (schemaRejected) rememberReplyMode(endpoint, args.model, 'text');
      return outcome.plan;
    }
    issues = issues ?? outcome.issues;
  }
  throw new AgentError('invalid-output', invalidOutputMessage(issues));
}

/**
 * Is this failure the endpoint saying "not like that" rather than "no"? A
 * rejected key, a rate limit or a dead network say nothing about the reply
 * format, so asking again would only burn another request.
 */
function worthRetryingAsText(failure: AgentError, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return false;
  return (
    failure.kind === 'bad-request' || failure.kind === 'invalid-output' || failure.kind === 'unknown'
  );
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
    if (status === 404) {
      return new AgentError(
        'not-found',
        'The endpoint answered 404. Check the base URL (it ends where /chat/completions would start) and the model id.'
      );
    }
    if (status === 429) {
      return new AgentError(
        'rate-limit',
        'The provider rate limited this key. Wait a moment and try again.'
      );
    }
    if (status === 400 || status === 422) {
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
