import VM, {AlreadyStatusError, OptionalCallback, ReadOnlyError} from "./VM";
import {getInstanceStatus, startInstance, stopInstance, waitZoneOperation} from "../[Cloud_Service]/google_service";
import {broadcastsMessage} from "../v2/ws/BroadcastsMessage";
import {getLogger} from "log4js";


type GoogleVM_Status =
    "PROVISIONING"
    | "STAGING"
    | "RUNNING"
    | "STOPPING"
    | "SUSPENDING"
    | "SUSPENDED"
    | "TERMINATED"
    | "STOPPED"
    | "REPAIRING"
    | "RESTARTING"
    | "PENDING_STOP"
    | "UNKNOWN";


class Google_vm extends VM<GoogleVM_Status> {

    private readonly logger = getLogger('/vpn/[VM_Class]/Google_vm');

    /**
     * Constructs a new Google VM instance.
     *
     * This constructor calls the parent class's constructor with the provided parameters and sets the provider to "google".
     *
     * @param {string} status - The status of the Google VM instance.
     * @param {string} id - The ID of the Google VM instance.
     * @param {string} zone - The zone of the Google VM instance.
     */
    constructor(status: GoogleVM_Status, id: string, zone: string) {
        super(status, id, zone, "google");
    }

    /**
     * Determines the power status of the VM instance.
     *
     * This method checks the current status of the VM instance and returns true if the status is "RUNNING", indicating that the VM is powered on.
     * Otherwise, it returns false, indicating that the VM is not powered on.
     *
     * @protected
     * @returns {boolean} Returns true if the VM instance is powered on (status is "RUNNING"), false otherwise.
     */
    protected determinePowerStatus(): boolean {
        const STANDARD_RUNNING_STATES: GoogleVM_Status[] = ["RUNNING"];
        return this.powerOn = STANDARD_RUNNING_STATES.includes(this.status);
    }

    /**
     * Starts the Google VM instance.
     * @param {boolean} bypassReadonly - Optional parameter to bypass the readonly status of the VM. Default is false.
     * @param expired - Optional parameter to set the expired date of the VM. Default is last setting.
     * @param option - Optional parameter to set the success and fail callbacks.
     * @throws {AlreadyStatusError} If the VM is already in the "RUNNING" status.
     * @throws {ReadOnlyError} If the VM is in "stopOnly" or "readOnly" status and bypassReadonly is not set to true.
     * @returns {Promise} A promise that resolves when the startInstance function completes.
     */
    async start(bypassReadonly: boolean = false, expired = this.expired, option?: OptionalCallback): Promise<any> {
        // Check current status
        if (this.status === "RUNNING") throw new AlreadyStatusError(`This VM is already ${this.status}!`);
        if ((this.readonly === "stopOnly" || this.readonly === "readOnly") && !bypassReadonly) throw new ReadOnlyError(`This VM is ${this.readonly}!`);
        this.expired = expired; // Update expired time

        // Generate a unique request ID for idempotency
        const requestId = crypto.randomUUID();
        await this.updateStatus();
        const statusWatcher = this.beginStatusPolling("RUNNING", 120); // Poll status for up to 2 minutes

        try {
            // Start the instance and get the operation handle for monitoring
            const [operationHandle] = await startInstance(this.id, this.zone, requestId);
            const operationName = this.resolveOperationName(operationHandle);

            // Validate operation name
            if (!operationName) {
                clearInterval(statusWatcher);
                this.expired = null;
                throw new Error(`Failed to resolve start operation name for ${this.id}`);
            }

            // Fire-and-forget monitor: the HTTP caller returns immediately while we keep tracking the LRO in background.
            this.monitorOperation("START", operationName, statusWatcher)
                .then(() => {
                    this.logger.info(`[${this.id}] start succeeded`);
                    option?.successCallBack?.();
                }).catch((err) => {
                    this.logger.error(`[${this.id}] start failed`, err)
                    option?.failCallBack?.(err);
                });

            return {operation: operationName};
        } catch (error) {
            // Clean up on failure
            clearInterval(statusWatcher);
            this.expired = null;
            throw error;
        }
    }

