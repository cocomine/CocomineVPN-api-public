import {Channel, ClientError, ClientMiddlewareCall, createChannel, createClientFactory, Status} from "nice-grpc";
import {AuthServiceClient, AuthServiceDefinition} from "./auth";
import {getLogger} from "log4js";
import {CallOptions} from "nice-grpc-common";

const logger = getLogger('/grpc/auth');

// Auth service URL from environment
const AUTH_GRPC_URL = process.env.AUTH_GRPC_URL || 'auth:50051';

// Singleton instances for gRPC channel and client
let channel: Channel | null = null;
let client: AuthServiceClient | null = null;

/**
 * Get the gRPC client for the auth service. This function initializes
 * the client on first call and returns the same instance on subsequent calls.
 */
function getClient(): AuthServiceClient {
    if (!client) {
        channel = createChannel(AUTH_GRPC_URL);
        client = createClientFactory().use(loggingMiddleware).create(AuthServiceDefinition, channel);
        logger.info("gRPC client for auth service initialized at " + AUTH_GRPC_URL);
    }
    return client;
}

/**
 * Fetch the public key from the auth service via gRPC. Optionally, a keyId can be provided
 * @param keyId - Optional key ID to specify which public key to fetch (if the auth service supports multiple keys)
 * @returns An object containing success status and the public key (or null if failed)
 */
export async function getPublicKeyGrpc(keyId?: string) {
    // Lazy load the gRPC client to avoid circular dependency
    try {
        const response = await getClient().getPublicKey({keyId});
        return response.publicKey;
    } catch (err) {
        logger.error('Error calling GetPublicKey via gRPC:', err);
        return null;
    }
}

/**
 * Disconnect the gRPC client by closing the channel.
 */
export async function disconnect(): Promise<void> {
    if (channel) {
        channel.close();
        channel = null;
        client = null;
        logger.info('gRPC client disconnected.');
    }
}

/**
 * Middleware to log outgoing gRPC calls and their outcomes.
 */
async function* loggingMiddleware<Request, Response>(
    call: ClientMiddlewareCall<Request, Response>,
    options: CallOptions,
) {
    logger.info(`[Client] Calling ${call.method.path}`);
    try {
        const result = yield* call.next(call.request, options);
        logger.debug(`[Client] Finished ${call.method.path} successfully`);
        return result;
    } catch (error) {
        if (error instanceof ClientError) {
            logger.error(`[Client] Error ${call.method.path} end: ${Status[error.code]}: `, error);
        } else if (options.signal?.aborted) {
            logger.error(`[Client] Aborted ${call.method.path}`);
        } else {
            logger.error(`[Client] Error in ${call.method.path}: `, error);
        }
        throw error;
    }
}