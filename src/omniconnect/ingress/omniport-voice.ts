/**
 * OmniPort Voice Command Handler
 * =============================================================================
 * Seamless voice command integration for OmniPort ingress.
 * Supports natural language voice commands with intent recognition.
 * =============================================================================
 */

import { v4 as uuidv4 } from 'uuid';
import { OmniPort } from './OmniPort';
import { VoiceSource, IngestResult, detectHighRiskIntents } from '../types/ingress';
import { createDebugLogger, logError } from '../../lib/debug-logger';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Voice command configuration
 */
export interface VoiceCommandConfig {
  /** Minimum confidence threshold (0-1) */
  minConfidence: number;

  /** Maximum audio duration in milliseconds */
  maxDurationMs: number;

  /** Enable MAN Mode for all voice commands */
  forceManMode: boolean;

  /** Custom wake words (optional) */
  wakeWords?: string[];
}

/**
 * Voice command result with enhanced metadata
 */
export interface VoiceCommandResult extends IngestResult {
  /** Original transcript */
  transcript: string;

  /** Confidence score */
  confidence: number;

  /** Detected intents */
  detectedIntents: string[];

  /** Was MAN Mode triggered */
  manModeTriggered: boolean;

  /** Processing duration */
  processingMs: number;
}

/**
 * Voice session state
 */
export interface VoiceSession {
  sessionId: string;
  userId: string;
  startedAt: Date;
  lastActivityAt: Date;
  commandCount: number;
  isActive: boolean;
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: VoiceCommandConfig = {
  minConfidence: 0.7,
  maxDurationMs: 60000, // 1 minute max
  forceManMode: false,
  wakeWords: ['apex', 'omni', 'hub'],
};

// =============================================================================
// VOICE COMMAND HANDLER
// =============================================================================

/**
 * Voice Command Handler for OmniPort
 * Provides natural language voice command processing
 */
class VoiceCommandHandler {
  private static instance: VoiceCommandHandler | null = null;
  private config: VoiceCommandConfig;
  private wakeWordRegexes: RegExp[] = [];
  private wakeWordMatchRegex: RegExp | null = null;
  private readonly logger = createDebugLogger('OmniPort.Voice');
  private readonly sessions: Map<string, VoiceSession> = new Map();

  private constructor(config: Partial<VoiceCommandConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.compileWakeWords();
  }

  // ⚡ Bolt: Escape regex special characters in user-provided wake words to prevent runtime RegExp evaluation errors
  private escapeRegex(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ⚡ Bolt: Pre-compile regular expressions on initialization to prevent O(N * M) reallocation overhead inside high-frequency processing methods.
  private compileWakeWords(): void {
    if (this.config.wakeWords && this.config.wakeWords.length > 0) {
      this.wakeWordRegexes = this.config.wakeWords.map(word => new RegExp(String.raw`^${this.escapeRegex(word)}[,.]?\s*`, 'i'));
      this.wakeWordMatchRegex = new RegExp(this.config.wakeWords.map(w => this.escapeRegex(w)).join('|'), 'i');
    } else {
      this.wakeWordRegexes = [];
      this.wakeWordMatchRegex = null;
    }
  }

  public static getInstance(config?: Partial<VoiceCommandConfig>): VoiceCommandHandler {
    VoiceCommandHandler.instance ??= new VoiceCommandHandler(config);
    return VoiceCommandHandler.instance;
  }

  public static resetInstance(): void {
    VoiceCommandHandler.instance = null;
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Process a voice command through OmniPort
   *
   * @param transcript - The voice transcription text
   * @param confidence - Confidence score from speech recognition (0-1)
   * @param audioUrl - URL to the audio recording
   * @param durationMs - Duration of the audio in milliseconds
   * @param userId - Optional user ID (for authenticated commands)
   * @returns Enhanced voice command result
   */
  public async processCommand(
    transcript: string,
    confidence: number,
    audioUrl: string,
    durationMs: number,
    userId?: string
  ): Promise<VoiceCommandResult> {
    const startTime = Date.now();

    // Validate confidence threshold
    if (confidence < this.config.minConfidence) {
      return this.createBlockedVoiceResult(transcript, confidence, startTime);
    }

    // Validate duration
    if (durationMs > this.config.maxDurationMs) {
      return this.createDurationExceededResult(transcript, confidence, startTime);
    }

    // Check for wake words if configured
    if (this.config.wakeWords && this.config.wakeWords.length > 0) {
      const hasWakeWord = this.checkWakeWords(transcript);
      if (!hasWakeWord) {
        return this.createNoWakeWordResult(transcript, confidence, startTime);
      }
    }

    // Build VoiceSource input
    const voiceInput: VoiceSource = {
      type: 'voice',
      transcript: this.normalizeTranscript(transcript),
      confidence,
      audioUrl,
      durationMs,
      userId,
    };

    // Process through OmniPort
    const result = await OmniPort.ingest(voiceInput);

    // Detect intents for response
    const detectedIntents = detectHighRiskIntents(transcript);
    const manModeTriggered = detectedIntents.length > 0 || this.config.forceManMode;

    const processingMs = Date.now() - startTime;

    // Update session if userId provided
    if (userId) {
      this.updateSession(userId);
    }

    return {
      ...result,
      transcript,
      confidence,
      detectedIntents,
      manModeTriggered,
      processingMs,
    };
  }

  /**
   * Start a voice session for a user
   */
  public startSession(userId: string): VoiceSession {
    const session: VoiceSession = {
      sessionId: uuidv4(),
      userId,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      commandCount: 0,
      isActive: true,
    };

    this.sessions.set(userId, session);
    this.logger(`Session started for user ${userId}`);

    return session;
  }

  /**
   * End a voice session
   */
  public endSession(userId: string): void {
    const session = this.sessions.get(userId);
    if (session) {
      session.isActive = false;
      this.sessions.delete(userId);
      this.logger(`Session ended for user ${userId} (${session.commandCount} commands)`);
    }
  }

  /**
   * Get active session for a user
   */
  public getSession(userId: string): VoiceSession | undefined {
    return this.sessions.get(userId);
  }

  /**
   * Configure the voice command handler
   */
  public configure(config: Partial<VoiceCommandConfig>): void {
    this.config = { ...this.config, ...config };
    this.compileWakeWords();
  }

  /**
   * Get current configuration
   */
  public getConfig(): VoiceCommandConfig {
    return { ...this.config };
  }

  // ===========================================================================
  // CONVENIENCE METHODS
  // ===========================================================================

  /**
   * Quick voice command (minimal parameters)
   * Generates a placeholder audio URL for testing
   */
  public async quickCommand(
    transcript: string,
    audioBlob: Blob,
    userId?: string,
    confidence: number = 0.95
  ): Promise<VoiceCommandResult> {
    const estimatedDurationMs = Math.max(1000, transcript.split(' ').length * 300);

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    let audioUrl = '';

    if (supabaseUrl && supabaseKey) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(supabaseUrl, supabaseKey);

        const fileName = `${uuidv4()}.wav`;
        const { error } = await supabase.storage
          .from('voice-commands')
          .upload(fileName, audioBlob);

        if (error) {
          logError(error, { context: 'Supabase storage upload' });
          throw new Error('Supabase storage upload failed');
        }

        const { data: urlData } = supabase.storage
          .from('voice-commands')
          .getPublicUrl(fileName);

        audioUrl = urlData.publicUrl;
      } catch (e) {
        logError(e, { context: 'Supabase storage operation' });
        throw e;
      }
    } else {
      throw new Error('Supabase credentials missing for audio upload');
    }

    return this.processCommand(
      transcript,
      confidence,
      audioUrl,
      estimatedDurationMs,
      userId
    );
  }

