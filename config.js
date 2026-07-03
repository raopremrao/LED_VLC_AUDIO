/**
 * Configuration module for the VLC Digital Data Link
 * Contains all shared constants to ensure consistency across the application.
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
        HEADER_SIZE: 9,        // SYNC1(1) + SYNC2(1) + VER(1) + TYPE(1) + FLAGS(1) + SEQ(2) + LEN(2) = 9 bytes
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
        RX_TIMEOUT_MS: 30000,       
        BASE_TX_DELAY_MS: 260,      // 260ms per packet at 9600 baud
        MAX_TX_DELAY_MS: 1000,      // Max delay under backpressure
        MAX_WRITE_QUEUE: 50,       // Max queued BLE writes before backpressure kicks in
        MAX_RETRIES: 3,            // BLE write retry attempts before dropping
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
        MAX_LOG_ENTRIES: 1000, // Cap DOM log entries to prevent performance degradation
    }
};
