import fs_sync from 'node:fs';
import path from "node:path";


export type vpnType = "OpenVPN" | "SoftEther" | "SS" | "https" | "sing-box";

/* ====== profiles type ==== */
export interface base_profile {
    type: vpnType,
    name: string
}

export interface openvpn_profile extends base_profile {
    type: "OpenVPN",
    filename: string
}

export interface softether_profile extends base_profile {
    type: "SoftEther",
    filename: string
}

export interface ss_profile extends base_profile {
    type: "SS",
    url: string
    method: string
}

export interface https_profile extends base_profile {
    type: "https",
    url: string
}

export interface singbox_profile extends base_profile {
    type: "sing-box",
}

export type profileType = openvpn_profile | softether_profile | ss_profile | https_profile | singbox_profile;
/* ========================== */

export type country = "TW" | "JP" | "HK" | "US" | "UK" | "IN" | string
export type provider = "google" | "azure"
export type readOnlyMode = "startOnly" | "stopOnly" | "readOnly" | "disable"
export type OptionalCallback = {
    successCallBack?: () => void,
    failCallBack?: (err: Error) => void
}

export interface VMEventMap {
    onPowerChange: (oldData: boolean, newData: boolean) => void;
    "onStatusChange": (oldData: string, newData: string) => void;
}

//const logger = getLogger('/vpn/[VM_Class]/VM');

// read vm_data.json
const filePath = path.join('config', 'vm_data.json');
let VM_DATA = JSON.parse(fs_sync.readFileSync(filePath, {encoding: 'utf-8', flag: 'r'}));

// Validate vm_data.json structure
(VM_DATA as VM[]).forEach(data => {
    data.profiles.forEach(profile => {
        if ((profile.type === "OpenVPN" || profile.type === "SoftEther") && (!profile.filename)) {
            throw new Error(`Invalid OpenVPN/SoftEther profile data in vm_data.json for VM ID: ${data.id}`);
        }
        if ((profile.type === "https") && (!profile.url)) {
            throw new Error(`Invalid https profile data in vm_data.json for VM ID: ${data.id}`);
        }
        if ((profile.type === "SS") && (!profile.url && !profile.method)) {
            throw new Error(`Invalid SS profile data in vm_data.json for VM ID: ${data.id}`);
        }
        return true;
    });
});

// Watch for changes in the vm_data.json file
/*fs_sync.watch(filePath, (eventType, filename) => {
    if (eventType === 'change') {
        logger.info('vm_data.json file changed, reloading...');
        // Reload the userCert data
        try {
            VM_DATA = JSON.parse(fs_sync.readFileSync(filePath, {encoding: 'utf-8', flag: 'r'}));
            logger.info('vm_data.json reloaded successfully');
        } catch (error) {
            logger.error('Error reloading vm_data.json:', error);
        }
    }
});*/

abstract class VM<StatusType = string> {

    private readonly _name: string = "N/A";
    private readonly _id: string;
    private readonly _zone: string;
    private readonly _url: string | null = null;
    private readonly _country: country | null = null;
    private readonly _profiles: profileType[] = [];
    private readonly _provider: provider;
    private readonly _readonly: readOnlyMode = "disable";
    private _status: StatusType;
    private _expired: Date | null = null;
    private _isPowerOn: boolean = false;
    private eventListeners: Map<keyof VMEventMap, Function[]> = new Map();

    /**
     * Constructs a new VM instance.
     *
     * @protected
     * @param {string} status - The status of the VM.
     * @param {string} id - The ID of the VM.
     * @param {string} zone - The zone of the VM.
     * @param {provider} provider - The provider of the VM.
     */
    protected constructor(status: StatusType, id: string, zone: string, provider: provider) {
        this._status = status;
        this._id = id;
        this._zone = zone;
        this._provider = provider;

        const data = VM_DATA.find((item: { id: string; }) => item.id === this._id);
        if (data) {
            this._url = data.url;
            this._profiles = data.profiles;
            this._country = data.country;
            this._readonly = data.readonly;
            this._name = data.name;
        }
        this._isPowerOn = this.determinePowerStatus();
    }

    // Current VM status (e.g. "running", "stopped").
    get status(): StatusType {
        return this._status;
    }

    protected set status(value: StatusType) {
        this._status = value;
    }

    // Whether the VM is powered on.
    get isPowerOn(): boolean {
        return this._isPowerOn;
    }

    // expiration timestamp or null if not set.
    get expired(): Date | null {
        return this._expired;
    }

    set expired(value: Date | null) {
        this._expired = value;
    }

    // Readonly mode for the VM controls.
    get readonly(): readOnlyMode {
        return this._readonly;
    }

    // Cloud/provider for the VM.
    get provider(): provider {
        return this._provider;
    }

    // Country/region code for VM.
    get country(): country | null {
        return this._country;
    }

    // Array of associated VPN profiles.
    get profiles(): profileType[] {
        return this._profiles;
    }

    // Access URL for VM.
    get url(): string | null {
        return this._url;
    }

    // Display name of the VM.
    get name(): string {
        return this._name;
    }

    // Unique VM identifier.
    get id(): string {
        return this._id;
    }

    // Zone or region where VM is located.
    get zone(): string {
        return this._zone;
    }

    protected set powerOn(value: boolean) {
        this._isPowerOn = value;
    }

