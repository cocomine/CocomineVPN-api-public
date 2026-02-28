import jwksClient from 'jwks-rsa';
import process from 'node:process';
import jwt from 'jsonwebtoken';
import {getLogger} from 'log4js';
import {Router} from 'express';
import {getKeyId, readPrivateKey, readPublicKey} from '../../../utils/getKey';

/**
 * Custom HTTP error class.
 */
export class HTTPError extends Error {
    response: Response;
    name: string = 'HTTPError';

    constructor(response: Response) {
        super(`HTTP Error ${response.status}`);
        this.response = response;
    }
}

/**
 * Custom error class for JWT generation errors.
 */
export class GenerateJWTError extends Error {
    name: string = 'generateJWTError';

    constructor() {
        super(`generateJWTError Error`);
    }
}

const router = Router();
const logger = getLogger('/auth/odic/exchange');
const client = jwksClient({
    jwksUri: `https://cocomine.cloudflareaccess.com/cdn-cgi/access/sso/oidc/${process.env.ODIC_CLIENT_ID}/jwks`,
});


// This function gets the CF Access public key that corresponds to the key ID in the header of the incoming request
const getKey: jwt.GetPublicKeyOrSecret = async (header, callback) => {
    try {
        const key = await client.getSigningKey(header.kid);
        return callback(null, key.getPublicKey());
    } catch (err: any) {
        callback(err);
    }
};

/**
 * Fetch user profile from CF Access
 */
async function fetch_user_profile(token: string) {
    const fetchRes = await fetch(
        'https://cocomine.cloudflareaccess.com/cdn-cgi/access/sso/oidc/' + process.env.ODIC_CLIENT_ID + '/userinfo',
        {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + token,
            },
        }
    );
    if (fetchRes.ok) return fetchRes.json();
    throw new HTTPError(fetchRes);
}

/**
 * Generates a JWT.
 */
async function generateJWT(payload: object, options?: jwt.SignOptions) {
    const publicKey = await readPublicKey();
    const privateKey = await readPrivateKey();

    // Ensure both keys are available before generating the token
    if (!privateKey || !publicKey) {
        throw new GenerateJWTError();
    }

    // Sign the JWT with the private key and include the key ID in the header
    return jwt.sign(payload, privateKey, {
        algorithm: 'RS256',
        keyid: getKeyId(publicKey),
        ...options,
    });
}

/*======= router ======*/
// path: /auth/odic/exchange
router.get('/', (req, res) => {
    // Extract the CF Access token from the Authorization header
    const cf_token = req.header('Authorization')?.split('Bearer ')[1];
    if (!cf_token) {
        res.status(401).json({code: 401, message: 'Missing required cf authorization token'});
        return;
    }

    // Verify the CF Access token using the public key obtained from the JWKS endpoint
    jwt.verify(cf_token, getKey, {algorithms: ['RS256']}, async (err, decoded) => {
        if (err instanceof jwt.TokenExpiredError) {
            return res.status(401).send({code: 401, message: 'Token Expired'});
        }
        if (err instanceof Error) {
            logger.error(err);
            return res.status(403).send({code: 403, message: 'Invalid Token'});
        }

        try {
            // Fetch user profile from CF Access
            const userinfo = await fetch_user_profile(cf_token);

            // Generate JWT for the user
            const payload = {
                name: userinfo.name,
                email: userinfo.email,
                ...(decoded as jwt.JwtPayload),
                exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // Token expires in 30 days
                jti: Math.random().toString(36).substring(7),
            };
            const token = await generateJWT(payload);

            // Respond with the generated token
            logger.info(`[${payload.email}] app token generated!`);
            res.json({code: 200, data: {token}});
        } catch (e) {
            logger.error('Failed to generate JWT:', e);

            // Handle different types of errors and respond with appropriate status codes and messages
            if (e instanceof HTTPError) {
                res.status(e.response.status).json({code: e.response.status, message: e.response.statusText});
                return;
            }

            // Handle JWT generation errors
            if (e instanceof GenerateJWTError) {
                res.status(500).json({code: 500, message: 'Failed to generate JWT'});
                return;
            }

            // For any other unexpected errors, respond with a generic internal server error message
            return res.status(500).json({code: 500, message: 'Internal server error'});
        }
    });
});

module.exports = router;