  /**
   * Process voice command from browser MediaRecorder
   */
  public async processFromMediaRecorder(
    audioBlob: Blob,
    transcript: string,
    confidence: number,
    userId?: string
  ): Promise<VoiceCommandResult> {
    // In production, this would upload the blob and get a URL
    const audioUrl = `blob:${URL.createObjectURL(audioBlob)}`;
    const durationMs = await this.estimateDuration(audioBlob);

    return this.processCommand(transcript, confidence, audioUrl, durationMs, userId);
  }

  // ===========================================================================
  // INTERNAL HELPERS
  // ===========================================================================

  private checkWakeWords(transcript: string): boolean {
    if (!this.wakeWordMatchRegex) return false;
    return this.wakeWordMatchRegex.test(transcript);
  }

  private normalizeTranscript(transcript: string): string {
    // Remove wake words from the beginning
    let normalized = transcript;
    for (const regex of this.wakeWordRegexes) {
      normalized = normalized.replace(regex, '');
    }
    return normalized.trim();
  }

  private updateSession(userId: string): void {
    const session = this.sessions.get(userId);
    if (session?.isActive) {
      session.lastActivityAt = new Date();
      session.commandCount++;
    }
  }

  private async estimateDuration(blob: Blob): Promise<number> {
    // Estimate based on file size (rough approximation)
    // Assumes ~16kbps audio encoding
    const bytesPerMs = 16 / 8; // 16 kbps = 2 bytes per ms
    return Math.round(blob.size / bytesPerMs);
  }

  private createBlockedVoiceResult(
    transcript: string,
    confidence: number,
    startTime: number
  ): VoiceCommandResult {
    return {
      correlationId: uuidv4(),
      status: 'blocked',
      latencyMs: Date.now() - startTime,
      riskLane: 'GREEN',
      transcript,
      confidence,
      detectedIntents: [],
      manModeTriggered: false,
      processingMs: Date.now() - startTime,
    };
  }

  private createDurationExceededResult(
    transcript: string,
    confidence: number,
    startTime: number
  ): VoiceCommandResult {
    return this.createBlockedVoiceResult(transcript, confidence, startTime);
  }

  private createNoWakeWordResult(
    transcript: string,
    confidence: number,
    startTime: number
  ): VoiceCommandResult {
    return this.createBlockedVoiceResult(transcript, confidence, startTime);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export const omniPortVoice = VoiceCommandHandler.getInstance();

/**
 * Process a voice command (convenience function)
 */
export async function processVoiceCommand(
  transcript: string,
  confidence: number,
  audioUrl: string,
  durationMs: number,
  userId?: string
): Promise<VoiceCommandResult> {
  return omniPortVoice.processCommand(transcript, confidence, audioUrl, durationMs, userId);
}

/**
 * Quick voice command for testing
 */
export async function quickVoiceCommand(
  transcript: string,
  audioBlob: Blob,
  userId?: string
): Promise<VoiceCommandResult> {
  return omniPortVoice.quickCommand(transcript, audioBlob, userId);
}

/**
 * Start a voice session
 */
export function startVoiceSession(userId: string): VoiceSession {
  return omniPortVoice.startSession(userId);
}

/**
 * End a voice session
 */
export function endVoiceSession(userId: string): void {
  omniPortVoice.endSession(userId);
}

/**
 * Configure voice handler
 */
export function configureVoiceHandler(config: Partial<VoiceCommandConfig>): void {
  omniPortVoice.configure(config);
}