    /**
     * Stops the Google VM instance.
     *
     * @param {boolean} bypassReadonly - Optional parameter to bypass the readonly status of the VM. Default is false.
     * @param option - Optional parameter to set the success and fail callbacks.
     * @throws {AlreadyStatusError} If the VM is already in the "TERMINATED" status.
     * @throws {ReadOnlyError} If the VM is in "startOnly" or "readOnly" status and bypassReadonly is not set to true.
     * @returns {Promise} A promise that resolves when the stopInstance function completes.
     */
    async stop(bypassReadonly: boolean = false, option?: OptionalCallback): Promise<any> {
        // Check current status
        if (this.status === "TERMINATED") throw new AlreadyStatusError(`This VM is already ${this.status}!`);
        if ((this.readonly === "startOnly" || this.readonly === "readOnly") && !bypassReadonly) throw new ReadOnlyError(`This VM is ${this.readonly}!`);
        this.expired = null; // Clear expired time

        // Generate a unique request ID for idempotency
        const requestId = crypto.randomUUID();
        await this.updateStatus();
        const statusWatcher = this.beginStatusPolling("TERMINATED", 120); // Poll status for up to 2 minute

        try {
            // Stop the instance and get the operation handle for monitoring
            const [operationHandle] = await stopInstance(this.id, this.zone, requestId);
            const operationName = this.resolveOperationName(operationHandle);

            // Validate operation name
            if (!operationName) {
                clearInterval(statusWatcher);
                throw new Error(`Failed to resolve stop operation name for ${this.id}`);
            }

            // Same async monitor pattern as start(): caller sees instant response, WS handles eventual failure.
            this.monitorOperation("STOP", operationName, statusWatcher)
                .then(() => {
                    this.logger.info(`[${this.id}] stop succeeded`);
                    option?.successCallBack?.();
                }).catch((err) => {
                    this.logger.error(`[${this.id}] stop failed`, err)
                    option?.failCallBack?.(err);
                }
            );

            return {operation: operationName};
        } catch (error) {
            // Clean up on failure
            clearInterval(statusWatcher);
            throw error;
        }
    }

    /**
     * Updates the status of the Google VM instance.
     *
     * This method first calls the getInstanceStatus function with the current instance's ID and zone as parameters.
     * The getInstanceStatus function returns a promise that resolves with the status of the VM instance.
     * The method then updates the current instance's status property with the returned status.
     * Finally, it determines the power status of the VM instance and updates the powerOn property.
     *
     * @async
     * @returns {Promise<void>} A promise that resolves when the status update operation completes.
     */
    async updateStatus(): Promise<void> {
        const res = await getInstanceStatus(this.id, this.zone);
        const oldStatus = this.status;
        const newStatus = res[0].status as GoogleVM_Status;
        const oldPowerState = this.isPowerOn;

        this.status = newStatus; // Update the status
        this.determinePowerStatus(); // Determine the power status

        // Clear expired time if the VM is powered off and the expired time has passed
        if (!this.isPowerOn && this.expired != null && this.expired.getTime() < Date.now()) {
            this.expired = null;
        }

        // Trigger the event
        if (oldStatus !== newStatus) this.triggerEvent('onStatusChange', oldStatus, newStatus);
        if (oldPowerState !== this.isPowerOn) this.triggerEvent('onPowerChange', oldPowerState, this.isPowerOn);
    }

    /**
     * Begins polling the status of the VM instance until it reaches the target status or the maximum time is exceeded.
     * @param targetStatus  The desired status to poll for (e.g., "RUNNING" or "TERMINATED")
     * @param maxSeconds  Maximum number of seconds to poll before giving up
     * @private
     */
    private beginStatusPolling(targetStatus: GoogleVM_Status, maxSeconds: number): NodeJS.Timeout {
        let counter = 0;

        // Poll every second
        const timer = setInterval(() => {
            counter++;
            this.updateStatus()
                // Check if we've reached the target status or exceeded max time
                .then(() => {
                    if (this.status === targetStatus || counter >= maxSeconds) {
                        clearInterval(timer);
                    }
                })
                // Handle updateStatus errors
                .catch((err) => {
                    this.logger.error(`[${this.id}] Unable to refresh status`, err);
                    if (counter >= maxSeconds) {
                        clearInterval(timer);
                    }
                });
        }, 1000);
        return timer;
    }

