import VM, {AlreadyStatusError, ReadOnlyError} from "./VM";
import {getInstanceView, startInstance, stopInstance} from "../[Cloud_Service]/azure_service";


type AzureVM_Status = "running" | "deallocated" | "starting" | "stopping" | "stopped" | "deallocating" | "creating";

class Azure_vm extends VM {

    /**
     * Constructs a new Azure VM instance.
     *
     * This constructor calls the parent class's constructor with the provided parameters and sets the provider to "azure".
     *
     * @param {string} status - The status of the Azure VM instance.
     * @param {string} id - The ID of the Azure VM instance.
     * @param {string} zone - The zone of the Azure VM instance.
     */
    constructor(status: AzureVM_Status, id: string, zone: string) {
        super(status, id, zone, "azure");
    }

    /**
     * Determines the power status of the Azure VM instance.
     *
     * This method checks the current status of the Azure VM instance and returns true if the status is "running", indicating that the VM is powered on.
     * Otherwise, it returns false, indicating that the VM is not powered on.
     *
     * @protected
     * @returns {boolean} Returns true if the Azure VM instance is powered on (status is "running"), false otherwise.
     */
    protected determinePowerStatus(): boolean {
        return this.powerOn = this.status === "running";
    }

    /**
     * Starts the Azure VM instance.
     *
     * This method first checks if the current status of the VM instance is "running". If it is, it throws an AlreadyStatusError.
     * It then checks if the VM instance is read-only and if the bypassReadonly parameter is false. If both conditions are met, it throws a ReadOnlyError.
     * Finally, it calls the startInstance function with the current instance's ID as a parameter. The startInstance function returns a promise that resolves when the start operation completes.
     *
     * @async
     * @param {boolean} bypassReadonly - A boolean indicating whether to bypass the read-only status of the VM instance. Default is false.
     * @param expired - Optional parameter to set the expired date of the VM. Default is last setting.
     * @returns {Promise<any>} A promise that resolves when the start operation completes.
     * @throws {AlreadyStatusError} If the VM instance is already running.
     * @throws {ReadOnlyError} If the VM instance is read-only and bypassReadonly is false.
     */
    async start(bypassReadonly: boolean = false, expired = this.expired): Promise<any> {
        if (this.status !== "deallocated") throw new AlreadyStatusError(`This VM is already ${this.status}!`);
        if ((this.readonly === "stopOnly" || this.readonly === "readOnly") && !bypassReadonly) throw new ReadOnlyError(`This VM is ${this.readonly}!`);
        this.expired = expired;

        // Polling the status of the VM instance until it is powered on
        let count = 0;
        let id = setInterval(async () => {
            await this.updateStatus();
            if (this.status === "running") {
                clearInterval(id);
            }
            if (count > 120) {
                clearInterval(id);
            }
        }, 1000);
        await this.updateStatus();
        return await startInstance(this.id);
    }

    /**
     * Stops the Azure VM instance.
     *
     * This method first checks if the current status of the VM instance is "deallocated". If it is, it throws an AlreadyStatusError.
     * It then checks if the VM instance is read-only and if the bypassReadonly parameter is false. If both conditions are met, it throws a ReadOnlyError.
     * Finally, it calls the stopInstance function with the current instance's ID as a parameter. The stopInstance function returns a promise that resolves when the stop operation completes.
     *
     * @async
     * @param {boolean} bypassReadonly - A boolean indicating whether to bypass the read-only status of the VM instance. Default is false.
     * @returns {Promise<any>} A promise that resolves when the stop operation completes.
     * @throws {AlreadyStatusError} If the VM instance is already deallocated.
     * @throws {ReadOnlyError} If the VM instance is read-only and bypassReadonly is false.
     */
    async stop(bypassReadonly: boolean = false): Promise<any> {
        if (this.status !== "running") throw new AlreadyStatusError(`This VM is already ${this.status}!`);
        if ((this.readonly === "startOnly" || this.readonly === "readOnly") && !bypassReadonly) throw new ReadOnlyError(`This VM is ${this.readonly}!`);
        this.expired = null;

        // Polling the status of the VM instance until it is powered off
        let count = 0;
        let id = setInterval(async () => {
            await this.updateStatus();
            if (this.status === "deallocated" || this.status === "stopped") {
                clearInterval(id);
            }
            if (count > 60) {
                clearInterval(id);
            }
        }, 1000);
        await this.updateStatus();
        return await stopInstance(this.id);
    }

    /**
     * Updates the status of the Azure VM instance.
     *
     * This method first calls the getInstanceView function with the current instance's ID as a parameter.
     * The getInstanceView function returns a promise that resolves with the status of the VM instance.
     * The method then uses a regular expression to extract the power state from the returned status and updates the current instance's status property with the extracted power state.
     * Finally, it determines the power status of the VM instance and updates the powerOn property.
     *
     * @async
     * @returns {Promise<void>} A promise that resolves when the status update operation completes.
     */
    async updateStatus(): Promise<void> {
        const res = await getInstanceView(this.id);
        const newStatus = /.+\/(.+)/.exec(res.statuses?.find((item) => /PowerState\//.test(item.code || ''))?.code || '')?.[1] as string;
        const oldStatus = this.status;
        const oldPowerState = this.isPowerOn;

        this.status = newStatus;
        this.determinePowerStatus();

        // Update the status of the VM instance
        if (oldStatus !== newStatus) this.triggerEvent('onStatusChange', oldStatus, newStatus);
        if (oldPowerState !== this.isPowerOn) this.triggerEvent('onPowerChange', oldPowerState, this.isPowerOn);
    }

}

export default Azure_vm;
export {AzureVM_Status};