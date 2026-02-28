import RedisClient from '../redis_service';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'crypto';
import {existsSync} from 'node:fs';
import schedule from "node-schedule";
import {promisify} from "node:util";
import {generateKeyPair as nodeGenerateKeyPair} from 'node:crypto';
import {getLogger} from 'log4js';

const logger = getLogger('/untils/getKey');
const generateKeyPairAsync = promisify(nodeGenerateKeyPair); // Promisify the generateKeyPair function from the crypto module

// Keys directory path
const KEYS_DIR = process.env.NODE_ENV === 'production'
    ? '/app/keys'
    : path.join(__dirname, '../../keys');

// Schedule job to generate private key every 14 days
const job = schedule.scheduleJob('0 0 */14 * *', async () => {
    await generateKeyPair();
    logger.info('Private key generated and saved to private.key, next job at ' + job.nextInvocation());
});

// Generate key pair on startup if not exist
if (!existsSync(path.join(KEYS_DIR, 'private.key')) || !existsSync(path.join(KEYS_DIR, 'public.key'))) {
    job.invoke();
}

/**
 * Generates an RSA key pair and saves it.
 */
async function generateKeyPair(bits: number = 2048) {
    const {publicKey, privateKey} = await generateKeyPairAsync('rsa', {
        modulusLength: bits,
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'pkcs1',
            format: 'pem'
        }
    });

    // Ensure keys directory exists
    if (!existsSync(KEYS_DIR)) {
        const {mkdir} = await import('node:fs/promises');
        await mkdir(KEYS_DIR, {recursive: true});
    }

    await writeFile(path.join(KEYS_DIR, 'private.key'), privateKey);
    await writeFile(path.join(KEYS_DIR, 'public.key'), publicKey);
    await RedisClient.set('APP_Token_PublicKey:' + getKeyId(publicKey), publicKey, {EX: 60 * 60 * 24 * 30}); // 30 days
    await RedisClient.set('APP_Token_Current_PublicKey', publicKey, {EX: 60 * 60 * 24 * 7}); // 7 days
    await RedisClient.set('APP_Token_Current_PrivateKey', privateKey, {EX: 60 * 60 * 24 * 7}); // 7 days
}

/**
 * Reads the private key from Redis or from the file system if not found in Redis.
 */
const readPrivateKey = async (): Promise<string | null> => {
    // Try to get the private key from Redis
    let privateKey = await RedisClient.get('APP_Token_Current_PrivateKey');
    if (privateKey) return privateKey;

    // If not found in Redis, read from the file system
    const keyPath = path.join(KEYS_DIR, 'private.key');
    if (!existsSync(keyPath)) return null; // Private key not found
    privateKey = await readFile(keyPath, {encoding: 'utf-8', flag: 'r'});

    // Cache the private key in Redis for future requests
    await RedisClient.set('APP_Token_Current_PrivateKey', privateKey, {EX: 60 * 60 * 24});

    return privateKey; // Return the private key read from the file system
};

/**
 * Reads the public key from Redis or from the file system if not found in Redis.
 */
const readPublicKey = async (keyId?: string): Promise<string | null> => {
    let publicKey: string | null;

    // Try to get the public key from Redis using the key ID if provided
    if (keyId) {
        publicKey = await RedisClient.get('APP_Token_PublicKey:' + keyId);
    } else {
        publicKey = await RedisClient.get('APP_Token_Current_PublicKey');
    }

    if (publicKey) return publicKey; // Return the cached public key if available

    // If not found in Redis, read from the file system
    const keyPath = path.join(KEYS_DIR, 'public.key');
    if (!existsSync(keyPath)) return null; // Public key not found
    publicKey = await readFile(keyPath, {encoding: 'utf-8', flag: 'r'});

    // If a key ID is provided, verify that the public key read from the file system matches the requested key ID
    if (keyId && getKeyId(publicKey) !== keyId) {
        return null; // The public key read from the file system does not match the requested key ID
    }

    // Cache the public key in Redis for future requests
    await RedisClient.set('APP_Token_PublicKey:' + getKeyId(publicKey), publicKey, {EX: 60 * 60 * 24});
    await RedisClient.set('APP_Token_Current_PublicKey', publicKey, {EX: 60 * 60 * 24});

    return publicKey; // Return the public key read from the file system
};

/**
 * Generates a key ID by hashing the public key.
 */
const getKeyId = (publicKey: string) => {
    return createHash('SHA256').update(publicKey).digest('hex');
};

export {readPublicKey, readPrivateKey, getKeyId};
