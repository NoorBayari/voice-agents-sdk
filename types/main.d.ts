import { EventEmitter } from 'events';
import LiveKitManager, { type AudioLevelsResult, type CallAnalyticsResult, type ConnectionStatsResult, type ParticipantData, type PerformanceMetricsResult, type TrackStatsResult } from './classes/livekit-manager';
import ScreenWakeLock from './classes/screen-wake-lock';
/**
 * Configuration options for the HamsaVoiceAgent constructor
 * Allows customization of API endpoints and other global settings
 */
type HamsaVoiceAgentConfig = {
    /** Base URL for the Hamsa API. Defaults to 'https://api.tryhamsa.com' */
    API_URL?: string;
};
/**
 * Configuration options for starting a voice agent conversation
 *
 * Defines the agent to use, conversation parameters, voice capabilities,
 * and client-side tools that will be available during the conversation.
 */
type ConnectionDelays = {
    /** Delay in milliseconds for Android devices */
    android?: number;
    /** Delay in milliseconds for iOS devices */
    ios?: number;
    /** Default delay in milliseconds for other devices */
    default?: number;
};
type StartOptions = {
    /** Unique identifier of the voice agent to start (from Hamsa dashboard) */
    agentId: string;
    /**
     * Optional parameters to pass to the agent for conversation customization
     * These can be referenced in agent prompts using {{parameter_name}} syntax
     * @example { userName: "John", orderNumber: "12345", userTier: "premium" }
     */
    params?: Record<string, unknown>;
    /** Whether to enable voice interactions. If false, agent runs in text-only mode */
    voiceEnablement?: boolean;
    /** Array of client-side tools that the agent can call during conversations */
    tools?: Tool[];
    /** Optional user identifier for tracking and analytics */
    userId?: string;
    /** Force headphones usage on iOS devices when available */
    preferHeadphonesForIosDevices?: boolean;
    /** Platform-specific connection delays to prevent audio cutoff */
    connectionDelay?: ConnectionDelays;
    /** Disable wake lock to allow device sleep during conversation */
    disableWakeLock?: boolean;
};
/**
 * Definition of a client-side tool that can be called by the voice agent
 *
 * Tools allow agents to execute custom functions in the client environment,
 * such as retrieving user data, making API calls, or performing calculations.
 */
type Tool = {
    /** Unique name for the function (used by agent to identify the tool) */
    function_name: string;
    /** Clear description of what the function does (helps agent decide when to use it) */
    description: string;
    /** Array of parameters the function accepts */
    parameters?: ToolParameter[];
    /** Array of parameter names that are required for the function */
    required?: string[];
    /** Internal function mapping (used for tool execution) */
    func_map?: Record<string, unknown>;
};
/**
 * Definition of a parameter for a client-side tool
 * Describes the input that the function expects from the agent
 */
type ToolParameter = {
    /** Name of the parameter */
    name: string;
    /** Data type of the parameter (e.g., 'string', 'number', 'boolean') */
    type: string;
    /** Description of what the parameter represents */
    description: string;
};
/**
 * Response format for job details from the Hamsa API
 *
 * Returned by getJobDetails() method to check conversation completion
 * status and retrieve additional job metadata.
 */
