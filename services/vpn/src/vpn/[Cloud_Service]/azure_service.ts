import {DefaultAzureCredential} from "@azure/identity";
import {ComputeManagementClient} from "@azure/arm-compute";

//check environment variables
if (!process.env.AZURE_TENANT_ID || !process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET || !process.env.AZURE_SUBSCRIPTION_ID) {
    console.error("Azure authentication information not found, please check environment variables");
    process.exit(1);
}

const resourceGroupName = 'VM';
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
const credential = new DefaultAzureCredential();
const client = new ComputeManagementClient(credential, subscriptionId);

async function listAllInstances() {
    return client.virtualMachines.list(resourceGroupName);
}

async function getInstanceStatus(id: string) {
    return await client.virtualMachines.get(resourceGroupName, id);
}

async function getInstanceView(id: string) {
    return await client.virtualMachines.instanceView(resourceGroupName, id);
}

async function stopInstance(id: string) {
    return await client.virtualMachines.beginDeallocate(resourceGroupName, id);
}

async function startInstance(id: string) {
    return await client.virtualMachines.beginStart(resourceGroupName, id);
}

export default {listAllInstances, getInstanceStatus, startInstance, stopInstance, getInstanceView};
export {listAllInstances, getInstanceStatus, startInstance, stopInstance, getInstanceView};