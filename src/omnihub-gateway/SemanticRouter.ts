/**
 * SemanticRouter — A2A Task-to-Agent Routing
 * @version 1.0.0
 * @module src/omnihub-gateway/SemanticRouter
 *
 * Routes incoming A2A task requests to the most suitable registered agent
 * based on keyword matching against agent skill tags and descriptions.
 * Uses a deterministic keyword extraction + scoring algorithm.
 *
 * Integration:
 * - Reads agent capabilities from AgentCardRegistry
 * - Scores candidates by skill tag overlap + description relevance
 * - Returns ranked list of candidate agents
 *
 * APEX STANDARDS ENFORCED:
 * - Deterministic: Same input always produces same ranking
 * - Fail-closed: No matching agents returns empty array (never guesses)
 * - Zero ML: Pure keyword-based scoring for reproducibility
 * - Auditable: Full scoring trace on every decision
 *
 * OWNED BY: APEX Business Systems Ltd.
 */
import { AgentCardRegistry, type RegisteredAgent } from './AgentCard';
import { dispatchRoutedTask, type A2ATaskResponse } from './TemporalBridge';
import type { GatewayContext } from './types';
// ============================================================================
// Types
// ============================================================================
export interface RoutingCandidate {
  readonly agent: RegisteredAgent;
  readonly score: number;
  readonly matchedTags: string[];
  readonly matchedSkills: string[];
  readonly reasoning: string;
}
export interface RoutingResult {
  readonly requestId: string;
  readonly query: string;
  readonly candidates: RoutingCandidate[];
  readonly selectedAgent: RegisteredAgent | null;
  readonly timestamp: string;
}
// ============================================================================
// Keyword Extraction
// ============================================================================
/** Stop words excluded from keyword extraction */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because',
  'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our',
  'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its',
  'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'when',
  'where', 'why', 'how', 'all', 'any', 'each', 'every', 'if', 'please',
]);
/**
 * Extract meaningful keywords from a query string.
 * Returns lowercased, deduplicated keywords with stop words removed.
 */