type JobDetails = {
    /** Current status of the job (e.g., 'COMPLETED', 'IN_PROGRESS', 'FAILED') */
    status: string;
    /** Additional job properties that may be returned by the API */
    [key: string]: unknown;
};
/**
 * HamsaVoiceAgent - Main SDK class for voice agent integration
 *
 * This class provides the primary interface for integrating Hamsa voice agents
 * into web applications. It handles authentication, connection management,
 * conversation lifecycle, analytics, and client-side tool execution.
 *
 * Key features:
 * - Real-time voice communication with AI agents
 * - Comprehensive analytics and quality monitoring
 * - Client-side tool integration for extended functionality
 * - Automatic screen wake lock management during calls
 * - Event-driven architecture for reactive applications
 * - Built-in error handling and reconnection logic
 *
 * @example Basic Usage
 * ```typescript
 * import { HamsaVoiceAgent } from '@hamsa-ai/voice-agents-sdk';
 *
 * const agent = new HamsaVoiceAgent('your_api_key');
 *
 * // Listen for events
 * agent.on('callStarted', () => console.log('Call started'));
 * agent.on('answerReceived', (text) => console.log('Agent said:', text));
 * agent.on('transcriptionReceived', (text) => console.log('User said:', text));
 *
 * // Start conversation
 * await agent.start({
 *   agentId: 'your_agent_id',
 *   voiceEnablement: true,
 *   params: { userName: 'John', context: 'support_inquiry' }
 * });
 * ```
 *
 * @example With Client-side Tools
 * ```typescript
 * const weatherTool = {
 *   function_name: 'getCurrentWeather',
 *   description: 'Gets current weather for a location',
 *   parameters: [
 *     { name: 'location', type: 'string', description: 'City name' }
 *   ],
 *   required: ['location'],
 *   fn: async (location) => {
 *     const response = await fetch(`/api/weather?city=${location}`);
 *     return response.json();
 *   }
 * };
 *
 * await agent.start({
 *   agentId: 'weather_agent_id',
 *   tools: [weatherTool],
 *   voiceEnablement: true
 * });
 * ```
 *
 * @example Analytics Monitoring
 * ```typescript
 * // Real-time quality monitoring
 * agent.on('connectionQualityChanged', ({ quality, metrics }) => {
 *   if (quality === 'poor') {
 *     showNetworkWarning();
 *   }
 * });
 *
 * // Periodic analytics updates
 * agent.on('analyticsUpdated', (analytics) => {
 *   updateDashboard({
 *     duration: analytics.performanceMetrics.callDuration,
 *     quality: analytics.connectionStats.quality,
 *     latency: analytics.connectionStats.latency
 *   });
 * });
 *
 * // Get analytics snapshot anytime
 * const analytics = agent.getCallAnalytics();
 * ```
 */