    /**
     * Extracts the operation name/id from the pseudo LRO handle returned by the GCE SDK.
     * The SDK does not expose google-gax LROs for Compute, so we need to fallback to metadata fields.
     * @param operationHandle The operation handle returned by the GCE SDK.
     */
    private resolveOperationName(operationHandle: any): string {
        return operationHandle?.latestResponse?.name
            || operationHandle?.latestResponse?.id?.toString?.()
            || operationHandle?.name
            || "";
    }

    /**
     * Parses the operation payload for error details and classifies them (CPU quota vs general failure).
     * Returns null when the operation completed successfully.
     * @param operation The operation object returned by the GCE SDK.
     */
    private extractOperationFailure(operation: any): {category: "CPU_QUOTA" | "GENERAL"; detail: string} | null {
        const errorDetail = operation?.error?.errors?.[0];
        if (!errorDetail) return null; // No error found, operation succeeded

        // Extract error message and reason
        const message = errorDetail.message || operation?.statusMessage || "Unknown error";
        const reason = (errorDetail.reason || "").toUpperCase();
        const normalized = message.toLowerCase();
        const isCpuQuota = reason === "QUOTA_EXCEEDED"
            || normalized.includes("quota")
            || normalized.includes("cpus")
            || normalized.includes("does not have enough"); // GCE quota errors are often worded this way

        return {category: isCpuQuota ? "CPU_QUOTA" : "GENERAL", detail: message};
    }

    /**
     * Background monitor that waits on the zone operation, broadcasts failures, and ensures status polling is cleaned up.
     * @param action The action being monitored ("start" or "stop").
     * @param operationName The name/id of the operation to monitor.
     * @param statusWatcher The status polling timer to clear upon completion.
     */
    private monitorOperation(action: "START" | "STOP", operationName: string, statusWatcher?: NodeJS.Timeout) {
        const runner = async () => {
            try {
                const operationResult = await waitZoneOperation(this.zone, operationName); // Wait for the zone operation to complete
                const failure = this.extractOperationFailure(operationResult); // Check for operation failure

                // Broadcast failure if any
                if (failure) {
                    if (action === "START") this.expired = null;
                    await this.broadcastFailure(action, failure, operationName);
                    throw new Error(failure.detail);
                }
            } finally {
                // Ensure the status polling is cleaned up
                if (statusWatcher) clearInterval(statusWatcher);
                await this.updateStatus();
            }
        };
        return runner();
    }

    /**
     * Publishes the structured failure payload to WebSocket listeners and logs the failure.
     * @param action The action that failed ("start" or "stop").
     * @param failure The failure details including category and message.
     * @param operationName The name/id of the operation that failed.
     */
    private async broadcastFailure(
        action: "START" | "STOP",
        failure: {category: "CPU_QUOTA" | "GENERAL"; detail: string},
        operationName: string
    ) {
        // Construct the failure payload
        const payload = {
            id: this.id,
            provider: this.provider,
            zone: this.zone,
            action,
            reason: failure.category,
            message: failure.detail,
            operation: operationName,
            timestamp: new Date().toISOString()
        };

        this.logger.error(`[${this.id}] ${action} operation failed (${failure.category}): ${failure.detail}`);

        // Broadcast the failure message
        try {
            await broadcastsMessage("/vpn/vm/error", payload);
        } catch (broadcastErr) {
            this.logger.error(`[${this.id}] Failed to broadcast /vpn/vm/error`, broadcastErr);
        }
    }

}

export default Google_vm;
export {GoogleVM_Status}