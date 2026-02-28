import * as PImage from "pureimage";
import fs from "fs";
import {parentPort} from "worker_threads";
import {PassThrough} from "stream";
import path from "node:path";
import log4js, {getLogger} from "log4js";
import * as crypto from "node:crypto";


const logger = getLogger('/vpn/[VM_startup_banner]/VM_startup_banner_generate_worker');

log4js.configure({
    appenders: {
        out: {type: 'stdout'},
        app: {
            type: 'dateFile',
            filename: 'logs/server',
            pattern: 'yyyy-MM-dd.log',
            alwaysIncludePattern: true,
            compress: true,
            numBackups: 30
        },
    },
    categories: {
        default: {appenders: ['out', 'app'], level: process.env.LOG_LEVEL || 'info'}
    },
});

// load font
PImage.registerFont(
    path.resolve(__dirname, "Poppins-Bold.ttf"),
    "Poppins",
).loadSync();
const width = 1100, height = 500 // image size

type parentPortMessage = { msg: string, expTime: string, country: string, jobId: crypto.UUID }

// listen for messages from the parent thread
parentPort?.on('message', async (data: parentPortMessage) => {
    logger.info("Received message from parent thread.");
    await create_img(data.msg, data.expTime, data.country, data.jobId);
});

/**
 * Creates an image with a specified message and estimated offline time.
 *
 * @param {string} msg - The message to be displayed on the image. Defaults to "US (Hong Kong) VPN node has been online!".
 * @param {string} expTime - The estimated offline time to be displayed on the image. Defaults to "N/A".
 * @param {string} country - The country code of the flag to be displayed on the image.
 * @param {UUID} jobId - The job ID of the image to be created. Defaults to a new UUID.
 */
async function create_img(msg: string, expTime: string = "N/A", country: string, jobId: crypto.UUID) {
    logger.info("Start create image. Job ID:", jobId);

    //create a new image
    let img = await PImage.decodePNGFromStream(
        fs.createReadStream(path.resolve(__dirname, `./flag/${country.toLowerCase()}.png`)))
    let ctx = img.getContext('2d')

    //draw text
    ctx.fillStyle = '#fff'
    ctx.textAlign = "center"
    let fontSize = 50;
    ctx.font = `${fontSize}px Poppins`;

    // first line
    let textWidth = ctx.measureText(msg).width;
    while (textWidth > width * 0.9) {
        fontSize--;
        ctx.font = `${fontSize}px Poppins`;
        textWidth = ctx.measureText(msg).width;
    }
    ctx.fillText(msg, width / 2, height * 0.7)

    //second line
    ctx.font = '30px Poppins'
    ctx.fillStyle = '#c3c3c3'
    ctx.fillText(`Estimated offline time:`, width / 2, height * 0.8 + 20)
    ctx.fillText(expTime, width / 2, height * 0.8 + 60)

    //create time watermark
    ctx.font = '15px Poppins'
    ctx.fillStyle = '#818181'
    ctx.textAlign = "right"
    const exp = new Date()
    ctx.fillText(`` + exp.toLocaleString('en'), width - 5, height - 5)

    //write out the png file
    //await PImage.encodePNGToStream(img, fs.createWriteStream('test.png'));

    // create a PNG image in memory buffer
    const passThroughStream = new PassThrough();
    const pngData: any[] | Uint8Array[] = [];
    passThroughStream.on("data", (chunk) => pngData.push(chunk));
    passThroughStream.on("end", () => {});
    await PImage.encodePNGToStream(img, passThroughStream);
    let buffer = Buffer.concat(pngData);

    // send the image buffer to the parent thread
    logger.info("Sending image buffer to parent thread. Job ID:", jobId);
    parentPort?.postMessage({jobId, buffer});
}