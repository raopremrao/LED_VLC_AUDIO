import { CONFIG } from './config.js';
import { Logger } from './logger.js';
import { Utils } from './utils.js';
import { BLEManager } from './ble.js';
import { PacketBuilder, PacketParser } from './packet.js';
import { Player } from './player.js';

class TransferManager {
    constructor() {
        this.txBle = new BLEManager('TX');
        this.rxBle = new BLEManager('RX');
        this.player = new Player('audio-player');

        // TX State
        this.fileBuffer = null;
        this.fileMeta = null;
        this.isTransmitting = false;
        this.txActualBytesSent = 0; // Track actual BLE-confirmed bytes for speed calculation

        // RX State
        this.parser = new PacketParser();
        this.parser.onPacketReceived = this.handleReceivedPacket.bind(this);
        this.rxChunks = [];
        this.rxExpectedPackets = 0;
        this.rxExpectedBytes = 0;
        this.rxReceivedBytes = 0;
        this.rxReceivedPackets = 0;
        this.rxStartTime = 0;
        this.rxTimeout = null;

        this.setupUI();
        Logger.info('System', 'VLC Data Link initialized. Select a tab to begin.');
    }

    setupUI() {
        document.getElementById('tab-tx').addEventListener('click', () => this.switchTab('tx'));
        document.getElementById('tab-rx').addEventListener('click', () => this.switchTab('rx'));

        document.getElementById('btn-conn-tx').addEventListener('click', () => this.connectTX());
        document.getElementById('btn-conn-rx').addEventListener('click', () => this.connectRX());

        document.getElementById('file-input').addEventListener('change', (e) => this.handleFileSelect(e));
        document.getElementById('btn-stream').addEventListener('click', () => this.startTransmission());
        document.getElementById('btn-download').addEventListener('click', () => this.downloadReceivedFile());

        document.getElementById('btn-clear-logs').addEventListener('click', () => Logger.clear());
    }

    switchTab(tab) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

