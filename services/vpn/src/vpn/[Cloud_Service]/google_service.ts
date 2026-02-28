import path from "node:path";
import compute from "@google-cloud/compute";

const projectID = 'eveapp-320519';
const zone = ['asia-east1-b', 'us-central1-f', 'asia-east2-a', 'asia-northeast2-a', 'europe-west2-c', 'asia-northeast1-c', 'us-west4-a', 'asia-south1-c'];
const instancesClient = new compute.InstancesClient({
    projectId: projectID,
    keyFilename: path.join(__dirname, 'eveapp-320519-b798c08cc7cd.json'),
})

const zoneOperationsClient = new compute.ZoneOperationsClient({
    projectId: projectID,
    keyFilename: path.join(__dirname, 'eveapp-320519-b798c08cc7cd.json'),
})

/**
 * @description get operation status
 * @param zone zone
 * @param operationName operation name
 */
async function getOperationsStatus(zone: string, operationName: string) {
    return zoneOperationsClient.get({
        project: projectID,
        zone,
        operation:　operationName
    })
}

/**
 * @description wait for zone operation to complete
 * @param zone zone
 * @param operationName operation name
 */
async function waitZoneOperation(zone: string, operationName: string) {
    const [operation] = await zoneOperationsClient.wait({
        project: projectID,
        zone,
        operation: operationName
    });
    return operation;
}

/**
 * @description list all instances
 */
async function listAllInstances() {
    let data: { zone: string; data: any[] }[] = []
    for (const item of zone) {
        const res = await instancesClient.list({
            project: projectID,
            zone: item
        }).catch((err) => {
            throw err;
        });
        data.push({zone: item, data: res[0]})
    }
    return data;
}

/**
 * @description get instance status
 * @param instanceID instance id
 * @param zone zone
 */
async function getInstanceStatus(instanceID: string, zone: string) {
    return instancesClient.get({
        project: projectID,
        zone: zone,
        instance: instanceID
    })
}

/**
 * @description start instance
 * @param instanceID instance id
 * @param zone zone
 * @param requestId
 */
function startInstance(instanceID: string, zone: string, requestId?: string | null) {
    return instancesClient.start({
        project: projectID,
        zone: zone,
        instance: instanceID,
        requestId
    })
}

/**
 * @description stop instance
 * @param instanceID instance id
 * @param zone zone
 * @param requestId
 */
async function stopInstance(instanceID: string, zone: string, requestId?: string | null) {
    return instancesClient.stop({
        project: projectID,
        zone: zone,
        instance: instanceID,
        requestId
    })
}

export {
    listAllInstances,
    getInstanceStatus,
    startInstance,
    stopInstance,
    getOperationsStatus,
    waitZoneOperation
};