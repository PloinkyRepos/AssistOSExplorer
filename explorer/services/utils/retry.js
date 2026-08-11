/**
 * Simple async retry helper. Retries the provided function if it throws.
 * @template T
 * @param {(attempt: number) => Promise<T>} operation
 * @param {{ retries?: number, delayMs?: number, shouldRetry?: (error: unknown, attempt: number) => boolean }} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(operation, {
    retries = 2,
    delayMs = 50,
    shouldRetry = () => true
} = {}) {
    let attempt = 0;
    let lastError;
    while (attempt <= retries) {
        try {
            return await operation(attempt);
        } catch (error) {
            lastError = error;
            if (attempt === retries || !shouldRetry(error, attempt)) {
                break;
            }
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        attempt += 1;
    }
    throw lastError;
}
