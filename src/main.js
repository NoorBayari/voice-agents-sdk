import WebSocketManager from './classes/websocket_manager';
import ScreenWakeLock from "./classes/screen_wake_lock";
import { EventEmitter } from 'events';

class HamsaVoiceAgent extends EventEmitter {
	/**
     * Creates a new HamsaVoiceAgent instance.
     *
     * @param {string} apiKey - API key.
     * @param {object} [config] - Optional config.
     * @param {string} [config.API_URL="https://api.tryhamsa.com"] - API URL.
     * @param {string} [config.WS_URL="wss://bots.tryhamsa.com/stream"] - WebSocket URL.
     */
	constructor(
		apiKey,
		{
			API_URL = "https://api.tryhamsa.com",
			WS_URL = "wss://bots.tryhamsa.com/stream",
		} = {}
	) {
        super();
        this.webSocketManager = null;
        this.apiKey = apiKey;
		this.API_URL = API_URL;
		this.WS_URL = WS_URL;
        this.jobId = null;
        this.wakeLockManager = new ScreenWakeLock();
    }

    /**
     * Sets the volume for the audio playback.
     * @param {number} volume - Volume level between 0.0 and 1.0.
     */
    setVolume(volume) {
        if (this.webSocketManager) {
            this.webSocketManager.setVolume(volume);
        }
    }

    /**
     * Starts a new voice agent call.
     * @param {object} options - Configuration options for the call.
     */
    async start({
        agentId = null,
        params = {},
        voiceEnablement = false,
        tools = []
    }) {
        try {
            const conversationId = await this.#init_conversation(agentId, params, voiceEnablement, tools);
            if (!conversationId) {
                throw new Error("Failed to initialize conversation.");
            }
            this.jobId = conversationId; // Store the jobId

            this.webSocketManager = new WebSocketManager(
                this.WS_URL,
                conversationId,
                (error) => this.emit('error', error),               // onError
                () => this.emit('start'),                            // onStart
                (transcription) => this.emit('transcriptionReceived', transcription), // onTranscriptionReceived
                (answer) => this.emit('answerReceived', answer),     // onAnswerReceived
                () => this.emit('speaking'),                         // onSpeaking
                () => this.emit('listening'),                        // onListening
                () => this.emit('closed'),                           // onClosed
                voiceEnablement,
                tools,
                this.apiKey,
                (remoteStream) => this.emit('remoteAudioStreamAvailable', remoteStream), // onRemoteStreamAvailable
                (localStream) => this.emit('localAudioStreamAvailable', localStream),    // onLocalStreamAvailable
                (info) => this.emit('info', info)                    // onInfo
            );

            this.webSocketManager.startCall();

			// Acquire the screen wake lock when the call starts
			try {
				await this.wakeLockManager.acquire();
			} catch (error) {
				console.error("Failed to acquire wake lock:", error);
			}
            this.emit('callStarted');
        } catch (e) {
            this.emit('error', new Error("Error in starting the call! Make sure you initialized the client with init()."));
        }
    }

    /**
     * Ends the current voice agent call.
     */
    end() {
        try {
            if (this.webSocketManager) {
                this.webSocketManager.endCall();
                this.emit('callEnded');
            }
			// Release the wake lock when pausing the call
			if (this.wakeLockManager?.isActive()) {
				this.wakeLockManager
					.release()
					.catch((err) =>
						console.error("Error in releasing wake lock:", err)
					);
            }
        } catch (e) {
            this.emit('error', new Error("Error in ending the call! Make sure you initialized the client with init()."));
        }
    }


    /**
     * Pauses the current voice agent call.
     */
    pause() {
        if (this.webSocketManager) {
            this.webSocketManager.pauseCall();
			// Release the wake lock when pausing the call
			if (this.wakeLockManager?.isActive()) {
                this.wakeLockManager.release().catch((err) =>
                  console.error("Error in releasing wake lock:", err)
                );
              }              
            this.emit('callPaused');
        }
    }

    /**
     * Resumes the paused voice agent call.
     */
    resume() {
        if (this.webSocketManager) {
			this.webSocketManager.resumeCall();
			// Re-acquire the wake lock when resuming the call
			this.wakeLockManager
				.acquire()
				.catch((err) =>
					console.error("Error acquiring wake lock on resume:", err)
				);
			this.emit("callResumed");
		}
    }
    
