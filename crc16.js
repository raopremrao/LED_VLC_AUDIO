/**
 * CRC16-CCITT Implementation
 * Polynomial: 0x1021
 * Initial Value: 0xFFFF
 */

export class CRC16 {
    static calculate(data, offset = 0, length = data.length) {
        let crc = 0xFFFF;
        for (let i = offset; i < offset + length; i++) {
            crc ^= (data[i] << 8);
            for (let j = 0; j < 8; j++) {
                if ((crc & 0x8000) !== 0) {
                    crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
                } else {
                    crc = (crc << 1) & 0xFFFF;
                }
            }
        }
        return crc & 0xFFFF;
    }
}
