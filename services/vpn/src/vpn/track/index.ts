import {Router} from "websocket-express";
import {getLogger} from "log4js";
import {TrackDataQueue, TrackDataQueueEvents, TrackDataType} from "./TrackDataQueue";

const router = new Router();
const logger = getLogger('/vpn/track');

/*======= router ======*/
// track endpoint, use for retrieve tracked VPN usage
// path: /vpn/track
router.post('/', async (req, res) => {
    logger.debug(req.body);

    // validate body
    if (!Array.isArray(req.body)) {
        return res.status(400).send({code: 400, message: 'Invalid data format'});
    }
    const data: TrackDataType[] = req.body;

    let queuedCount = 0; // count of queued items
    const promises = []; // array of promises for adding to queue
    for (const item of data) {
        // validate item
        if (typeof item.datetime !== 'string' ||
            typeof item.country !== 'string' ||
            typeof item.isConnect !== 'boolean' ||
            !/^[A-Z]{2}$/.test(item.country) ||
            isNaN(new Date(item.datetime).getTime())) {
            logger.warn('Invalid track data item skipped', {
                item,
                user: req.payload.email
            });
            continue;
        }

        // add to queue
        promises.push(TrackDataQueue.add('processTrackData', {...item, email: req.payload.email}, {
            removeOnComplete: true,
            removeOnFail: true,
            attempts: 5,
            backoff: {
                type: 'exponential',
                delay: 1000, // initial delay of 1 second
            }
        }));
        queuedCount++;
    }

    // if no valid items were queued, return error
    if (queuedCount === 0) {
        return res.status(400).json({code: 400, message: 'No valid track data items found to queue'});
    }

    res.status(202).json({code: 202, message: 'Track data received'});
    await Promise.all(promises);
    logger.info('Queued track data for user:', req.payload.email);
});
/*======= router end ======*/

// Queue events for logging
TrackDataQueueEvents.on("completed", ({jobId}) => logger.info(`Job ${jobId} track data save done`));
TrackDataQueueEvents.on("failed", ({
                                       jobId,
                                       failedReason
                                   }) => logger.error(`Job ${jobId} track data save failed:`, failedReason));

module.exports = router