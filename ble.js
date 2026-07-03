import { CONFIG } from './config.js';
import { Logger } from './logger.js';

export class BLEManager {
    constructor(role) {
        this.role = role; // 'TX' or 'RX'
        this.device = null;
        this.server = null;
        this.service = null;
        this.rxCharacteristic = null; // Browser receives data from here
        this.txCharacteristic = null; // Browser sends data here
        this.onDisconnected = null;
        this.onDataReceived = null;
        
        // Write queue to prevent GATT overflow
        this.writeQueue = [];
        this.isWriting = false;
    }

    async connect() {
        try {
            Logger.info(`BLE_${this.role}`, `Requesting device (Prefix: VLC_${this.role})...`);
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: `VLC_${this.role}` }],
                optionalServices: [CONFIG.BLE.SERVICE_UUID]
            });

            this.device.addEventListener('gattserverdisconnected', this.handleDisconnect.bind(this));

            Logger.info(`BLE_${this.role}`, `Connecting to GATT Server...`);
            this.server = await this.device.gatt.connect();

            Logger.info(`BLE_${this.role}`, `Getting UART Service...`);
            this.service = await this.server.getPrimaryService(CONFIG.BLE.SERVICE_UUID);

            if (this.role === 'TX') {
                // Browser is transmitting TO the ESP32
                this.txCharacteristic = await this.service.getCharacteristic(CONFIG.BLE.RX_CHARACTERISTIC);
                Logger.info(`BLE_${this.role}`, `TX Characteristic acquired.`);
            } else {
                // Browser is receiving FROM the ESP32
                this.rxCharacteristic = await this.service.getCharacteristic(CONFIG.BLE.TX_CHARACTERISTIC);
                await this.rxCharacteristic.startNotifications();
                this.rxCharacteristic.addEventListener('characteristicvaluechanged', this.handleCharacteristicValueChanged.bind(this));
                Logger.info(`BLE_${this.role}`, `RX Notifications started.`);
            }

            return true;
        } catch (error) {
            Logger.error(`BLE_${this.role}`, `Connection failed: ${error.message}`);
            return false;
        }
    }

    handleDisconnect() {
        Logger.warn(`BLE_${this.role}`, `Device disconnected.`);
        if (this.onDisconnected) this.onDisconnected();
    }

    handleCharacteristicValueChanged(event) {
        const value = new Uint8Array(event.target.value.buffer);
        if (this.onDataReceived) {
            this.onDataReceived(value);
        }
    }

    async write(data) {
        if (!this.txCharacteristic) return;
        
        this.writeQueue.push(data);
        this.processWriteQueue();
    }

    async processWriteQueue() {
        if (this.isWriting || this.writeQueue.length === 0) return;
        
        this.isWriting = true;
        try {
            const data = this.writeQueue.shift();
            // Use writeValueWithoutResponse for speed, but rely on JS pacing (TX_DELAY_MS)
            await this.txCharacteristic.writeValueWithoutResponse(data);
        } catch (error) {
            Logger.error(`BLE_${this.role}`, `Write failed: ${error.message}`);
            // Simple retry logic could go here
        } finally {
            this.isWriting = false;
            if (this.writeQueue.length > 0) {
                // Introduce a tiny delay to not overflow the ESP32's BLE stack
                setTimeout(() => this.processWriteQueue(), CONFIG.TRANSFER.TX_DELAY_MS);
            }
        }
    }

    disconnect() {
        if (this.device && this.device.gatt.connected) {
            this.device.gatt.disconnect();
        }
    }
}