    /**
     * Retrieves job details from the Hamsa API using the stored jobId.
     * Implements retry logic with exponential backoff.
     * @param {number} [maxRetries=5] - Maximum number of retry attempts.
     * @param {number} [initialRetryInterval=1000] - Initial delay between retries in milliseconds.
     * @param {number} [backoffFactor=2] - Factor by which the retry interval increases each attempt.
     * @returns {Promise<Object>} Job details object.
     */
    async getJobDetails(maxRetries = 5, initialRetryInterval = 1000, backoffFactor = 2) {
        if (!this.jobId) {
            throw new Error("Cannot fetch job details: jobId is not set. Start a conversation first.");
        }

        const url = `${this.API_URL}/v1/voice-agents/conversation/${this.jobId}`;
        const headers = {
            "Authorization": `Token ${this.apiKey}`,
            "Content-Type": "application/json"
        };
        const params = new URLSearchParams({ jobId: this.jobId });

        let currentInterval = initialRetryInterval;

        const fetchJobDetails = async (attempt = 1) => {
            try {
                const response = await fetch(`${url}?${params.toString()}`, { method: 'GET', headers });
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`);
                }
                const data = await response.json();
                // Check if the job status is COMPLETED
                if (data.data.status === "COMPLETED") {
                    return data.data;
                } else {
                    throw new Error(`Job status is not COMPLETED: ${data.data.status}`);
                }
            } catch (error) {
                if (attempt < maxRetries) {
                    console.warn(`Attempt ${attempt} failed: ${error.message}. Retrying in ${currentInterval / 1000} seconds...`);
                    await this.#delay(currentInterval); // Wait before retrying
                    currentInterval *= backoffFactor; // Increase the interval
                    return fetchJobDetails(attempt + 1);
                } else {
                    throw new Error(`Failed to fetch job details after ${maxRetries} attempts: ${error.message}`);
                }
            }
        };

        return fetchJobDetails();
    }
    
    /**
     * Initializes a conversation with the Hamsa API.
     * @private
     * @param {string|null} voiceAgentId - The voice agent ID.
     * @param {object} params - Additional parameters.
     * @param {boolean} voiceEnablement - Flag to enable voice features.
     * @param {Array} tools - Array of tools/functions to be used.
     * @returns {Promise<string|null>} The conversation jobId or null if failed.
     */
    async #init_conversation(voiceAgentId, params, voiceEnablement, tools) {
        const headers = {
            "Authorization": `Token ${this.apiKey}`,
            "Content-Type": "application/json"
        };
        const llmtools = tools?.length > 0 ? this.#convertToolsToLLMTools(tools) : [];
        const body = {
            voiceAgentId,
            params,
            voiceEnablement,
            tools: llmtools
        };

        const requestOptions = {
            method: "POST",
            headers: headers,
            body: JSON.stringify(body),
            redirect: "follow"
        };
        
        try {
            const response = await fetch(`${this.API_URL}/v1/voice-agents/conversation-init`, requestOptions);
            const result = await response.json();
            return result["data"]["jobId"];
        } catch (error) {
            this.emit('error', new Error("Error in initializing the call. Please double-check your API_KEY and ensure you have sufficient funds in your balance."));
            return null;
        }
    }

    /**
     * Converts tools to LLMTools format.
     * @private
     * @param {Array} tools - Array of tool objects.
     * @returns {Array} Array of LLMTool objects.
     */
    #convertToolsToLLMTools(tools) {
        return tools.map(item => {
        const llmTool = {
            type: "function",
            function: {
                name: item.function_name,
                description: item.description,
                parameters: {
                    type: "object",
                    properties: item.parameters?.reduce((acc, param) => {
                        acc[param.name] = {
                            type: param.type,
                            description: param.description
                        };
                        return acc;
                    }, {}) || {}, 
                    required: item.required || [] 
                }
            }
        };
    
        // If func_map is provided, copy it as is
        if (item.func_map) {
            llmTool.function.func_map = item.func_map;
        }
    
        return llmTool;
        });
    }

    /**
     * Delays execution for a specified amount of time.
     * @private
     * @param {number} ms - Milliseconds to delay.
     * @returns {Promise} Promise that resolves after the delay.
     */
    #delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Support both named and default exports
export { HamsaVoiceAgent };
export default HamsaVoiceAgent;