declare class HamsaVoiceAgent extends EventEmitter {
    #private;
    /** Default fallback output volume when not connected */
    private static readonly DEFAULT_OUTPUT_VOLUME;
    /** Default fallback input volume when not connected */
    private static readonly DEFAULT_INPUT_VOLUME;
    /** Internal LiveKit manager instance for WebRTC communication */
    liveKitManager: LiveKitManager | null;
    /** Hamsa API key for authentication */
    apiKey: string;
    /** Base URL for Hamsa API endpoints */
    API_URL: string;
    /** Job ID for tracking conversation completion status */
    jobId: string | null;
    /** Screen wake lock manager to prevent device sleep during calls */
    wakeLockManager: ScreenWakeLock;
    /**
     * Creates a new HamsaVoiceAgent instance
     *
     * @param apiKey - Your Hamsa API key (get from https://dashboard.tryhamsa.com)
     * @param config - Optional configuration settings
     * @param config.API_URL - Custom API endpoint URL (defaults to https://api.tryhamsa.com)
     *
     * @example
     * ```typescript
     * // Using default API endpoint
     * const agent = new HamsaVoiceAgent('hamsa_api_key_here');
     *
     * // Using custom API endpoint
     * const agent = new HamsaVoiceAgent('hamsa_api_key_here', {
     *   API_URL: 'https://custom-api.example.com'
     * });
     * ```
     *
     * @throws {Error} If apiKey is not provided or invalid
     */
    constructor(apiKey: string, { API_URL }?: HamsaVoiceAgentConfig);
    /**
     * Adjusts the volume level for voice agent audio playback
     *
     * Controls the volume of the voice agent's speech output. This affects
     * all audio playback from the agent but does not change the user's
     * microphone input level.
     *
     * @param volume - Volume level between 0.0 (muted) and 1.0 (full volume)
     *
     * @example
     * ```typescript
     * // Set to half volume
     * agent.setVolume(0.5);
     *
     * // Mute agent completely
     * agent.setVolume(0);
     *
     * // Full volume
     * agent.setVolume(1.0);
     *
     * // Can be called during active conversation
     * agent.on('callStarted', () => {
     *   agent.setVolume(0.8); // Slightly quieter
     * });
     * ```
     */
    setVolume(volume: number): void;
    /**
     * Gets the current output volume level
     *
     * Returns the current volume setting for voice agent audio playback.
     * This represents the playback volume for all voice agent audio streams.
     *
     * @returns Current output volume level (0.0 = muted, 1.0 = full volume)
     *
     * @example
     * ```typescript
     * const currentVolume = agent.getOutputVolume();
     * console.log(`Volume: ${Math.round(currentVolume * 100)}%`);
     * ```
     */
    getOutputVolume(): number;
    /**
     * Gets the current input volume level from the user's microphone
     *
     * Returns the current microphone input level for voice activity detection.
     * Can be used to create visual feedback for user speaking indicators.
     *
     * @returns Current input volume level (0.0 = no input, 1.0 = maximum input)
     *
     * @example
     * ```typescript
     * // Create voice activity indicator
     * setInterval(() => {
     *   const inputLevel = agent.getInputVolume();
     *   updateMicrophoneIndicator(inputLevel);
     * }, 100);
     * ```
     */
    getInputVolume(): number;
    /**
     * Mutes or unmutes the user's microphone
     *
     * Controls the user's microphone input to the voice agent conversation.
     * When muted, the user's voice will not be transmitted to the agent.
     *
     * @param muted - True to mute microphone, false to unmute
     *
     * @example
     * ```typescript
     * // Mute microphone
     * agent.setMicMuted(true);
     *
     * // Toggle microphone
     * const isMuted = agent.isMicMuted();
     * agent.setMicMuted(!isMuted);
     * ```
     */
    setMicMuted(muted: boolean): void;
    /**
     * Checks if the user's microphone is currently muted
     *
     * @returns True if microphone is muted, false if unmuted
     *
     * @example
     * ```typescript
     * if (agent.isMicMuted()) {
     *   showUnmutePrompt();
     * }
     * ```
     */
    isMicMuted(): boolean;
    /**
     * @internal
     * Notifies the agent about user activity
     *
     * Prevents the agent from interrupting when the user is actively interacting
     * with the interface. The agent will not attempt to speak for at least 2 seconds
     * after user activity is detected.
     *
     * @example
     * ```typescript
     * // Prevent interruptions while user is typing
     * textInput.addEventListener('input', () => {
     *   agent.sendUserActivity();
     * });
     *
     * // Prevent interruptions during UI interactions
     * document.addEventListener('click', () => {
     *   agent.sendUserActivity();
     * });
     * ```
     */
    sendUserActivity(): void;
    /**
     * @internal
     * Sends a contextual update to the agent
     *
     * Informs the agent about user actions or state changes that are not direct
     * conversation messages but may influence the agent's responses. Unlike regular
     * messages, contextual updates don't trigger the agent to take its turn in
     * the conversation.
     *
     * @param context - Contextual information to send to the agent
     *
     * @example
     * ```typescript
     * // Inform agent about navigation
     * agent.sendContextualUpdate("User navigated to checkout page");
     *
     * // Inform about app state changes
     * agent.sendContextualUpdate("User's cart total: $127.50");
     *
     * // Inform about user preferences
     * agent.sendContextualUpdate("User selected dark mode theme");
     * ```
     */
    sendContextualUpdate(context: string): void;
    /**
     * Gets frequency data from the user's microphone input
     *
     * Returns frequency domain data for audio visualization and analysis.
     * Can be used to create voice activity indicators, audio visualizers,
     * or advanced voice processing features.
     *
     * @returns Uint8Array containing frequency data (0-255 per frequency bin)
     *
     * @example
     * ```typescript
     * // Create simple audio visualizer
     * function updateVisualizer() {
     *   const frequencyData = agent.getInputByteFrequencyData();
     *   const average = frequencyData.reduce((a, b) => a + b) / frequencyData.length;
     *   const percentage = Math.round((average / 255) * 100);
     *   document.getElementById('micLevel').style.width = `${percentage}%`;
     * }
     * setInterval(updateVisualizer, 50);
     * ```
     */
    getInputByteFrequencyData(): Uint8Array;
    /**
     * Gets frequency data from the agent's audio output
     *
     * Returns frequency domain data from the agent's voice for analysis
     * and visualization. Useful for creating voice characteristic displays
     * or audio processing features.
     *
     * @returns Uint8Array containing frequency data (0-255 per frequency bin)
     *
     * @example
     * ```typescript
     * // Analyze agent voice characteristics
     * agent.on('speaking', () => {
     *   const interval = setInterval(() => {
     *     const frequencyData = agent.getOutputByteFrequencyData();
     *     const dominantFreq = findDominantFrequency(frequencyData);
     *     updateVoiceAnalysis(dominantFreq);
     *   }, 100);
     *
     *   agent.once('listening', () => clearInterval(interval));
     * });
     * ```
     */
    getOutputByteFrequencyData(): Uint8Array;
    /**
     * Initiates a new voice agent conversation
     *
     * This is the primary method for starting interactions with a voice agent.
     * It handles authentication, connection establishment, tool registration,
     * and event forwarding. The method is asynchronous and will emit events
     * to indicate connection status and conversation progress.
     *
     * @param options - Configuration options for the conversation
     * @param options.agentId - Unique identifier of the voice agent (from Hamsa dashboard)
     * @param options.params - Parameters to customize the conversation context
     * @param options.voiceEnablement - Enable voice interactions (default: false for text-only)
     * @param options.tools - Client-side tools available to the agent
     *
     * @throws {Error} Authentication failures, network errors, or invalid configuration
     *
     * @example Basic voice conversation
     * ```typescript
     * try {
     *   await agent.start({
     *     agentId: 'agent_12345',
     *     voiceEnablement: true,
     *     params: {
     *       userName: 'Alice',
     *       userTier: 'premium',
     *       sessionContext: 'product_support'
     *     }
     *   });
     *   console.log('Voice agent conversation started');
     * } catch (error) {
     *   console.error('Failed to start conversation:', error);
     * }
     * ```
     *
     * @example With custom tools
     * ```typescript
     * const customerDataTool = {
     *   function_name: 'getCustomerData',
     *   description: 'Retrieves customer account information',
     *   parameters: [
     *     { name: 'customerId', type: 'string', description: 'Customer ID' }
     *   ],
     *   required: ['customerId'],
     *   fn: async (customerId) => {
     *     return await customerAPI.getProfile(customerId);
     *   }
     * };
     *
     * await agent.start({
     *   agentId: 'support_agent',
     *   voiceEnablement: true,
     *   tools: [customerDataTool],
     *   params: { department: 'billing' }
     * });
     * ```
     *
     * @example Event handling
     * ```typescript
     * // Set up event listeners before starting
     * agent.on('callStarted', () => {
     *   console.log('Conversation began');
     *   startRecordingMetrics();
     * });
     *
     * agent.on('error', (error) => {
     *   console.error('Conversation error:', error);
     *   handleConversationError(error);
     * });
     *
     * await agent.start({ agentId: 'my_agent', voiceEnablement: true });
     * ```
     */
    start({ agentId, params, voiceEnablement, tools, userId: _userId, preferHeadphonesForIosDevices: _preferHeadphonesForIosDevices, connectionDelay: _connectionDelay, disableWakeLock: _disableWakeLock, }: StartOptions): Promise<void>;
    /**
     * Terminates the current voice agent conversation
     *
     * Safely ends the conversation, disconnects from the WebRTC session,
     * releases system resources (including screen wake lock), and performs
     * cleanup. This method should be called when the conversation is complete.
     *
     * @example
     * ```typescript
     * // End conversation when user clicks hang up
     * hangupButton.addEventListener('click', () => {
     *   agent.end();
     * });
     *
     * // End conversation after timeout
     * setTimeout(() => {
     *   agent.end();
     *   console.log('Conversation ended due to timeout');
     * }, 300000); // 5 minutes
     *
     * // Listen for end event
     * agent.on('callEnded', () => {
     *   console.log('Conversation terminated');
     *   updateUI('disconnected');
     *   saveConversationSummary();
     * });
     * ```
     */
    end(): void;
    /**
     * Temporarily pauses the voice agent conversation
     *
     * Pauses audio transmission and reception while maintaining the underlying
     * connection. The conversation can be resumed later using resume(). This
     * is useful for temporary interruptions without ending the entire session.
     *
     * @example
     * ```typescript
     * // Pause when user needs to take another call
     * pauseButton.addEventListener('click', () => {
     *   agent.pause();
     *   console.log('Conversation paused');
     * });
     *
     * // Auto-pause after period of silence
     * let silenceTimeout;
     * agent.on('listening', () => {
     *   silenceTimeout = setTimeout(() => {
     *     agent.pause();
     *     showResumePrompt();
     *   }, 60000); // 1 minute of silence
     * });
     *
     * agent.on('speaking', () => {
     *   clearTimeout(silenceTimeout);
     * });
     *
     * // Listen for pause event
     * agent.on('callPaused', () => {
     *   showPausedIndicator();
     *   disableMicrophone();
     * });
     * ```
     */
    pause(): void;
    /**
     * Resumes a paused voice agent conversation
     *
     * Restores audio transmission and reception, continuing the conversation
     * from where it was paused. Re-acquires screen wake lock to prevent
     * device sleep during active conversation.
     *
     * @example
     * ```typescript
     * // Resume when user is ready to continue
     * resumeButton.addEventListener('click', () => {
     *   agent.resume();
     *   console.log('Conversation resumed');
     * });
     *
     * // Resume automatically after user interaction
     * document.addEventListener('click', () => {
     *   if (agent.isPaused) {
     *     agent.resume();
     *   }
     * });
     *
     * // Listen for resume event
     * agent.on('callResumed', () => {
     *   hidePausedIndicator();
     *   enableMicrophone();
     *   showActiveIndicator();
     * });
     * ```
     */
    resume(): void;
    /**
     * Retrieves job details from the Hamsa API using the stored jobId.
     * Implements retry logic with exponential backoff.
     * @param maxRetries - Maximum number of retry attempts.
     * @param initialRetryInterval - Initial delay between retries in milliseconds.
     * @param backoffFactor - Factor by which the retry interval increases each attempt.
     * @returns Job details object.
     */
    getJobDetails(maxRetries?: number, initialRetryInterval?: number, backoffFactor?: number): Promise<JobDetails>;
    /**
     * Retrieves current network connection statistics and quality metrics
     *
     * @returns Connection statistics object or null if not connected
     *
     * @example
     * ```typescript
     * const stats = agent.getConnectionStats();
     * if (stats) {
     *   console.log(`Latency: ${stats.latency}ms`);
     *   console.log(`Quality: ${stats.quality}`);
     *   console.log(`Packet Loss: ${stats.packetLoss}%`);
     *
     *   // Show network warning for poor quality
     *   if (stats.quality === 'poor') {
     *     showNetworkWarning(stats);
     *   }
     * }
     * ```
     */
    getConnectionStats(): ConnectionStatsResult | null;
    /**
     * Retrieves current audio levels and quality metrics for both user and agent
     *
     * @returns Audio metrics object or null if not connected
     *
     * @example
     * ```typescript
     * const audio = agent.getAudioLevels();
     * if (audio) {
     *   // Update UI audio level meters
     *   updateAudioMeter('user', audio.userAudioLevel);
     *   updateAudioMeter('agent', audio.agentAudioLevel);
     *
     *   // Display speaking time statistics
     *   const userMinutes = Math.floor(audio.userSpeakingTime / 60000);
     *   const agentMinutes = Math.floor(audio.agentSpeakingTime / 60000);
     *   console.log(`User spoke for ${userMinutes} minutes`);
     *   console.log(`Agent spoke for ${agentMinutes} minutes`);
     * }
     * ```
     */
    getAudioLevels(): AudioLevelsResult | null;
    /**
     * Retrieves current performance metrics including response times and call duration
     *
     * @returns Performance metrics object or null if not connected
     *
     * @example
     * ```typescript
     * const perf = agent.getPerformanceMetrics();
     * if (perf) {
     *   // Monitor response time for quality assurance
     *   if (perf.responseTime > 3000) {
     *     console.warn('High response time:', perf.responseTime + 'ms');
     *   }
     *
     *   // Display call duration
     *   const minutes = Math.floor(perf.callDuration / 60000);
     *   const seconds = Math.floor((perf.callDuration % 60000) / 1000);
     *   updateTimer(`${minutes}:${seconds.toString().padStart(2, '0')}`);
     * }
     * ```
     */
    getPerformanceMetrics(): PerformanceMetricsResult | null;
    /**
     * Retrieves information about all participants in the conversation
     *
     * @returns Array of participant data objects (empty array if not connected)
     *
     * @example
     * ```typescript
     * const participants = agent.getParticipants();
     *
     * participants.forEach(participant => {
     *   console.log(`Participant: ${participant.identity}`);
     *   console.log(`Connected: ${new Date(participant.connectionTime)}`);
     *
     *   // Display participant info in UI
     *   if (participant.identity.includes('agent')) {
     *     showAgentStatus('connected', participant.metadata);
     *   }
     * });
     *
     * // Check if agent is present
     * const hasAgent = participants.some(p => p.identity.includes('agent'));
     * ```
     */
    getParticipants(): ParticipantData[];
    /**
     * Retrieves current audio track statistics and stream information
     *
     * @returns Track statistics object or null if not connected
     *
     * @example
     * ```typescript
     * const trackStats = agent.getTrackStats();
     * if (trackStats) {
     *   console.log(`Active tracks: ${trackStats.activeTracks}/${trackStats.totalTracks}`);
     *   console.log(`Audio elements: ${trackStats.audioElements}`);
     *
     *   // Check track health
     *   if (trackStats.activeTracks === 0) {
     *     console.warn('No active audio tracks');
     *     showAudioWarning();
     *   }
     * }
     * ```
     */
    getTrackStats(): TrackStatsResult | null;
    /**
     * Retrieves comprehensive analytics combining all metrics into a single snapshot
     *
     * This is the primary method for accessing complete conversation analytics,
     * combining connection statistics, audio metrics, performance data, participant
     * information, and track statistics into a unified result.
     *
     * @returns Complete analytics object or null if not connected
     *
     * @example
     * ```typescript
     * const analytics = agent.getCallAnalytics();
     * if (analytics) {
     *   // Log comprehensive conversation summary
     *   console.log('=== Conversation Analytics ===');
     *   console.log(`Duration: ${analytics.performanceMetrics.callDuration}ms`);
     *   console.log(`Quality: ${analytics.connectionStats.quality}`);
     *   console.log(`Latency: ${analytics.connectionStats.latency}ms`);
     *   console.log(`Participants: ${analytics.participants.length}`);
     *
     *   // Send to analytics service
     *   analyticsService.recordConversation({
     *     sessionId: generateSessionId(),
     *     agentId: currentAgentId,
     *     timestamp: Date.now(),
     *     metrics: analytics
     *   });
     *
     *   // Check for quality issues
     *   if (analytics.connectionStats.packetLoss > 5) {
     *     reportNetworkIssue(analytics);
     *   }
     * }
     * ```
     */
    getCallAnalytics(): CallAnalyticsResult | null;
}
export { HamsaVoiceAgent };
export default HamsaVoiceAgent;
