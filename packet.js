import { CONFIG } from './config.js';
import { CRC16 } from './crc16.js';
import { Logger } from './logger.js';

export class PacketBuilder {
    static build(type, sequence, payload, flags = 0) {
        const payloadLen = payload ? payload.length : 0;
        if (payloadLen > CONFIG.PACKET.MAX_PAYLOAD_SIZE) {
            throw new Error(`Payload exceeds max size of ${CONFIG.PACKET.MAX_PAYLOAD_SIZE}`);
        }

        const packet = new Uint8Array(CONFIG.PACKET.OVERHEAD + payloadLen);
        const view = new DataView(packet.buffer);

        // Header
        packet[0] = CONFIG.PACKET.SYNC1;
        packet[1] = CONFIG.PACKET.SYNC2;
        packet[2] = CONFIG.PACKET.VERSION;
        packet[3] = type;
        packet[4] = flags;
        view.setUint16(5, sequence, false); // Big-Endian
        view.setUint16(7, payloadLen, false); // Big-Endian

        // Payload
        if (payloadLen > 0) {
            packet.set(payload, 9);
        }

        // CRC calculated from VERSION (index 2) to end of payload
        const crc = CRC16.calculate(packet, 2, 7 + payloadLen);
        view.setUint16(9 + payloadLen, crc, false); // Big-Endian

        return packet;
    }

    static buildFileStart(filename, mimeType, fileSize, totalPackets) {
        const encoder = new TextEncoder();
        const nameBytes = encoder.encode(filename);
        const mimeBytes = encoder.encode(mimeType);

        if (nameBytes.length > 255) {
            Logger.warn('PacketBuilder', `Filename truncated from ${nameBytes.length} to 255 bytes`);
        }
        if (mimeBytes.length > 255) {
            Logger.warn('PacketBuilder', `MIME type truncated from ${mimeBytes.length} to 255 bytes`);
        }

        const safeName = nameBytes.slice(0, 255);
        const safeMime = mimeBytes.slice(0, 255);

        // Payload: FileSize(4) + TotalPackets(4) + NameLen(1) + Name + MimeLen(1) + Mime
        const payload = new Uint8Array(4 + 4 + 1 + safeName.length + 1 + safeMime.length);
        const view = new DataView(payload.buffer);

        view.setUint32(0, fileSize, false);
        view.setUint32(4, totalPackets, false);
        payload[8] = safeName.length;
        payload.set(safeName, 9);
        let offset = 9 + safeName.length;
        payload[offset] = safeMime.length;
        payload.set(safeMime, offset + 1);

        return this.build(CONFIG.TYPES.FILE_START, 0, payload);
    }

    static buildFileEnd(finalSequence, totalBytes) {
        const payload = new Uint8Array(6);
        const view = new DataView(payload.buffer);
        view.setUint16(0, finalSequence, false);
        view.setUint32(2, totalBytes, false);

        return this.build(CONFIG.TYPES.FILE_END, finalSequence + 1, payload);
    }
}

export class PacketParser {
    constructor() {
        this.buffer = new Uint8Array(4096);
        this.bufferLength = 0;
        this.state = 'SYNC1';
        this.currentHeader = null;
        this.headerStart = 0;
        this.onPacketReceived = null;

        // Sequence tracking for gap/duplicate detection
        this.lastDataSequence = -1;

        // Link quality statistics
        this.stats = {
            packetsReceived: 0,
            crcErrors: 0,
            invalidHeaders: 0,
            syncLosses: 0,
            sequenceGaps: 0,
            duplicatePackets: 0,
            missingPackets: 0,
            bytesProcessed: 0,
        };
    }

    pushData(data) {
        this.stats.bytesProcessed += data.length;

        if (this.bufferLength + data.length > this.buffer.length) {
            const newSize = this.bufferLength + data.length + 4096;
            const newBuffer = new Uint8Array(newSize);
            newBuffer.set(this.buffer.subarray(0, this.bufferLength)); // subarray avoids copy
            this.buffer = newBuffer;
            Logger.debug('PacketParser', `Buffer expanded to ${newSize} bytes`);
        }
        this.buffer.set(data, this.bufferLength);
        this.bufferLength += data.length;
        this.processBuffer();
    }

