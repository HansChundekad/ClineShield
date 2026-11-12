/**
 * metrics.ts
 *
 * SOURCE OF TRUTH for metrics.json schema
 * This file defines the contract that all features depend on.
 *
 * CRITICAL: Never change these types without updating:
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
  
  /** One scored category (risk-assessed, command-assessed, and asked/blocked edits). */
  export interface RiskReason {
    rule: string;         // Rule ID (e.g., 'secrets_file')
    points: number;       // Points added to score
    description: string;  // Human explanation
  }

  /** The ask / block cut-offs that applied to a decision. */
  export interface Cutoffs {
    ask: number;
    block: number;
  }

  /**
   * Event type discriminator - used by ALL features to filter
   */
  type EventType = 
    | 'edit-blocked'      // Plugin beforeTool: edit blocked
    | 'edit-allowed'      // Plugin beforeTool: edit allowed
    | 'edit-approval'     // Edit Size Policy: user decided on a medium-tier edit
    | 'sanity-failed'     // 1.x only (post-edit checks cut from 2.0)
    | 'sanity-passed'     // 1.x only (post-edit checks cut from 2.0)
    | 'risk-assessed'     // Plugin afterTool: successful edit scored
    | 'command-assessed'  // Risk rubric: one run_commands request scored (Decision 1)
    | 'llm-analysis';     // LLM Analyzer: Extension added reasoning
  
  // ============================================================================
  // NO-NUKE HOOK EVENTS
  // ============================================================================
  
  /** Written by: plugin beforeTool when an edit is blocked (1.x: PreToolUse hook) */
  export interface EditBlockedEvent extends BaseEvent {
    type: 'edit-blocked';
    data: {
      file: string;                    // Required
      reason: string;                  // Required - shown to Cline
      structuralChangePercent: number; // Required - Rules Engine reads this
      functionsDeleted: number;        // Required - Rules Engine reads this
      exportsDeleted: number;          // Optional
      score?: number;                  // Optional (plugin 2.0+) - this file's rubric score, 0-100; never shown to Cline
      reasons?: RiskReason[];          // Optional (plugin 2.0+) - every finding, as in risk-assessed
      cutoffs?: Cutoffs;               // Optional (plugin 2.0+) - this file's effective cut-offs
    };
  }
  
  /** Written by: plugin beforeTool when an edit is allowed (1.x: PreToolUse hook) */
  export interface EditAllowedEvent extends BaseEvent {
    type: 'edit-allowed';
    data: {
      file: string;                    // Required
      structuralChangePercent: number; // Required - Rules Engine reads this
      functionsDeleted: number;        // Required - Rules Engine reads this
      exportsDeleted: number;          // Optional
    };
  }
  
  /**
   * Written by: plugin afterTool for a medium-tier edit that beforeTool sent
   * to user approval (Open decision #2, decided 2026-10-14). One per file.
   */
  export interface EditApprovalEvent extends BaseEvent {
    type: 'edit-approval';
    data: {
      file: string;                    // Required
      structuralChangePercent: number; // Required
      functionsDeleted: number;        // Required
      exportsDeleted: number;          // Required
      reason: string;                  // Required - why approval was needed (shown to Cline)
      approved: boolean;               // Required - false when refused pending the user (incl. headless runs); true when run after their yes
      score?: number;                  // Optional (plugin 2.0+) - this file's rubric score, 0-100; never shown to Cline
      reasons?: RiskReason[];          // Optional (plugin 2.0+) - every finding, as in risk-assessed
      cutoffs?: Cutoffs;               // Optional (plugin 2.0+) - this file's effective cut-offs
    };
  }

  // ============================================================================
  // SANITY CHECK HOOK EVENTS
  // ============================================================================
  
  /** Written by: 1.x PostToolUse hook only (post-edit checks cut from 2.0) */
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
  
  /** Written by: 1.x PostToolUse hook only (post-edit checks cut from 2.0) */
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
  
  /** Written by: plugin afterTool after a successful edit (1.x: PostToolUse hook) */
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
  
  /**
   * Written by: plugin for one run_commands request (Open decision #1,
   * decided 2026-10-15). Only when score > 0 or tier != allow. Asked
   * requests are written in afterTool with `approved`.
   */
  export interface CommandAssessedEvent extends BaseEvent {
    type: 'command-assessed';
    data: {
      command: string;        // Required - commands joined, secrets masked, max 500 chars
      tier: 'allow' | 'ask' | 'block';  // Required
      score: number;          // Required - 0-100, the deciding item's score
      reasons: Array<{        // Required - every finding; file findings name the file
        rule: string;
        points: number;
        description: string;
      }>;
      approved?: boolean;     // Asked requests only: false when denied (incl. headless)
      cutoffs?: Cutoffs;      // Optional - the deciding item's effective cut-offs
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
    | EditApprovalEvent
    | SanityFailedEvent
    | SanityPassedEvent
    | RiskAssessedEvent
    | CommandAssessedEvent
    | LLMAnalysisEvent;
  
  export type MetricsLog = MetricsEvent[];
  
  // ============================================================================
  // TYPE GUARDS - Safe runtime checking
  // ============================================================================
  
  export function isEditBlockedEvent(event: MetricsEvent): event is EditBlockedEvent {
    return event.type === 'edit-blocked';
  }
  
  export function isEditApprovalEvent(event: MetricsEvent): event is EditApprovalEvent {
    return event.type === 'edit-approval';
  }

  export function isCommandAssessedEvent(event: MetricsEvent): event is CommandAssessedEvent {
    return event.type === 'command-assessed';
  }

  export function isRiskAssessedEvent(event: MetricsEvent): event is RiskAssessedEvent {
    return event.type === 'risk-assessed';
  }
  
  // ... etc for each type