    /**
     * Abstract method to start the VM.
     *
     * @abstract
     * @param {boolean} bypassReadonly - Optional parameter to bypass the readonly status of the VM. Default is false.
     * @param expired - Optional parameter to set the expired time of the VM. Default is null.
     * @param option - Optional parameter to set the success and fail callbacks.
     * @returns {Promise<any>} A promise that resolves when the create operation.
     */
    abstract start(bypassReadonly?: boolean, expired?: Date, option?: OptionalCallback): Promise<any>;

    /**
     * Abstract method to stop the VM.
     *
     * @abstract
     * @param {boolean} bypassReadonly - Optional parameter to bypass the readonly status of the VM. Default is false.
     * @param option - Optional parameter to set the success and fail callbacks.
     * @returns {Promise<any>} A promise that resolves when the stop operation completes.
     */
    abstract stop(bypassReadonly?: boolean, option?: OptionalCallback): Promise<any>;

    /**
     * Abstract method to update the status of the VM.
     *
     * @abstract
     * @returns {Promise<void>} A promise that resolves when the status update operation completes.
     */
    abstract updateStatus(): Promise<void>;

    /**
     * Adds an event listener to the VM instance.
     *
     * This method allows you to register a function (event handler) that will be called whenever a specific event occurs.
     * If the event does not have any listeners yet, it will create a new array for that event and add the listener to it.
     * If the event already has listeners, it will simply add the new listener to the existing array.
     *
     * @param {K} event - The name of the event to listen for. It should be a key of the VMEventMap.
     * @param {VMEventMap[K]} listener - The function to call when the event occurs. This function should match the type defined in VMEventMap for the given event.
     * @template K - The type of the event name, which extends the keys of VMEventMap.
     * @returns {void}
     */
    public addEventListener<K extends keyof VMEventMap>(event: K, listener: VMEventMap[K]): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event)?.push(listener);
    }

    /**
     * Removes an event listener from the VM instance.
     *
     * This method allows you to unregister a previously registered event handler for a specific event.
     * If the event has listeners, it will filter out the specified listener from the array of listeners.
     * If the event does not have any listeners, it will simply do nothing.
     *
     * @param {K} event - The name of the event to remove the listener from. It should be a key of the VMEventMap.
     * @param {VMEventMap[K]} listener - The function to remove from the event's listener array. This function should match the type defined in VMEventMap for the given event.
     * @template K - The type of the event name, which extends the keys of VMEventMap.
     * @returns {void}
     */
    public removeEventListener<K extends keyof VMEventMap>(event: K, listener: VMEventMap[K]): void {
        if (this.eventListeners.has(event)) {
            let listeners = this.eventListeners.get(event);
            if (listeners) {
                const updatedListeners = listeners.filter(l => l !== listener);
                if (updatedListeners.length > 0) {
                    this.eventListeners.set(event, updatedListeners);
                } else {
                    this.eventListeners.delete(event);
                }
            }
        }
    }

    /**
     * Extends the expiration time of the VM instance.
     *
     * This method allows you to extend the expiration time of the VM instance. It checks if the current expiration time is without 60 minutes from now.
     * If it is, it throws a NotIn60minError. Otherwise, it sets the new expiration time.
     *
     * @param {Date} newExpired - The new expiration time.
     * @throws {NotIn60minError} If the current expiration time is within 60 minutes from now.
     * @returns {void}
     */
    public extendExpiredTime(newExpired: Date): void {
        if (this._expired !== null && this._expired.getTime() - 60 * 60 * 1000 > Date.now()) {
            throw new NotIn60minError("The expired time is not in 60 min.");
        }
        this._expired = newExpired;
    }

    /**
     * Converts the VM instance to a plain object.
     *
     * This method converts the VM instance to a plain object representation, including all its properties.
     *
     * @returns {object} An object representation of the VM instance.
     */
    public toObject() {
        return {
            _name: this._name,
            _status: this._status,
            _id: this._id,
            _zone: this._zone,
            _url: this._url,
            _country: this._country,
            _profiles: this._profiles,
            _provider: this._provider,
            _isPowerOn: this._isPowerOn,
            _readonly: this._readonly,
            _expired: this._expired
        };
    }

    /**
     * Abstract method to determine the power status of the VM.
     *
     * @abstract
     * @returns {boolean} Returns true if the VM is powered on, false otherwise.
     */
    protected abstract determinePowerStatus(): boolean;

    /**
     * Triggers a specific event on the VM instance.
     *
     * This method allows you to trigger a specific event on the VM instance. It will call all the event handlers
     * registered for the specified event, passing the old and new data to them.
     * If the event does not have any listeners, it will simply do nothing.
     *
     * @param {K} event - The name of the event to trigger. It should be a key of the VMEventMap.
     * @param {...Parameters<VMEventMap[K]>} args - The arguments to pass to the event handlers.
     * @template K - The type of the event name, which extends the keys of VMEventMap.
     * @returns {void}
     */
    protected triggerEvent<K extends keyof VMEventMap>(event: K, ...args: Parameters<VMEventMap[K]>): void {
        if (this.eventListeners.has(event)) {
            let listeners = this.eventListeners.get(event);
            listeners?.forEach((listener) => listener(...args));
        }
    }

}

class ReadOnlyError implements Error {
    message: string;
    name = "ReadOnlyError";

    constructor(message: string) {
        this.message = message;
    }
}

class AlreadyStatusError implements Error {
    message: string;
    name = 'AlreadyStatusError';

    constructor(message: string) {
        this.message = message;
    }
}

class NotIn60minError implements Error {
    message: string;
    name = 'NotIn30minError';

    constructor(message: string) {
        this.message = message;
    }
}

export default VM;
export {AlreadyStatusError, ReadOnlyError, NotIn60minError};