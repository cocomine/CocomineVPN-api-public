import {
    AuthServiceDefinition,
    AuthServiceImplementation,
    DeepPartial,
    GetPublicKeyRequest,
    GetPublicKeyResponse
} from "./auth";
import {CallContext} from "nice-grpc-common";
import {getLogger} from "log4js";
import {readPublicKey} from "../utils/getKey";
import {createServer, ServerError, ServerMiddlewareCall, Status} from "nice-grpc";

const logger = getLogger('/grpc/server');
const server = createServer();

class AuthServiceImpl implements AuthServiceImplementation {
    async getPublicKey(request: GetPublicKeyRequest, context: CallContext): Promise<DeepPartial<GetPublicKeyResponse>> {
        try {
            const publicKey = await readPublicKey(request.keyId);
            if (!publicKey) {
                throw new ServerError(Status.NOT_FOUND, 'No public key found');
            }

            return {keyId: request.keyId, publicKey};
        } catch (err) {
            logger.error('Failed to read public key:', err);

            // If the error is already a ServerError, rethrow it. Otherwise, throw a generic internal server error.
            if (err instanceof ServerError) {
                throw err;
            }

            // For any other unexpected errors, return a generic internal server error response
            throw new ServerError(Status.INTERNAL, 'Internal server error');
        }
    }
}

/**
 * Middleware to log incoming gRPC calls and their outcomes.
 */
async function* loggingMiddleware<Request, Response>(
    call: ServerMiddlewareCall<Request, Response>,
    context: CallContext,
) {
    logger.info(`[Server] Handling ${call.method.path}`);

    try {
        const result = yield* call.next(call.request, context);
        logger.debug(`[Server] Finished ${call.method.path} successfully`);
        return result;
    } catch (error) {
        if (error instanceof ServerError) {
            logger.error(`[Server] Error ${call.method.path} end: ${Status[error.code]}: `, error);
        } else if (context.signal.aborted) {
            logger.error(`[Server] Aborted ${call.method.path}`);
        } else {
            logger.error(`[Server] Error in ${call.method.path}: `, error);
        }
        throw error;
    }
}

/**
 * Starts the gRPC server on the specified port.
 * @param port The port number to listen on.
 * @returns A promise that resolves when the server is successfully started.
 * @throws {Error} If the server fails to start.
 */
export async function startGrpcServer(port: number) {
    server.with(loggingMiddleware).add(AuthServiceDefinition, new AuthServiceImpl());
    await server.listen('0.0.0.0:' + port);
    logger.info(`Starting grpc server on port ${port}`);
}

/**
 * Stops the gRPC server gracefully.
 * @returns A promise that resolves when the server is successfully stopped.
 * @throws {Error} If the server fails to stop.
 */
export async function stopGrpcServer() {
    await server.shutdown();
    logger.info('gRPC server stopped.');
}