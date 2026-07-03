/**
 * Configuration module for the VLC Digital Data Link
 * Contains all the shared constants to ensure consistency across the application.
 */

export const CONFIG = {
    // BLE Configuration
    BLE: {
        SERVICE_UUID: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
        TX_CHARACTERISTIC: "6e400002-b5a3-f393-e0a9-e50e24dcca9e", // Browser writes here
        RX_CHARACTERISTIC: "6e400003-b5a3-f393-e0a9-e50e24dcca9e", // Browser reads from here
        MAX_MTU: 512,
    },

    // Packet Configuration
    PACKET: {
        SYNC1: 0xAA,
        SYNC2: 0x55,
        VERSION: 0x01,
        MAX_PAYLOAD_SIZE: 240, // Bytes. Chosen to fit within BLE MTU and ESP32 buffers
        HEADER_SIZE: 8,        // SYNC1, SYNC2, VER, TYPE, FLAGS, SEQ(2), LEN(2) (Actually 9 bytes. Wait: 1+1+1+1+1+2+2 = 9)
        // Let's correct header size: SYNC1(1) + SYNC2(1) + VER(1) + TYPE(1) + FLAGS(1) + SEQ(2) + LEN(2) = 9 bytes
        // CRC is 2 bytes at the end.
        OVERHEAD: 11,          // 9 bytes header + 2 bytes CRC
    },

    // Packet Types
    TYPES: {
        FILE_START: 0x01,
        DATA: 0x02,
        FILE_END: 0x03,
        HEARTBEAT: 0x04,
        ACK: 0x05,
        NAK: 0x06,
        ERROR: 0x07,
    },

    // Transfer Settings
    TRANSFER: {
        RX_TIMEOUT_MS: 3000,   // How long to wait before declaring transfer failed on RX
        TX_DELAY_MS: 5,        // Delay between BLE packet writes to prevent stack overflow
    },

    // Logging Configuration
    LOGGING: {
        LEVELS: {
            DEBUG: 0,
            INFO: 1,
            WARN: 2,
            ERROR: 3
        },
        CURRENT_LEVEL: 0, // Set to INFO(1) in production
    }
};
