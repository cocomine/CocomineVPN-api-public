import {createClient} from "redis";
import log4js from "log4js";


const logger = log4js.getLogger("redis");
const NODE_ENV = process.env.NODE_ENV || "production";

const RedisClient = createClient({
    url: NODE_ENV === "development" ? "redis://localhost:6379/0" : "redis://redis:6379/0",
    database: 0,
});

RedisClient.on("error", (error) => {
    logger.error(error);
});

// RedisClient.connect().then(() => {
//     logger.info("Redis connected");
// });

export default RedisClient;