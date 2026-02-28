import {RequestHandler} from "express";
import jwksClient from "jwks-rsa";
import jwt from "jsonwebtoken";
import {getLogger} from "log4js";
import {JwtPayload} from "../custom";
import crypto from "crypto";
import {getPublicKeyGrpc} from "./grpc/auth/client";

const NODE_ENV = process.env.NODE_ENV || 'production';
const logger = getLogger('auth service');
const client = jwksClient({jwksUri: `https://cocomine.cloudflareaccess.com/cdn-cgi/access/certs`});

/**
 * Custom HTTP error class.
 *
 * This class extends the built-in Error class to include an HTTP response object.
 * It is used to represent HTTP errors with a specific response.
 *
 * @extends Error
 */
class HTTPError extends Error {
    response: Response;
    name: string = 'HTTPError';

    /**
     * Creates an instance of HTTPError.
     *
     * @param {Response} response - The HTTP response object associated with the error.
     */
    constructor(response: Response) {
        super(`HTTP Error ${response.status}`);
        this.response = response;
    }
}

// Cache for public keys from auth service (支援多個 keyId)
interface CachedKey {
    publicKey: string;
    fetchedAt: number;
}

const publicKeyCache = new Map<string, CachedKey>();
const PUBLIC_KEY_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch public key from auth microservice via gRPC
 */
async function fetchPublicKeyFromAuthService(keyId?: string): Promise<string | null> {
    const cacheKey = keyId ?? '__default__';

    // Check cache first
    const cached = publicKeyCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < PUBLIC_KEY_CACHE_TTL) {
        return cached.publicKey; // Return cached key if it's still valid
    }

    // Fetch from auth service via gRPC
    try {
        const publicKey = await getPublicKeyGrpc(keyId);
        if (publicKey) {
            // Cache the fetched public key
            publicKeyCache.set(cacheKey, {
                publicKey: publicKey,
                fetchedAt: Date.now()
            });

            return publicKey; // Return the fetched public key
        }
    } catch (err) {
        logger.warn('Failed to fetch public key from auth service via gRPC:', err);
    }

    // 如果 fetch 失敗但有過期的 cache，仍然使用它（graceful degradation）
    if (cached) {
        logger.warn(`Using expired cached key for ${cacheKey}`);
        return cached.publicKey;
    }

    return null; // Return null if we can't get the key from either source
}

/**
 * get public key for JWT verification, first try to get from CF Access JWKS endpoint,
 * if not found then try to fetch from auth microservice via gRPC
 */
const getKey: jwt.GetPublicKeyOrSecret = async (header, callback) => {
    try {
        // Try to get public key from CF Access JWKS endpoint
        const key = await client.getSigningKey(header.kid);
        return callback(null, key.getPublicKey());
    } catch (err: any) {
        // If the key is not found in JWKS endpoint, try to fetch from auth microservice via gRPC
        const publicKey = await fetchPublicKeyFromAuthService(header.kid);
        if (publicKey !== null) return callback(null, publicKey);

        return callback(err); // Return the original error if we can't get the key from either source
    }
};

/**
 * @description fetch user profileType from CF Access
 * @param token
 */
async function fetch_user_profile(token: string) {
    const fetchRes = await fetch('https://cocomine.cloudflareaccess.com/cdn-cgi/access/get-identity', {
        headers: {
            cookie: 'CF_Authorization=' + token,
            'X-Requested-With': 'XMLHttpRequest',
        }
    });
    if (fetchRes.ok) return fetchRes.json();
    throw new HTTPError(fetchRes);
}

/**
 * @description generate secure random token in base64 format
 * default length is 32
 * @param length length of the token
 */
function generateSecureTokenBase64(length = 32) {
    return crypto.randomBytes(length)
        .toString('base64')
        // Make it URL safe by replacing '+' and '/'
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '') // Remove padding characters
        .slice(0, length);
}

// This function verifies that the incoming request has a valid CF Access token
const verifyToken: RequestHandler = async (req, res, next) => {
    // for development debug
    if (NODE_ENV === 'development') {
        req.payload = {
            email: 'dev@example.com',
            aud: 'cocominevpn://login',
            name: 'developer',
        };
        next();
        logger.warn("Development mode, bypassing CF Access verification. Use virtual users " + req.payload.email + " to access the site.");
        return;
    }

    const token = req.cookies['CF_Authorization'] || req.header('Cf-Access-Jwt-Assertion') || req.header('Authorization')?.replace('Bearer ', '');
    // Make sure that the incoming request has our token header
    if (!token) {
        return res.status(401).send({code: 401, message: 'Missing required cf authorization token'});
    }

    // Verify the CF Access token
    jwt.verify(token, getKey, {algorithms: ['RS256']}, async (err, decoded) => {
        if (err instanceof jwt.TokenExpiredError) {
            return res.status(401).send({code: 401, message: 'Token Expired'});
        }
        if (err instanceof Error) {
            return res.status(403).send({code: 403, message: 'Invalid Token'});
        }

        //check the request is from app or web use 'user-agent'
        if (/CocomineVPNApp\/\d+\.\d+\.\d+/.test(req.header('user-agent') ?? "")) {
            //if from app use the decoded payload
            req.payload = decoded as JwtPayload;
        } else {
            // if from web, fetch user profile from CF Access
            try {
                const profile = await fetch_user_profile(token);
                req.payload = {...decoded as JwtPayload, name: profile.name};
            } catch (e) {
                if (e instanceof HTTPError) {
                    logger.error(`[${decoded?.sub}] failed to fetch user profile. (${req.ip})`);
                    return res.status(401).send({code: 401, message: 'Failed to fetch user profile.'});
                }
                logger.error(e);
                return res.status(500).send({code: 500, message: 'Internal server error'});
            }
        }

        logger.info(`[${req.payload.email}] verified! (${req.ip})`);
        next();
    });
};

export {verifyToken, fetch_user_profile, HTTPError, generateSecureTokenBase64};