export function extractKeywords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[\s,;:.!?(){}[\]"'`/\\-]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}
// ============================================================================
// Solver Routing — Automated Tool Injection
// ============================================================================
export type SolverType = 'static-analyzer' | 'multi-agent' | 'search-verifier';
export interface ExecutionPayload {
  readonly intent: string;
  readonly solvers: readonly SolverType[];
  readonly tools: readonly string[];
  readonly rationale: string;
  readonly requestId: string;
  readonly timestamp: string;
}
const CODE_SIGNALS = new Set([
  'syntax', 'lint', 'analyze', 'parse', 'ast', 'compile', 'typecheck',
  'eslint', 'tsc', 'static', 'code', 'refactor', 'debug', 'fix',
]);
const PLANNING_SIGNALS = new Set([
  'plan', 'design', 'architect', 'orchestrate', 'coordinate', 'strategy',
  'workflow', 'saga', 'multistep', 'pipeline', 'schedule', 'roadmap',
]);
const VERIFICATION_SIGNALS = new Set([
  'verify', 'test', 'validate', 'search', 'check', 'confirm', 'audit',
  'review', 'scan', 'assert', 'proof', 'benchmark', 'e2e',
]);
const SOLVER_TOOLS: Readonly<Record<SolverType, readonly string[]>> = {
  'static-analyzer':   ['eslint', 'typescript-checker', 'ast-parser', 'dependency-analyzer'],
  'multi-agent':       ['planner-agent', 'executor-agent', 'critic-agent', 'temporal-orchestrator'],
  'search-verifier':   ['web-search', 'doc-retriever', 'test-runner', 'assertion-engine'],
};
/**
 * Classify an intent and build an execution payload with solver arrays and
 * tools pre-injected. Eliminates all manual tool invocation.
 *
 * Solver selection rules (non-exclusive):
 *   Code keywords        → static-analyzer  (ESLint, TypeScript, AST)
 *   Planning keywords    → multi-agent      (planner, executor, critic)
 *   Verification keywords→ search-verifier  (web-search, test-runner)
 *   No signal matched    → multi-agent      (fail-safe capable default)
 */
export function routeToSolvers(intent: string): ExecutionPayload {
  const requestId = `sv-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const keywords = extractKeywords(intent);
  const keywordSet = new Set(keywords);
  const matched = new Set<SolverType>();
  const rationale: string[] = [];
  for (const kw of keywordSet) {
    if (CODE_SIGNALS.has(kw)) {
      matched.add('static-analyzer');
      rationale.push(`code:${kw}`);
    }
    if (PLANNING_SIGNALS.has(kw)) {
      matched.add('multi-agent');
      rationale.push(`planning:${kw}`);
    }
    if (VERIFICATION_SIGNALS.has(kw)) {
      matched.add('search-verifier');
      rationale.push(`verification:${kw}`);
    }
  }
  if (matched.size === 0) {
    matched.add('multi-agent');
    rationale.push('default:multi-agent');
  }
  const solvers = [...matched];
  const tools = [...new Set(solvers.flatMap((s) => [...SOLVER_TOOLS[s]]))];
  return {
    intent,
    solvers,
    tools,
    rationale: rationale.join(', '),
    requestId,
    timestamp: new Date().toISOString(),
  };
}
// ============================================================================
// Scoring Helpers (extracted to reduce cognitive complexity of route())
// ============================================================================
interface AgentScore {
  score: number;
  matchedTags: string[];
  matchedSkills: string[];
  reasoning: string;
}
/** Score a single skill against query keywords. Returns tag/skill matches and points. */
function scoreSkill(
  skill: { name: string; tags: string[]; description: string; examples: string[] },
  keywords: string[],
  keywordSet: Set<string>,
): { score: number; tags: string[]; skills: string[] } {
  let score = 0;
  const tags: string[] = [];
  const skills: string[] = [];
  // Tag matching (3 points each)
  for (const tag of skill.tags) {
    if (keywordSet.has(tag.toLowerCase())) {
      score += 3;
      tags.push(tag);
    }
  }
  // Skill name matching (5 points)
  const nameWords = skill.name.toLowerCase().split(/\s+/);
  if (nameWords.some((w) => keywordSet.has(w))) {
    score += 5;
    skills.push(skill.name);
  }
  // Description matching (1 point per keyword)
  const descWords = skill.description.toLowerCase().split(/\s+/);
  score += keywords.filter((kw) => descWords.includes(kw)).length;
  // Example matching (2 points per example with keyword overlap)
  for (const example of skill.examples) {
    const exampleWords = example.toLowerCase().split(/\s+/);
    if (exampleWords.some((w) => keywordSet.has(w))) {
      score += 2;
    }
  }
  return { score, tags, skills };
}
/** Score a complete agent against query keywords. */
function scoreAgent(agent: RegisteredAgent, keywords: string[], keywordSet: Set<string>): AgentScore {
  let score = 0;
  const matchedTags: string[] = [];
  const matchedSkills: string[] = [];
  for (const skill of agent.card.skills) {
    const result = scoreSkill(skill, keywords, keywordSet);
    score += result.score;
    matchedTags.push(...result.tags);
    matchedSkills.push(...result.skills);
  }
  // Agent-level description matching (0.5 points per keyword)
  const agentDescWords = agent.card.description.toLowerCase().split(/\s+/);
  score += keywords.filter((kw) => agentDescWords.includes(kw)).length * 0.5;
  const reasonParts: string[] = [];
  if (matchedTags.length > 0) reasonParts.push(`tags=[${matchedTags.join(',')}]`);
  if (matchedSkills.length > 0) reasonParts.push(`skills=[${matchedSkills.join(',')}]`);
  reasonParts.push(`score=${score}`);
  return {
    score,
    matchedTags: [...new Set(matchedTags)],
    matchedSkills: [...new Set(matchedSkills)],
    reasoning: reasonParts.join('; '),
  };
}
// ============================================================================
// Semantic Router
// ============================================================================
export class SemanticRouter {
  private readonly registry: AgentCardRegistry;
  constructor(registry: AgentCardRegistry) {
    this.registry = registry;
  }
  /**
   * Route a task query to the best matching agent.
   *
   * Algorithm:
   * 1. Extract keywords from the query
   * 2. For each registered agent:
   *    a. Score tag matches (3 points per matching tag)
   *    b. Score skill name matches (5 points per matching skill name)
   *    c. Score description keyword matches (1 point each)
   *    d. Score example matches (2 points per matching example keyword)
   * 3. Rank agents by total score (descending)
   * 4. Return top candidates (agents with score > 0)
   *
   * @param query - Task description or natural language request
   * @param requestId - Unique request identifier for audit trail
   * @returns RoutingResult with ranked candidates
   */
  route(query: string, requestId?: string): RoutingResult {
    const id = requestId ?? `rt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const keywords = extractKeywords(query);
    const keywordSet = new Set(keywords); // ⚡ Bolt: Provide O(1) set to prevent repeated O(N) includes lookups
    const agents = this.registry.listAgents();
    const candidates: RoutingCandidate[] = [];
    for (const agent of agents) {
      if (!agent.healthy) continue;
      const result = scoreAgent(agent, keywords, keywordSet);
      if (result.score > 0) {
        candidates.push({ agent, ...result });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return {
      requestId: id,
      query,
      candidates,
      selectedAgent: candidates.length > 0 ? candidates[0].agent : null,
      timestamp: new Date().toISOString(),
    };
  }
  /**
   * Classify the intent and return an execution payload with solver arrays
   * and tools pre-injected. Delegates to the standalone routeToSolvers.
   */
  routeToSolvers(intent: string): ExecutionPayload {
    return routeToSolvers(intent);
  }
  /**
   * Route and return only the top agent (or null if no match).
   */
  routeToAgent(query: string): RegisteredAgent | null {
    return this.route(query).selectedAgent;
  }
  /**
   * Route and return the top N candidates.
   */
  routeTopN(query: string, n: number): RoutingCandidate[] {
    return this.route(query).candidates.slice(0, n);
  }
  /**
   * Route a task query and dispatch it to the selected agent
   * via a Temporal durable workflow.
   *
   * Flow:
   * 1. SemanticRouter scores and selects the best agent
   * 2. TemporalBridge.dispatchRoutedTask starts an a2aTaskWorkflow
   * 3. The workflow durably executes the task against the agent's endpoint
   * 4. Results stream back via SSE or are returned synchronously
   *
   * @param query - Natural language task description
   * @param context - Gateway request context (tenant, device, idempotency)
   * @returns A2ATaskResponse from the Temporal workflow
   * @throws Error if no suitable agent is found (fail-closed)
   */
  async routeAndDispatch(
    query: string,
    context: GatewayContext,
  ): Promise<A2ATaskResponse> {
    const result = this.route(query, context.requestId);
    if (!result.selectedAgent) {
      return {
        id: context.requestId,
        sessionId: context.requestId,
        state: 'failed',
        artifacts: [],
        metadata: {
          error: 'No suitable agent found for the given query',
          query,
          candidatesEvaluated: this.registry.listAgents().length,
        },
        workflowId: '',
      };
    }
    const taskId = `task-${context.requestId}`;
    const agentUrl = result.selectedAgent.card.url;
    return dispatchRoutedTask(
      taskId,
      agentUrl,
      {
        role: 'user',
        parts: [{ type: 'text', text: query }],
      },
      context,
    );
  }
}
