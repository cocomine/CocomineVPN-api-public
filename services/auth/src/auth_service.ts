import {RequestHandler} from 'express';
import jwksClient from 'jwks-rsa';
import jwt from 'jsonwebtoken';
import {getLogger} from 'log4js';
import {JwtPayload} from './types';
import {readPublicKey} from './utils/getKey';
import crypto from 'crypto';

const NODE_ENV = process.env.NODE_ENV || 'production';

/**
 * Custom HTTP error class.
 */
class HTTPError extends Error {
    response: Response;
    name: string = 'HTTPError';

    constructor(response: Response) {
        super(`HTTP Error ${response.status}`);
        this.response = response;
    }
}

const logger = getLogger('auth service');
const client = jwksClient({jwksUri: `https://cocomine.cloudflareaccess.com/cdn-cgi/access/certs`});

// Get the CF Access public key
const getKey: jwt.GetPublicKeyOrSecret = async (header, callback) => {
    try {
        // First try to get the key from CF Access JWKS endpoint
        const key = await client.getSigningKey(header.kid);
        return callback(null, key.getPublicKey());
    } catch (err: any) {
        // If failed, try to read the public key from local file (for development or fallback)
        const publicKey = await readPublicKey(header.kid);
        if (publicKey !== null) return callback(null, publicKey);

        return callback(err); // If both methods fail, return the original error
    }
};

// Verify token middleware
const verifyToken: RequestHandler = async (req, res, next) => {
    if (NODE_ENV === 'development') {
        req.payload = {
            email: 'dev@example.com',
            aud: 'cocominevpn://login',
            name: 'developer',
        };
        next();
        logger.warn('Development mode, bypassing CF Access verification. Use virtual users ' + req.payload.email + ' to access the site.');
        return;
    }

    const token = req.cookies['CF_Authorization'] || req.header('Cf-Access-Jwt-Assertion') || req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).send({code: 401, message: 'Missing required cf authorization token'});
    }

    jwt.verify(token, getKey, {algorithms: ['RS256']}, async (err, decoded) => {
        if (err instanceof jwt.TokenExpiredError) {
            return res.status(401).send({code: 401, message: 'Token Expired'});
        }
        if (err instanceof Error) {
            return res.status(403).send({code: 403, message: 'Invalid Token'});
        }

        if (/CocomineVPNApp\/\d+\.\d+\.\d+/.test(req.header('user-agent') ?? '')) {
            req.payload = decoded as JwtPayload;
        } else {
            try {
                const profile = await fetch_user_profile(token);
                req.payload = {...(decoded as JwtPayload), name: profile.name};
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

/**
 * Fetch user profile from CF Access
 */
async function fetch_user_profile(token: string) {
    const fetchRes = await fetch('https://cocomine.cloudflareaccess.com/cdn-cgi/access/get-identity', {
        headers: {
            cookie: 'CF_Authorization=' + token,
            'X-Requested-With': 'XMLHttpRequest',
        },
    });
    if (fetchRes.ok) return fetchRes.json();
    throw new HTTPError(fetchRes);
}

/**
 * Generate secure random token in base64 format
 */
function generateSecureTokenBase64(length = 32) {
    const bytesNeeded = Math.ceil(length * 0.75);
    return crypto
        .randomBytes(bytesNeeded)
        .toString('base64')
        .slice(0, length)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

export {verifyToken, fetch_user_profile, HTTPError, generateSecureTokenBase64};