        document.getElementById(`tab-${tab}`).classList.add('active');
        document.getElementById(`panel-${tab}`).classList.remove('hidden');
        document.getElementById(`panel-${tab}`).classList.add('active');
    }

    updateUI(elementId, text) {
        const el = document.getElementById(elementId);
        if (el) el.innerText = text;
    }

    // ─── TX Connection ───────────────────────────────────────
    async connectTX() {
        Logger.info('TX', 'Initiating BLE connection to TX ESP32...');
        this.txBle.onDisconnected = () => {
            this.updateUI('status-tx', 'Status: Disconnected');
            document.getElementById('btn-conn-tx').disabled = false;
            Logger.warn('TX', 'TX ESP32 disconnected.');
        };
        const connected = await this.txBle.connect();
        if (connected) {
            this.updateUI('status-tx', 'Status: Connected');
            document.getElementById('btn-conn-tx').disabled = true;
            if (this.fileBuffer) document.getElementById('btn-stream').disabled = false;
            Logger.info('TX', 'TX ESP32 connected and ready.');
        }
    }

    // ─── RX Connection ───────────────────────────────────────
    async connectRX() {
        Logger.info('RX', 'Initiating BLE connection to RX ESP32...');
        this.rxBle.onDisconnected = () => {
            this.updateUI('status-rx', 'Status: Disconnected');
            document.getElementById('btn-conn-rx').disabled = false;
            Logger.warn('RX', 'RX ESP32 disconnected.');
        };
        this.rxBle.onDataReceived = (data) => {
            Logger.debug('RX', `BLE data received from ESP32: ${data.length} bytes`);
            this.parser.pushData(data);
            this.resetRxTimeout();
        };
        const connected = await this.rxBle.connect();
        if (connected) {
            this.updateUI('status-rx', 'Status: Connected');
            document.getElementById('btn-conn-rx').disabled = true;
            Logger.info('RX', 'RX ESP32 connected. Waiting for optical data...');
        }
    }

    // ─── File Selection ──────────────────────────────────────
    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.fileMeta = {
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size
        };

        Logger.info('TX', `File loaded: "${file.name}" (${Utils.formatBytes(file.size)}, ${this.fileMeta.type})`);

        const arrayBuffer = await file.arrayBuffer();
        this.fileBuffer = new Uint8Array(arrayBuffer);

        const totalPackets = Math.ceil(this.fileBuffer.length / CONFIG.PACKET.MAX_PAYLOAD_SIZE);
        Logger.info('TX', `File will be split into ${totalPackets} packets of up to ${CONFIG.PACKET.MAX_PAYLOAD_SIZE} bytes each.`);

        if (this.txBle.txCharacteristic) {
            document.getElementById('btn-stream').disabled = false;
        }
    }

    // ─── Transmission ────────────────────────────────────────
    async startTransmission() {
        if (!this.fileBuffer || this.isTransmitting) return;
        this.isTransmitting = true;
        document.getElementById('btn-stream').disabled = true;
        this.txBle.resetStats();

        const totalPackets = Math.ceil(this.fileBuffer.length / CONFIG.PACKET.MAX_PAYLOAD_SIZE);
        Logger.info('TX', `═══ TRANSFER START ═══`);
        Logger.info('TX', `File: "${this.fileMeta.name}" | Size: ${Utils.formatBytes(this.fileBuffer.length)} | Packets: ${totalPackets}`);

        // 1. Send FILE_START
        const startPacket = PacketBuilder.buildFileStart(this.fileMeta.name, this.fileMeta.type, this.fileMeta.size, totalPackets);
        await this.txBle.write(startPacket);
        Logger.info('TX', `FILE_START packet sent (${startPacket.length} bytes). Waiting for receiver setup...`);
        await Utils.sleep(100);

        // 2. Send DATA Packets
        const startTime = performance.now();

        for (let seq = 0; seq < totalPackets; seq++) {
            const offset = seq * CONFIG.PACKET.MAX_PAYLOAD_SIZE;
            const end = Math.min(offset + CONFIG.PACKET.MAX_PAYLOAD_SIZE, this.fileBuffer.length);
            const chunk = this.fileBuffer.slice(offset, end);

            const dataPacket = PacketBuilder.build(CONFIG.TYPES.DATA, seq, chunk);
            await this.txBle.write(dataPacket); // Now properly awaits backpressure

            // Log every packet at debug level, summary at info level periodically
            Logger.debug('TX', `DATA packet queued: Seq=${seq}, Payload=${chunk.length}B, Total=${dataPacket.length}B`);

            if (seq % 50 === 0 || seq === totalPackets - 1) {
                // Speed calculated from ACTUAL BLE bytes written, not queue insertions
                const bleStats = this.txBle.getStats();
                const elapsed = (performance.now() - startTime) / 1000;
                const actualSpeed = elapsed > 0 ? (bleStats.bytesWritten / elapsed) / 1024 : 0;
                const progress = ((seq + 1) / totalPackets * 100).toFixed(1);

                this.updateUI('stream-progress',
                    `Sent: ${Utils.formatBytes(end)} / ${Utils.formatBytes(this.fileBuffer.length)} ` +
                    `(${progress}%) | Speed: ${actualSpeed.toFixed(1)} KB/s | Queue: ${bleStats.queueLength}`
                );

                Logger.info('TX', `Progress: ${progress}% | Seq: ${seq}/${totalPackets - 1} | Speed: ${actualSpeed.toFixed(1)} KB/s | Queue: ${bleStats.queueLength} | Retries: ${bleStats.retries}`);

                await Utils.sleep(5); // Brief yield to UI thread
            }
        }

        // Wait for write queue to drain completely
        Logger.info('TX', 'All packets queued. Waiting for BLE write queue to drain...');
        while (this.txBle.writeQueue.length > 0) {
            await Utils.sleep(50);
        }
        Logger.info('TX', 'Write queue drained. Sending FILE_END...');

        // 3. Send FILE_END
        const endPacket = PacketBuilder.buildFileEnd(totalPackets - 1, this.fileBuffer.length);
        await this.txBle.write(endPacket);

        // Wait for last packet
        while (this.txBle.writeQueue.length > 0) {
            await Utils.sleep(50);
        }

        const totalElapsed = (performance.now() - startTime) / 1000;
        const finalStats = this.txBle.getStats();
        Logger.info('TX', `═══ TRANSFER COMPLETE ═══`);
        Logger.info('TX', `Time: ${totalElapsed.toFixed(1)}s | BLE Writes: ${finalStats.totalWrites} | Retries: ${finalStats.retries} | Dropped: ${finalStats.droppedPackets}`);

        this.updateUI('stream-progress', `Transfer Complete. (${totalElapsed.toFixed(1)}s, ${finalStats.droppedPackets} dropped)`);
        this.isTransmitting = false;
        document.getElementById('btn-stream').disabled = false;
    }

    // ─── Packet Handling (RX) ────────────────────────────────
    handleReceivedPacket(header, payload) {
        if (header.type === CONFIG.TYPES.FILE_START) {
            this.startRxSession(payload);
        } else if (header.type === CONFIG.TYPES.DATA) {
            this.processRxData(header, payload);
        } else if (header.type === CONFIG.TYPES.FILE_END) {
            this.finishRxSession(header, payload);
        } else if (header.type === CONFIG.TYPES.ERROR) {
            const decoder = new TextDecoder();
            const errorMsg = decoder.decode(payload);
            Logger.error('RX_ESP32', `ESP32 reported error: ${errorMsg}`);
        } else {
            Logger.warn('RX', `Unknown packet type: 0x${header.type.toString(16)} (Seq: ${header.sequence})`);
        }
    }

    startRxSession(payload) {
        const view = new DataView(payload.buffer, payload.byteOffset);
        this.rxExpectedBytes = view.getUint32(0, false);
        this.rxExpectedPackets = view.getUint32(4, false);

        const nameLen = payload[8];
        const nameBytes = payload.slice(9, 9 + nameLen);
        const mimeLen = payload[9 + nameLen];
        const mimeBytes = payload.slice(10 + nameLen, 10 + nameLen + mimeLen);

        const decoder = new TextDecoder();
        this.rxMeta = {
            name: decoder.decode(nameBytes),
            type: decoder.decode(mimeBytes),
            size: this.rxExpectedBytes
        };

        // Reset RX state
        this.rxChunks = [];
        this.rxReceivedBytes = 0;
        this.rxReceivedPackets = 0;
        this.rxStartTime = performance.now();

        // Reset parser sequence tracking for this new file
        this.parser.resetSequence();
        this.parser.resetStats();

        Logger.info('RX', `═══ INCOMING FILE ═══`);
        Logger.info('RX', `File: "${this.rxMeta.name}" | Size: ${Utils.formatBytes(this.rxMeta.size)} | Expected Packets: ${this.rxExpectedPackets}`);
        Logger.info('RX', `MIME: ${this.rxMeta.type}`);
        this.updateUI('rx-buffer-status', `Receiving: ${this.rxMeta.name}`);
        document.getElementById('rx-controls').classList.add('hidden');
    }

    processRxData(header, payload) {
        this.rxChunks.push(payload);
        this.rxReceivedBytes += payload.length;
        this.rxReceivedPackets++;

        Logger.debug('RX', `DATA Seq=${header.sequence} | ${payload.length}B | Total: ${Utils.formatBytes(this.rxReceivedBytes)}/${Utils.formatBytes(this.rxExpectedBytes)}`);

        if (header.sequence % 25 === 0 || this.rxReceivedPackets === this.rxExpectedPackets) {
            const elapsed = (performance.now() - this.rxStartTime) / 1000;
            const speed = elapsed > 0 ? (this.rxReceivedBytes / elapsed) / 1024 : 0;
            const eta = Utils.calculateETA(this.rxStartTime, this.rxReceivedBytes, this.rxExpectedBytes);
            const progress = ((this.rxReceivedBytes / this.rxExpectedBytes) * 100).toFixed(1);
            const parserStats = this.parser.getStats();

            this.updateUI('rx-buffer-status',
                `Received: ${Utils.formatBytes(this.rxReceivedBytes)} / ${Utils.formatBytes(this.rxExpectedBytes)} ` +
                `(${progress}%) | ${speed.toFixed(1)} KB/s | ETA: ${eta}`
            );

            Logger.info('RX', `Progress: ${progress}% | Seq: ${header.sequence} | Speed: ${speed.toFixed(1)} KB/s | CRC Errors: ${parserStats.crcErrors} | Gaps: ${parserStats.sequenceGaps}`);
        }
    }

    finishRxSession(header, payload) {
        this.clearRxTimeout();

        const view = new DataView(payload.buffer, payload.byteOffset);
        const finalSeq = view.getUint16(0, false);
        const totalBytes = view.getUint32(2, false);
        const elapsed = (performance.now() - this.rxStartTime) / 1000;
        const parserStats = this.parser.getStats();

        Logger.info('RX', `FILE_END received. FinalSeq: ${finalSeq}, DeclaredBytes: ${totalBytes}`);

        // Validate received data
        const sizeMatch = this.rxReceivedBytes === this.rxExpectedBytes && this.rxReceivedBytes === totalBytes;
        const noGaps = parserStats.sequenceGaps === 0 && parserStats.missingPackets === 0;

        if (!sizeMatch) {
            Logger.error('RX', `SIZE MISMATCH! Expected: ${this.rxExpectedBytes}, Received: ${this.rxReceivedBytes}, Declared: ${totalBytes}`);
            this.updateUI('rx-buffer-status', `Transfer FAILED — Size Mismatch (${Utils.formatBytes(this.rxReceivedBytes)}/${Utils.formatBytes(this.rxExpectedBytes)})`);
            this._logRxSummary(elapsed, parserStats, false);
            return;
        }

        if (!noGaps) {
            Logger.warn('RX', `Transfer completed with ${parserStats.sequenceGaps} sequence gaps (${parserStats.missingPackets} missing packets). File may be corrupted.`);
        }

        // Assemble final blob
        this.rxBlob = new Blob(this.rxChunks, { type: this.rxMeta.type });
        this.rxChunks = []; // Free memory

        document.getElementById('rx-controls').classList.remove('hidden');

        if (this.rxMeta.type.startsWith('audio/')) {
            this.player.load(this.rxBlob);
        }

        this.updateUI('rx-buffer-status', 'Transfer Complete. Ready for playback/download.');
        this._logRxSummary(elapsed, parserStats, true);
    }

    _logRxSummary(elapsed, parserStats, success) {
        const speed = elapsed > 0 ? (this.rxReceivedBytes / elapsed) / 1024 : 0;
        const bleStats = this.rxBle.getStats();

        Logger.info('RX', `═══ TRANSFER ${success ? 'COMPLETE' : 'FAILED'} ═══`);
        Logger.info('RX', `Time: ${elapsed.toFixed(1)}s | Avg Speed: ${speed.toFixed(1)} KB/s`);
        Logger.info('RX', `Packets: ${this.rxReceivedPackets}/${this.rxExpectedPackets} | Bytes: ${Utils.formatBytes(this.rxReceivedBytes)}`);
        Logger.info('RX', `CRC Errors: ${parserStats.crcErrors} | Seq Gaps: ${parserStats.sequenceGaps} | Missing: ${parserStats.missingPackets} | Duplicates: ${parserStats.duplicatePackets}`);
        Logger.info('RX', `BLE Notifications: ${bleStats.notifications} | BLE Bytes: ${Utils.formatBytes(bleStats.bytesReceived)}`);
    }

    downloadReceivedFile() {
        if (this.rxBlob && this.rxMeta) {
            Logger.info('RX', `Downloading: "${this.rxMeta.name}" (${Utils.formatBytes(this.rxBlob.size)})`);
            Utils.downloadBlob(this.rxBlob, this.rxMeta.name);
        }
    }

    resetRxTimeout() {
        this.clearRxTimeout();
        this.rxTimeout = setTimeout(() => {
            if (this.rxReceivedBytes > 0 && this.rxReceivedBytes < this.rxExpectedBytes) {
                const parserStats = this.parser.getStats();
                Logger.error('RX', `Transfer TIMED OUT after ${CONFIG.TRANSFER.RX_TIMEOUT_MS}ms of inactivity.`);
                Logger.error('RX', `Received: ${Utils.formatBytes(this.rxReceivedBytes)}/${Utils.formatBytes(this.rxExpectedBytes)} | CRC Errors: ${parserStats.crcErrors}`);
                this.updateUI('rx-buffer-status', `Transfer Failed (Timeout at ${((this.rxReceivedBytes / this.rxExpectedBytes) * 100).toFixed(1)}%)`);
                this.rxChunks = []; // Clean up
            }
        }, CONFIG.TRANSFER.RX_TIMEOUT_MS);
    }

    clearRxTimeout() {
        if (this.rxTimeout) {
            clearTimeout(this.rxTimeout);
            this.rxTimeout = null;
        }
    }
}

// Initialize application
window.addEventListener('DOMContentLoaded', () => {
    window.app = new TransferManager();
});