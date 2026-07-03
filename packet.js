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

        // Payload structure: FileSize(4) + TotalPackets(4) + NameLen(1) + Name + MimeLen(1) + Mime
        const payload = new Uint8Array(4 + 4 + 1 + nameBytes.length + 1 + mimeBytes.length);
        const view = new DataView(payload.buffer);
        
        view.setUint32(0, fileSize, false);
        view.setUint32(4, totalPackets, false);
        payload[8] = nameBytes.length;
        payload.set(nameBytes, 9);
        let offset = 9 + nameBytes.length;
        payload[offset] = mimeBytes.length;
        payload.set(mimeBytes, offset + 1);

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
        this.onPacketReceived = null;
    }

    pushData(data) {
        // Simple ring-buffer logic (simplified using array copying for JS)
        if (this.bufferLength + data.length > this.buffer.length) {
            const newBuffer = new Uint8Array(this.bufferLength + data.length + 4096);
            newBuffer.set(this.buffer.slice(0, this.bufferLength));
            this.buffer = newBuffer;
        }
        this.buffer.set(data, this.bufferLength);
        this.bufferLength += data.length;
        this.processBuffer();
    }

    processBuffer() {
        let offset = 0;
        
        while (offset < this.bufferLength) {
            if (this.state === 'SYNC1') {
                if (this.buffer[offset] === CONFIG.PACKET.SYNC1) {
                    this.state = 'SYNC2';
                }
                offset++;
            } else if (this.state === 'SYNC2') {
                if (this.buffer[offset] === CONFIG.PACKET.SYNC2) {
                    this.state = 'HEADER';
                    this.headerStart = offset - 1; // Start of packet including SYNC1
                } else {
                    this.state = 'SYNC1';
                    offset--; // Re-evaluate this byte as potential SYNC1
                }
                offset++;
            } else if (this.state === 'HEADER') {
                if (offset - this.headerStart >= 9) {
                    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.headerStart);
                    this.currentHeader = {
                        version: view.getUint8(2),
                        type: view.getUint8(3),
                        flags: view.getUint8(4),
                        sequence: view.getUint16(5, false),
                        length: view.getUint16(7, false)
                    };
                    
                    if (this.currentHeader.version !== CONFIG.PACKET.VERSION || this.currentHeader.length > CONFIG.PACKET.MAX_PAYLOAD_SIZE) {
                        Logger.warn("PacketParser", `Invalid header. Version: ${this.currentHeader.version}, Length: ${this.currentHeader.length}`);
                        this.state = 'SYNC1'; // Invalid header, look for next sync
                    } else {
                        this.state = 'PAYLOAD';
                    }
                } else {
                    break; // Not enough bytes for header
                }
            } else if (this.state === 'PAYLOAD') {
                const totalPacketSize = 9 + this.currentHeader.length + 2; // header(9) + payload + crc(2)
                if (offset - this.headerStart >= totalPacketSize) {
                    // We have the full packet
                    const packetStart = this.headerStart;
                    const crcStart = packetStart + 9 + this.currentHeader.length;
                    
                    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + crcStart);
                    const receivedCrc = view.getUint16(0, false);
                    const calculatedCrc = CRC16.calculate(this.buffer, packetStart + 2, 7 + this.currentHeader.length);
                    
                    if (receivedCrc === calculatedCrc) {
                        const payload = new Uint8Array(this.buffer.slice(packetStart + 9, packetStart + 9 + this.currentHeader.length));
                        if (this.onPacketReceived) {
                            this.onPacketReceived(this.currentHeader, payload);
                        }
                    } else {
                        Logger.error("PacketParser", `CRC Failure. Seq: ${this.currentHeader.sequence}`);
                    }
                    
                    offset = crcStart + 2;
                    this.state = 'SYNC1';
                } else {
                    break; // Not enough bytes for full payload + CRC
                }
            }
        }
        
        // Remove processed bytes from buffer
        if (offset > 0) {
            this.buffer.copyWithin(0, offset, this.bufferLength);
            this.bufferLength -= offset;
        }
    }
}
