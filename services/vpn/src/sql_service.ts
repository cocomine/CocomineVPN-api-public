import mysql from 'mysql2/promise';
import {getLogger} from "log4js";

const logger = getLogger('SqlPool');

// Ensure the SQL_DATABASE_URL environment variable is set
if (!process.env.SQL_DATABASE_URL) {
    throw new Error('SQL_DATABASE_URL environment variable is not set.');
}

// Create a MySQL connection pool
let SqlPool: mysql.Pool;
try {
    SqlPool = mysql.createPool({
        uri: process.env.SQL_DATABASE_URL,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
    });
    logger.info('MySQL connection pool created.');
} catch (err) {
    logger.error('Failed to create MySQL connection pool. Check SQL_DATABASE_URL and database availability.', err);
    throw new Error('Failed to initialize MySQL connection pool.');
}

async function shutdownSqlPool(): Promise<void> {
    if (!SqlPool) {
        return;
    }
    try {
        await SqlPool.end();
        logger.info('MySQL connection pool has been closed.');
    } catch (err) {
        logger.error('Error while closing MySQL connection pool.', err);
    }
}

export default SqlPool
export {shutdownSqlPool};