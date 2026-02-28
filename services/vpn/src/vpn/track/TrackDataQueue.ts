import {ConnectionOptions, Queue, QueueEvents, Worker} from "bullmq";
import {country} from "../[VM_Class]/VM";
import SqlPool from "../../sql_service";
import {getLogger} from "log4js";

type TrackDataType = {
    datetime: string | any;
    country: country | any;
    // True is connect, false is disconnect.
    isConnect: boolean | any;
}
type TrackDataJobType = TrackDataType & {
    email: string;
}

const NODE_ENV = process.env.NODE_ENV || "production";
const connection: ConnectionOptions = {
    host: NODE_ENV === "development" ? "localhost" : "redis",
    port: 6379
}
const TrackDataQueue = new Queue("TrackDataQueue", {connection})
const TrackDataQueueEvents = new QueueEvents("TrackDataQueue", {connection});
const logger = getLogger('/vpn/track [TrackDataQueue]');

/**
 * Start the TrackDataQueue worker to process queued track data.
 */
function startTrackDataQueueWorker() {
    return new Worker<TrackDataJobType>("TrackDataQueue", async (job) => {
            logger.debug("Job " + job.id + " save to sql: ", job.data);
            // process track data
            const sqlConnection = await SqlPool.getConnection();
            const sql = `INSERT INTO Connect_log (User_email, Connect_country, Connect_datetime, isConnect)
                         VALUES (?, ?, ?, ?)`;
            const datetime = new Date(job.data.datetime);

            // Pad single digits with leading zero
            const pad = (n: number) => n.toString().padStart(2, '0');
            const formattedDate = `${datetime.getFullYear()}-${pad(datetime.getMonth() + 1)}-${pad(datetime.getDate())} ${pad(datetime.getHours())}:${pad(datetime.getMinutes())}:${pad(datetime.getSeconds())}`;

            const values = [
                job.data.email,
                job.data.country,
                formattedDate,
                job.data.isConnect ? 1 : 0];

            try{
                await sqlConnection.execute(sql, values); // execute insert
            } finally {
                sqlConnection.release();
            }
        },
        {connection, concurrency: 3}
    );
}

const TrackDataQueueWorker = startTrackDataQueueWorker();

/**
 * Shutdown the TrackDataQueue gracefully.
 */
async function shutdownQueue() {
    try {
        await TrackDataQueue.close();
        await TrackDataQueueWorker.close()
        await TrackDataQueueEvents.close();
        logger.log('TrackDataQueue disconnect.');
    } catch (e) {
        logger.error("Error shutdownQueue", e);
    }
}

export {shutdownQueue, TrackDataQueue, TrackDataQueueEvents};
export type {TrackDataType, TrackDataJobType};