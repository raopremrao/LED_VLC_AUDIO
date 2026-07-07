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

        // Write queue with backpressure
        this.writeQueue = [];
        this.isWriting = false;

        // Statistics for link quality reporting
        this.stats = {
            totalWrites: 0,
            failedWrites: 0,
            retries: 0,
            bytesWritten: 0,
            droppedPackets: 0,
            notifications: 0,
            bytesReceived: 0,
        };
    }

    async connect() {
        try {
            Logger.info(`BLE_${this.role}`, `Requesting device (Prefix: VLC_${this.role})...`);
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: `VLC_${this.role}` }],
                optionalServices: [CONFIG.BLE.SERVICE_UUID]
            });

            this.device.addEventListener('gattserverdisconnected', this.handleDisconnect.bind(this));

            Logger.info(`BLE_${this.role}`, `Connecting to GATT Server: ${this.device.name}...`);
            this.server = await this.device.gatt.connect();

            Logger.info(`BLE_${this.role}`, `Getting UART Service...`);
            this.service = await this.server.getPrimaryService(CONFIG.BLE.SERVICE_UUID);

            if (this.role === 'TX') {
                this.txCharacteristic = await this.service.getCharacteristic(CONFIG.BLE.TX_CHARACTERISTIC);
                Logger.info(`BLE_${this.role}`, `TX Characteristic acquired. Ready to transmit.`);
            } else {
                this.rxCharacteristic = await this.service.getCharacteristic(CONFIG.BLE.RX_CHARACTERISTIC);
                await this.rxCharacteristic.startNotifications();
                this.rxCharacteristic.addEventListener('characteristicvaluechanged', this.handleCharacteristicValueChanged.bind(this));
                
                try {
                    this.txCharacteristic = await this.service.getCharacteristic(CONFIG.BLE.TX_CHARACTERISTIC);
                } catch(e) {}

                Logger.info(`BLE_${this.role}`, `RX Notifications started. Listening for optical data.`);
            }

            return true;
        } catch (error) {
            Logger.error(`BLE_${this.role}`, `Connection failed: ${error.message}`);
            return false;
        }
    }

    handleDisconnect() {
        const s = this.stats;
        Logger.warn(`BLE_${this.role}`, `Device disconnected. Writes: ${s.totalWrites}, Failed: ${s.failedWrites}, Retries: ${s.retries}, Dropped: ${s.droppedPackets}`);
        if (this.onDisconnected) this.onDisconnected();
    }

    handleCharacteristicValueChanged(event) {
        const value = new Uint8Array(event.target.value.buffer);
        this.stats.notifications++;
        this.stats.bytesReceived += value.length;

        Logger.debug(`BLE_${this.role}`, `Notification #${this.stats.notifications}: ${value.length} bytes received`);

        if (this.onDataReceived) {
            this.onDataReceived(value);
        }
    }

    /**
     * Queue a write with backpressure. Blocks if queue exceeds MAX_WRITE_QUEUE.
     */
    async write(data) {
        if (!this.txCharacteristic) {
            Logger.error(`BLE_${this.role}`, `Write failed: No TX characteristic.`);
            return false;
        }

        // Backpressure: wait for queue to drain if full
        if (this.writeQueue.length >= CONFIG.TRANSFER.MAX_WRITE_QUEUE) {
            Logger.warn(`BLE_${this.role}`, `Backpressure active: queue ${this.writeQueue.length}/${CONFIG.TRANSFER.MAX_WRITE_QUEUE}. Waiting...`);
            await this._waitForQueueDrain(Math.floor(CONFIG.TRANSFER.MAX_WRITE_QUEUE / 2));
            Logger.debug(`BLE_${this.role}`, `Backpressure released. Resuming writes.`);
        }

        this.writeQueue.push(data);
        this._processWriteQueue();
        return true;
    }

    async _waitForQueueDrain(targetSize) {
        while (this.writeQueue.length > targetSize) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    async _processWriteQueue() {
        if (this.isWriting || this.writeQueue.length === 0) return;

        this.isWriting = true;
        try {
            const data = this.writeQueue[0]; // Peek — don't shift until success or all retries exhausted
            let success = false;

            for (let attempt = 0; attempt < CONFIG.TRANSFER.MAX_RETRIES; attempt++) {
                try {
                    await this.txCharacteristic.writeValueWithoutResponse(data);
                    success = true;
                    this.stats.totalWrites++;
                    this.stats.bytesWritten += data.length;
                    break;
                } catch (error) {
                    this.stats.retries++;
                    Logger.warn(`BLE_${this.role}`, `Write attempt ${attempt + 1}/${CONFIG.TRANSFER.MAX_RETRIES} failed: ${error.message}`);
                    if (attempt < CONFIG.TRANSFER.MAX_RETRIES - 1) {
                        await new Promise(resolve => setTimeout(resolve, 50 * Math.pow(2, attempt)));
                    }
                }
            }

            if (success) {
                this.writeQueue.shift();
            } else {
                this.writeQueue.shift(); // Drop after all retries exhausted
                this.stats.failedWrites++;
                this.stats.droppedPackets++;
                Logger.error(`BLE_${this.role}`, `Packet DROPPED after ${CONFIG.TRANSFER.MAX_RETRIES} retries. Total dropped: ${this.stats.droppedPackets}`);
            }
        } finally {
            this.isWriting = false;
            if (this.writeQueue.length > 0) {
                // Adaptive pacing: increase delay as queue fills up
                const queueRatio = this.writeQueue.length / CONFIG.TRANSFER.MAX_WRITE_QUEUE;
                const maxDelay = Math.max(CONFIG.TRANSFER.MAX_TX_DELAY_MS, CONFIG.TRANSFER.BASE_TX_DELAY_MS * 1.5);
                const delay = CONFIG.TRANSFER.BASE_TX_DELAY_MS +
                    (maxDelay - CONFIG.TRANSFER.BASE_TX_DELAY_MS) * Math.min(queueRatio, 1);
                setTimeout(() => this._processWriteQueue(), delay);
            }
        }
    }

    getStats() {
        return { ...this.stats, queueLength: this.writeQueue.length };
    }

    resetStats() {
        for (const key in this.stats) this.stats[key] = 0;
    }

    disconnect() {
        if (this.device && this.device.gatt.connected) {
            this.device.gatt.disconnect();
        }
    }
}
