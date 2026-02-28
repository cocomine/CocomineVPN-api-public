import {Router} from "express";
import {getLogger} from "log4js";
import xss from "xss";
import {vm_data} from "../../VM_Data";
import {getInstanceStatus} from "../../[Cloud_Service]/google_service";
import {VMEventMap} from "../../[VM_Class]/VM";
import {Response} from "express-serve-static-core";
import {GoogleVM_Status} from "../../[VM_Class]/Google_vm";

// Define troubleshoot status types
type TroubleshootStatus = 'pending' | 'success' | 'failed' | 'info' | 'warning' | 'finished';

const router = Router();
const logger = getLogger('/vpn/:id/troubleshoot');

/*======= router ======*/
//troubleshoot VPN node
//path: /vpn/:id/troubleshoot
router.get('/:id/troubleshoot', async (req, res) => {
    const id = xss(req.params['id']);

    //check id format
    if (!/^[0-9]+$/.test(id)) {
        res.status(400);
        res.json({code: 400, message: 'VPN server ID format error'});
        return;
    }

    //is server exist?
    const vm = vm_data.find((item) => item.id === id);
    if (vm === undefined) {
        res.status(404);
        res.json({code: 404, message: 'Not found VPN server ' + id});
        return;
    }

    req.setTimeout(5 * 60 * 1000);
    res.setTimeout(5 * 60 * 1000); // Set timeout to 5 minutes
    // set header for ndjson
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Keep-Alive', 'timeout=300');
    let id_counter = 0;

    //Streaming result of troubleshoot
    //Step 1: Check if the VM is running?
    write(res, id_counter, "檢查節點狀態...", 'pending');

    if (vm.expired) {
        let instanceStatus: GoogleVM_Status;
        try {
            const [instance] = await getInstanceStatus(vm.id, vm.zone);
            if (!instance || !instance.status) {
                // No instance information available
                write(res, id_counter, '找不到節點實例資訊!', 'failed');
                return res.end();
            }
            instanceStatus = instance.status as GoogleVM_Status;
        } catch (e) {
            // Error retrieving instance status
            write(res, id_counter, '無法取得節點狀態，請稍後再試', 'failed');
            logger.error(e);
            return res.end();
        }

        if (instanceStatus === 'RUNNING') {
            // is running
            write(res, id_counter, '節點狀態正常', 'success');
        } else {
            // is not running
            write(res, id_counter, '節點未在線', 'failed');

            // Step 1.1: Try to restart the VM, id+1
            write(res, ++id_counter, '嘗試重新啟動節點...', 'pending');

            try {
                await new Promise((resolve, reject) => {
                    let heartbeat: NodeJS.Timeout | undefined;
                    let timer: NodeJS.Timeout | undefined;

                    const cleanup = () => {
                        if (heartbeat) {
                            clearInterval(heartbeat);
                            heartbeat = undefined;
                        }
                        if (timer) {
                            clearTimeout(timer);
                            timer = undefined;
                        }
                        vm.removeEventListener('onPowerChange', listener);
                    };

                    // Restart the VM
                    const listener: VMEventMap['onPowerChange'] = (_, newData) => {
                        if (newData) {
                            cleanup();
                            resolve(newData);
                        }
                    };

                    try {
                        // heartbeat to keep connection alive
                        heartbeat = setInterval(() => {
                            if (!res.writableEnded) {
                                res.write('\n');
                            }
                        }, 5000);

                        // Timeout after 5 minutes to align with request/response timeout
                        timer = setTimeout(() => {
                            cleanup();
                            reject(new TimeoutError());
                        }, 300 * 1000); // 5 minutes timeout

                        // Listen for power state change
                        vm.addEventListener('onPowerChange', listener);
                        res.once('close', cleanup); // Cleanup on client disconnect
                        res.once('finish', cleanup); // Cleanup on response finish
                        vm.updateStatus(); // Trigger status update
                    } catch (e) {
                        cleanup();
                        reject(e);
                    }
                });
            } catch (e) {
                // Timeout error
                if (e instanceof TimeoutError) {
                    write(res, id_counter, '節點重新啟動超時，請稍後再試', 'failed');
                    return res.end();
                }
                // Failed to restart
                write(res, id_counter, '節點重新啟動失敗', 'failed');
                logger.error(e);
                return res.end();
            }

            // Successfully restarted
            write(res, id_counter, '節點重新啟動成功', 'success');
        }
    } else {
        // is not started
        write(res, id_counter, '節點未啟動，請先啟動節點', 'warning');
        return res.end();
    }

    //Finish troubleshoot, id+1
    write(res, ++id_counter, '節點診斷完成', 'finished');
    res.end();
});

/**
 * Write a message to the response stream
 * @param res - Response object
 * @param id - Message ID
 * @param message - Message content
 * @param status - Message status
 */
function write(res: Response, id: number, message: string, status: TroubleshootStatus) {
    // Check if the response is still writable
    if (res.writableEnded || res.closed) return;

    res.write(JSON.stringify({
        id,
        message,
        timestamp: new Date().toISOString(),
        status
    }) + '\n');
}

/**
 * Custom Timeout Error class
 */
class TimeoutError extends Error {
    constructor(message?: string) {
        super(message);
        this.name = "TimeoutError";
    }
}

module.exports = router;