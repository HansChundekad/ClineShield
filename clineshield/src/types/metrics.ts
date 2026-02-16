/**
 * metrics.ts
 *
 * SOURCE OF TRUTH for metrics.json schema
 * This file defines the contract that all features depend on.
 *
 * CRITICAL: Never change these types without updating:
 * - .cline-shield/metrics.json (example events)
 * - All hooks that write events
 * - All UI components that read events
 */


/**
 * ALL events must include these base fields
 */
interface BaseEvent {
    timestamp: string;   // ISO 8601 format
    sessionId: string;   // Current Cline session UUID
    type: EventType;
    data: unknown;
  }
  
  /**
   * Event type discriminator - used by ALL features to filter
   */
  type EventType = 
    | 'edit-blocked'      // No-Nuke: PreToolUse blocked edit
    | 'edit-allowed'      // No-Nuke: PreToolUse allowed edit
    | 'sanity-failed'     // Sanity Check: PostToolUse found errors
    | 'sanity-passed'     // Sanity Check: PostToolUse all checks green
    | 'risk-assessed'     // Rules Engine: PostToolUse scored edit
    | 'llm-analysis';     // LLM Analyzer: Extension added reasoning
  
  // ============================================================================
  // NO-NUKE HOOK EVENTS
  // ============================================================================
  
  /** Written by: PreToolUse hook when blocking destructive edit */
  export interface EditBlockedEvent extends BaseEvent {
    type: 'edit-blocked';
    data: {
      file: string;                    // Required
      reason: string;                  // Required - shown to Cline
      structuralChangePercent: number; // Required - Rules Engine reads this
      functionsDeleted: number;        // Required - Rules Engine reads this
      exportsDeleted: number;          // Optional
    };
  }
  
  /** Written by: PreToolUse hook when allowing edit */
  export interface EditAllowedEvent extends BaseEvent {
    type: 'edit-allowed';
    data: {
      file: string;                    // Required
      structuralChangePercent: number; // Required - Rules Engine reads this
      functionsDeleted: number;        // Required - Rules Engine reads this
      exportsDeleted: number;          // Optional
    };
  }
  
  // ============================================================================
  // SANITY CHECK HOOK EVENTS
  // ============================================================================
  
  /** Written by: PostToolUse hook when quality checks fail */
  export interface SanityFailedEvent extends BaseEvent {
    type: 'sanity-failed';
    data: {
      file: string;           // Required
      tool: string;           // Required - which tool failed (eslint/tsc/prettier)
      errors: string[];       // Required - error messages
      retryCount: number;     // Required - current attempt (1-indexed)
      maxRetries: number;     // Required - from config
    };
  }
  
  /** Written by: PostToolUse hook when all quality checks pass */
  export interface SanityPassedEvent extends BaseEvent {
    type: 'sanity-passed';
    data: {
      file: string;           // Required
      tools: string[];        // Required - tools that passed
      duration?: number;      // Optional - execution time in seconds
    };
  }
  
  // ============================================================================
  // RULES ENGINE EVENT
  // ============================================================================
  
  /** Written by: PostToolUse hook after running rules engine */
  export interface RiskAssessedEvent extends BaseEvent {
    type: 'risk-assessed';
    data: {
      file: string;           // Required
      rulesScore: number;     // Required - 0-100
      level: 'low' | 'medium' | 'high';  // Required
      reasons: Array<{        // Required - score breakdown
        rule: string;         // Rule ID (e.g., 'auth_paths')
        points: number;       // Points added to score
        description: string;  // Human explanation
      }>;
    };
  }
  
  // ============================================================================
  // LLM ANALYZER EVENT
  // ============================================================================
  
  /** Written by: Extension process (async) after LLM call */
  export interface LLMAnalysisEvent extends BaseEvent {
    type: 'llm-analysis';
    data: {
      file: string;                       // Required
      relatedRiskEventTimestamp: string;  // Required - links to risk-assessed
      reasoning: string;                  // Required - LLM explanation
      model?: string;                     // Optional - which LLM used
      duration?: number;                  // Optional - API call time
    };
  }
  
  // ============================================================================
  // DISCRIMINATED UNION - Use this everywhere
  // ============================================================================
  
  export type MetricsEvent = 
    | EditBlockedEvent
    | EditAllowedEvent
    | SanityFailedEvent
    | SanityPassedEvent
    | RiskAssessedEvent
    | LLMAnalysisEvent;
  
  export type MetricsLog = MetricsEvent[];
  
  // ============================================================================
  // TYPE GUARDS - Safe runtime checking
  // ============================================================================
  
  export function isEditBlockedEvent(event: MetricsEvent): event is EditBlockedEvent {
    return event.type === 'edit-blocked';
  }
  
  export function isRiskAssessedEvent(event: MetricsEvent): event is RiskAssessedEvent {
    return event.type === 'risk-assessed';
  }
  
  // ... etc for each type

