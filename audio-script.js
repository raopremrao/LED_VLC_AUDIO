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
        
        // RX State
        this.parser = new PacketParser();
        this.parser.onPacketReceived = this.handleReceivedPacket.bind(this);
        this.rxChunks = [];
        this.rxExpectedPackets = 0;
        this.rxExpectedBytes = 0;
        this.rxReceivedBytes = 0;
        this.rxStartTime = 0;
        this.rxTimeout = null;
        
        this.setupUI();
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

    async connectTX() {
        this.txBle.onDisconnected = () => {
            this.updateUI('status-tx', 'Status: Disconnected');
            document.getElementById('btn-conn-tx').disabled = false;
        };
        const connected = await this.txBle.connect();
        if (connected) {
            this.updateUI('status-tx', 'Status: Connected');
            document.getElementById('btn-conn-tx').disabled = true;
            if (this.fileBuffer) document.getElementById('btn-stream').disabled = false;
        }
    }

    async connectRX() {
        this.rxBle.onDisconnected = () => {
            this.updateUI('status-rx', 'Status: Disconnected');
            document.getElementById('btn-conn-rx').disabled = false;
        };
        this.rxBle.onDataReceived = (data) => {
            this.parser.pushData(data);
            this.resetRxTimeout();
        };
        const connected = await this.rxBle.connect();
        if (connected) {
            this.updateUI('status-rx', 'Status: Connected');
            document.getElementById('btn-conn-rx').disabled = true;
        }
    }

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        this.fileMeta = {
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size
        };
        
        Logger.info('TX', `Loaded: ${file.name} (${Utils.formatBytes(file.size)})`);
        
        const arrayBuffer = await file.arrayBuffer();
        this.fileBuffer = new Uint8Array(arrayBuffer);
        
        if (this.txBle.txCharacteristic) {
            document.getElementById('btn-stream').disabled = false;
        }
    }

    async startTransmission() {
        if (!this.fileBuffer || this.isTransmitting) return;
        this.isTransmitting = true;
        document.getElementById('btn-stream').disabled = true;
        
        const totalPackets = Math.ceil(this.fileBuffer.length / CONFIG.PACKET.MAX_PAYLOAD_SIZE);
        Logger.info('TX', `Starting transfer. Total Size: ${Utils.formatBytes(this.fileBuffer.length)}, Packets: ${totalPackets}`);
        
        // 1. Send FILE_START
        const startPacket = PacketBuilder.buildFileStart(this.fileMeta.name, this.fileMeta.type, this.fileMeta.size, totalPackets);
        await this.txBle.write(startPacket);
        await Utils.sleep(100); // Allow receiver to setup
        
        // 2. Send DATA Packets
        const startTime = performance.now();
        
        for (let seq = 0; seq < totalPackets; seq++) {
            const offset = seq * CONFIG.PACKET.MAX_PAYLOAD_SIZE;
            const end = Math.min(offset + CONFIG.PACKET.MAX_PAYLOAD_SIZE, this.fileBuffer.length);
            const chunk = this.fileBuffer.slice(offset, end);
            
            const dataPacket = PacketBuilder.build(CONFIG.TYPES.DATA, seq, chunk);
            this.txBle.write(dataPacket); // Non-blocking push to queue
            
            if (seq % 100 === 0 || seq === totalPackets - 1) {
                const elapsed = (performance.now() - startTime) / 1000;
                const speed = (offset / elapsed) / 1024; // KB/s
                this.updateUI('stream-progress', `Sent: ${Utils.formatBytes(end)} / ${Utils.formatBytes(this.fileBuffer.length)} (${speed.toFixed(1)} KB/s)`);
                await Utils.sleep(10); // Yield to UI thread occasionally
            }
        }
        
        // Wait for queue to drain
        while(this.txBle.writeQueue.length > 0) {
            await Utils.sleep(50);
        }
        
        // 3. Send FILE_END
        const endPacket = PacketBuilder.buildFileEnd(totalPackets - 1, this.fileBuffer.length);
        await this.txBle.write(endPacket);
        
        Logger.info('TX', 'Transmission complete.');
        this.updateUI('stream-progress', `Transfer Complete.`);
        this.isTransmitting = false;
        document.getElementById('btn-stream').disabled = false;
    }

    handleReceivedPacket(header, payload) {
        if (header.type === CONFIG.TYPES.FILE_START) {
            this.startRxSession(payload);
        } else if (header.type === CONFIG.TYPES.DATA) {
            this.processRxData(header, payload);
        } else if (header.type === CONFIG.TYPES.FILE_END) {
            this.finishRxSession(header, payload);
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
        
        this.rxChunks = [];
        this.rxReceivedBytes = 0;
        this.rxStartTime = performance.now();
        
        Logger.info('RX', `Incoming file: ${this.rxMeta.name} (${Utils.formatBytes(this.rxMeta.size)})`);
        this.updateUI('rx-buffer-status', `Receiving: ${this.rxMeta.name}`);
        document.getElementById('rx-controls').classList.add('hidden');
    }

    processRxData(header, payload) {
        // In a perfect world, we'd place this based on header.sequence. 
        // For now, we append (assuming in-order delivery via continuous simplex optical link).
        this.rxChunks.push(payload);
        this.rxReceivedBytes += payload.length;
        
        if (header.sequence % 50 === 0) {
            const eta = Utils.calculateETA(this.rxStartTime, this.rxReceivedBytes, this.rxExpectedBytes);
            this.updateUI('rx-buffer-status', `Received: ${Utils.formatBytes(this.rxReceivedBytes)} / ${Utils.formatBytes(this.rxExpectedBytes)} (ETA: ${eta})`);
        }
    }

    finishRxSession(header, payload) {
        this.clearRxTimeout();
        
        const view = new DataView(payload.buffer, payload.byteOffset);
        const finalSeq = view.getUint16(0, false);
        const totalBytes = view.getUint32(2, false);
        
        if (this.rxReceivedBytes !== this.rxExpectedBytes || this.rxReceivedBytes !== totalBytes) {
            Logger.error('RX', `Size mismatch. Expected ${this.rxExpectedBytes}, got ${this.rxReceivedBytes}. File corrupted.`);
            this.updateUI('rx-buffer-status', 'Transfer Failed (Size Mismatch)');
            return;
        }
        
        Logger.info('RX', `File received successfully. Total: ${Utils.formatBytes(this.rxReceivedBytes)}`);
        this.updateUI('rx-buffer-status', 'Transfer Complete. Ready for playback/download.');
        
        // Assemble final blob
        this.rxBlob = new Blob(this.rxChunks, { type: this.rxMeta.type });
        this.rxChunks = []; // Free memory
        
        document.getElementById('rx-controls').classList.remove('hidden');
        
        if (this.rxMeta.type.startsWith('audio/')) {
            this.player.load(this.rxBlob);
        }
    }

    downloadReceivedFile() {
        if (this.rxBlob && this.rxMeta) {
            Utils.downloadBlob(this.rxBlob, this.rxMeta.name);
        }
    }

    resetRxTimeout() {
        this.clearRxTimeout();
        this.rxTimeout = setTimeout(() => {
            if (this.rxReceivedBytes > 0 && this.rxReceivedBytes < this.rxExpectedBytes) {
                Logger.error('RX', 'Transfer timed out. Link lost.');
                this.updateUI('rx-buffer-status', 'Transfer Failed (Timeout)');
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