import {RequestHandler, Router} from 'express';
import {initializeApp} from 'firebase-admin/app';
import {getAppCheck} from 'firebase-admin/app-check';
import {getLogger} from 'log4js';
import path from 'node:path';
import {credential} from 'firebase-admin';
import process from 'node:process';

interface JwtPayload {
    email?: string;
    aud?: string;
    name?: string;
    sub?: string;
}

const router = Router();
const logger = getLogger('/auth/odic');

initializeApp({
    credential: credential.cert(path.join(__dirname, 'cocominevpn-434407-a260077310b7.json')),
});

/**
 * Verify Firebase App Check token.
 */
const appCheckVerify: RequestHandler = async (req, res, next) => {
    const appCheckToken = req.header('Authorization')?.split('Bearer ')[1];

    if (!appCheckToken) {
        res.status(401).json({code: 401, message: 'Missing app check token'});
        return;
    }

    try {
        const claim = await getAppCheck().verifyToken(appCheckToken);
        logger.info(`[${claim.token.sub}] try login with app`);
        next();
    } catch (err) {
        console.error(err);
        res.status(403).json({code: 403, message: 'Invalid app check token'});
        return;
    }
};

/*======= router ======*/
// path: /auth/odic/exchange
router.use('/exchange', require('./exchange'));
logger.info('Loaded /auth/odic/exchange');

// This route requires Firebase App Check token verification.
// If the token is valid, it responds with the client secret and client ID.
// path: /auth/odic
router.get('/', appCheckVerify, async (_req, res) => {
    res.json({
        code: 200,
        data: {
            clientSecret: process.env.ODIC_CLIENT_SECRET,
            clientId: process.env.ODIC_CLIENT_ID,
        },
    });
});

module.exports = router;