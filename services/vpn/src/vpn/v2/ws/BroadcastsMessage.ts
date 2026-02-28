import * as WS from "ws";

/**
 * An array containing all connected VPN clients.
 */
const WebSocket_Clients_List = new Array<WS.WebSocket>();

/**
 * Broadcasts a message to all connected VPN clients.
 *
 * This asynchronous function iterates over all connected clients and sends a message to each one.
 * The message is sent as a JSON string, with the URL and data as properties.
 *
 * @async
 * @function
 * @param {string} url - The URL to be included in the message.
 * @param {object} message - The data to be included in the message.
 * @returns {void}
 */
async function broadcastsMessage(url: string, message: object): Promise<void> {
    for (const client of WebSocket_Clients_List.values()) {
        client.send(JSON.stringify({url, data: message}));
    }
}

/**
 * Adds a WebSocket client to the list of connected VPN clients.
 *
 * @param {WS.WebSocket} ws - The WebSocket client to be added.
 */
function pushWSClient(ws: WS.WebSocket): void {
    WebSocket_Clients_List.push(ws);
    ws.addEventListener("close", async () => {
        const index = WebSocket_Clients_List.indexOf(ws);
        if (index > -1) {
            WebSocket_Clients_List.splice(index, 1);
        }
    })
}

/**
 * Closes all WebSocket clients in the list of connected VPN clients.
 */
function closeAllWSClient(): void {
    for (const client of WebSocket_Clients_List.values()) {
        client.close();
    }
}

export {broadcastsMessage, pushWSClient, closeAllWSClient};