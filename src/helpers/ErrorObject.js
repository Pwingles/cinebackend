import { strings } from '../strings.js';

/**
 * Represents an error object that encapsulates details about an error, including
 * its message, provider, response code, hint, and whether it should be sent to the frontend.
 */
export class ErrorObject {
    provider;
    message;
    responseCode;
    hint;
    goesToFrontend;
    issueLink;

    /**
     * Constructs an instance of the ErrorObject class.
     *
     * @param {string} message - The error message.
     * @param {string} provider - The provider where the error occurred (e.g., "backend", "Vidrock").
     * @param {number} responseCode - The HTTP response code associated with the error. Null if not applicable.
     * @param {string} hint - If it goes to the frontend this is the hint to help extract the error. In the backend it is a note/hint for the developer of what could be the cause of the error.
     * @param {boolean} goesToFrontend - Whether the error should be sent to the frontend. Also influences the format of the error.
     * @param {boolean} issueLink - Whether to include an issue reporting link in the error.
     */
    constructor(
        message,
        provider,
        responseCode,
        hint,
        goesToFrontend = false,
        issueLink = false
    ) {
        this._message = message || 'Unknown error';
        this._provider = provider || 'backend';
        this._responseCode = responseCode || 500;
        this._hint = hint || 'No hint available';
        this._goesToFrontend = goesToFrontend;
        this._issueLink = issueLink;
    }

    /**
     * Gets the error message.
     * @returns {string} The error message.
     */
    get message() {
        return this._message;
    }

    /**
     * Sets the error message.
     * @param {string} value - The new error message.
     */
    set message(value) {
        this._message = value;
    }

    /**
     * Gets the provider where the error occurred.
     * @returns {string} The provider name.
     */
    get provider() {
        return this._provider;
    }

    /**
     * Sets the provider where the error occurred.
     * @param {string} value - The new provider name.
     */
    set provider(value) {
        this._provider = value;
    }

    /**
     * Gets the HTTP response code associated with the error.
     * @returns {number} The response code.
     */
    get responseCode() {
        return this._responseCode;
    }

    /**
     * Sets the HTTP response code associated with the error.
     * @param {number} value - The new response code.
     */
    set responseCode(value) {
        this._responseCode = value;
    }

    /**
     * Gets the hint to help extract the error.
     * @returns {string} The hint.
     */
    get hint() {
        return this._hint;
    }

    /**
     * Sets the hint to help extract the error.
     * @param {string} value - The new hint.
     */
    set hint(value) {
        this._hint = value;
    }

    /**
     * Gets whether the error should be sent to the frontend.
     * @returns {boolean} True if the error should be sent to the frontend, false otherwise.
     */
    get goesToFrontend() {
        return this._goesToFrontend;
    }

    /**
     * Sets whether the error should be sent to the frontend.
     * @param {boolean} value - True if the error should be sent to the frontend, false otherwise.
     */
    set goesToFrontend(value) {
        this._goesToFrontend = value;
    }

    /**
     * Gets whether to include an issue reporting link in the error.
     * @returns {boolean} True if the issue link should be included, false otherwise.
     */
    get issueLink() {
        return this._issueLink;
    }

    /**
     * Sets whether to include an issue reporting link in the error.
     * @param {boolean} value - True if the issue link should be included, false otherwise.
     */
    set issueLink(value) {
        this._issueLink = value;
    }

    /**
     * Converts the error object to a string representation.
     * @returns {string} The error message.
     */
    toString() {
        if (this._hint) {
            return `============ERROR============\n[${this._provider}] ${this._message}\nPossible cause: ${this._hint}\n============END ERROR============\n\n\n`;
        }
        return `============ERROR============\n[${this._provider}] ${this._message}\n============END ERROR============\n\n\n`;
    }

    /**
     * Gets the error code (extracted from message if it follows the pattern "CODE: message")
     */
    get code() {
        // Check if message starts with an error code pattern (e.g., "UPSTREAM_403: message")
        const codeMatch = this._message.match(/^([A-Z_]+):\s*(.+)$/);
        if (codeMatch) {
            return codeMatch[1];
        }
        // Default codes based on response code
        if (this._responseCode === 403) return 'UPSTREAM_403';
        if (this._responseCode === 401) return 'UPSTREAM_401';
        if (this._responseCode === 404) return 'NOT_FOUND';
        if (this._responseCode === 429) return 'RATE_LIMIT_EXCEEDED';
        return 'ERROR';
    }

    /**
     * Gets the error message without the code prefix
     */
    get cleanMessage() {
        const codeMatch = this._message.match(/^[A-Z_]+:\s*(.+)$/);
        return codeMatch ? codeMatch[1] : this._message;
    }

    /**
     * Converts the error object to a JSON representation.
     * @returns {Object} A JSON object containing error details.
     */
    toJSON() {
        const errorCode = this.code;
        const baseResponse = {
            code: errorCode,
            message: this.cleanMessage,
            hint: this._hint
        };

        // Add host if available in hint or provider
        if (this._hint && this._hint.includes('host:')) {
            const hostMatch = this._hint.match(/host:\s*([^\s,]+)/i);
            if (hostMatch) {
                baseResponse.host = hostMatch[1];
            }
        }

        // Legacy format for backwards compatibility
        if (this._goesToFrontend && this._issueLink) {
            return {
                ...baseResponse,
                location_key: this._provider,
                response: this._responseCode,
                reportTo:
                    'Please report this error and as many details as possible to us by using this link: ' +
                    strings.DEFAULT_ISSUE_LINK,
                error: true
            };
        } else if (this._goesToFrontend) {
            return {
                ...baseResponse,
                response: this._responseCode,
                location_key: this._provider,
                error: true
            };
        } else {
            return {
                ...baseResponse,
                location_key: this._provider,
                'what could be the cause?': this._hint
            };
        }
    }
}
