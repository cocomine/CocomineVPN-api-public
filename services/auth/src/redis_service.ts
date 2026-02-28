import {createClient} from 'redis';
import {getLogger} from 'log4js';

const logger = getLogger('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const RedisClient = createClient({
    url: REDIS_URL,
    database: 1
});

RedisClient.on('error', (err) => logger.error('Redis Client Error', err));
RedisClient.on('connect', () => logger.info('Connected to Redis'));

export default RedisClient;