    processBuffer() {
        while (this.bufferLength > 0) {
            if (this.state === 'SYNC1') {
                let syncIdx = -1;
                for (let i = 0; i < this.bufferLength; i++) {
                    if (this.buffer[i] === CONFIG.PACKET.SYNC1) {
                        syncIdx = i;
                        break;
                    }
                }
                if (syncIdx === -1) {
                    this.bufferLength = 0; // Consume all garbage
                    break;
                }
                if (syncIdx > 0) {
                    this._shiftBuffer(syncIdx);
                }
                this.state = 'SYNC2';
                if (this.bufferLength < 2) break; // Wait for SYNC2 byte
            }

            if (this.state === 'SYNC2') {
                if (this.buffer[1] === CONFIG.PACKET.SYNC2) {
                    this.state = 'HEADER';
                } else {
                    this.state = 'SYNC1';
                    this.stats.syncLosses++;
                    this._shiftBuffer(1); // Discard bad SYNC1
                    continue;
                }
            }

            if (this.state === 'HEADER') {
                if (this.bufferLength < 9) break; // Wait for full header
                
                const view = new DataView(this.buffer.buffer, this.buffer.byteOffset);
                this.currentHeader = {
                    version: view.getUint8(2),
                    type: view.getUint8(3),
                    flags: view.getUint8(4),
                    sequence: view.getUint16(5, false),
                    length: view.getUint16(7, false)
                };

                if (this.currentHeader.version !== CONFIG.PACKET.VERSION || this.currentHeader.length > CONFIG.PACKET.MAX_PAYLOAD_SIZE) {
                    this.stats.invalidHeaders++;
                    Logger.warn("PacketParser", `Invalid header dropped. Version: ${this.currentHeader.version}, Length: ${this.currentHeader.length}`);
                    this.state = 'SYNC1';
                    this._shiftBuffer(2); // Discard SYNC bytes and try again
                    continue;
                } else {
                    this.state = 'PAYLOAD';
                }
            }

            if (this.state === 'PAYLOAD') {
                const totalPacketSize = 9 + this.currentHeader.length + 2; 
                if (this.bufferLength < totalPacketSize) break; // Wait for full payload + CRC
                
                const crcStart = 9 + this.currentHeader.length;
                const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + crcStart);
                const receivedCrc = view.getUint16(0, false);
                const calculatedCrc = CRC16.calculate(this.buffer, 2, 7 + this.currentHeader.length);

                if (receivedCrc === calculatedCrc) {
                    this.stats.packetsReceived++;
                    const payload = new Uint8Array(this.buffer.slice(9, 9 + this.currentHeader.length));

                    if (this.currentHeader.type === CONFIG.TYPES.DATA) {
                        this._validateSequence(this.currentHeader.sequence);
                    }

                    if (this.onPacketReceived) {
                        this.onPacketReceived(this.currentHeader, payload);
                    }
                } else {
                    this.stats.crcErrors++;
                    Logger.error("PacketParser", `CRC FAILURE! Seq: ${this.currentHeader.sequence}, Expected: 0x${calculatedCrc.toString(16).toUpperCase()}, Got: 0x${receivedCrc.toString(16).toUpperCase()}`);
                }

                this._shiftBuffer(totalPacketSize);
                this.state = 'SYNC1';
            }
        }
    }

    _shiftBuffer(amount) {
        if (amount >= this.bufferLength) {
            this.bufferLength = 0;
        } else {
            this.buffer.copyWithin(0, amount, this.bufferLength);
            this.bufferLength -= amount;
        }
    }

    _validateSequence(seq) {
        if (this.lastDataSequence >= 0) {
            const expected = this.lastDataSequence + 1;
            if (seq === this.lastDataSequence) {
                this.stats.duplicatePackets++;
                Logger.warn('PacketParser', `Duplicate packet detected: Seq ${seq}`);
            } else if (seq > expected) {
                const gap = seq - expected;
                this.stats.sequenceGaps++;
                this.stats.missingPackets += gap;
                Logger.error('PacketParser', `SEQUENCE GAP: Expected Seq ${expected}, got ${seq}. Missing ${gap} packet(s)!`);
            } else if (seq < expected) {
                Logger.warn('PacketParser', `Out-of-order packet: Expected Seq ${expected}, got ${seq}`);
            }
        }
        this.lastDataSequence = seq;
    }

    getStats() {
        return { ...this.stats };
    }

    resetSequence() {
        this.lastDataSequence = -1;
    }

    resetStats() {
        for (const key in this.stats) this.stats[key] = 0;
        this.lastDataSequence = -1;
    }
}
