/**
 * Snowflake ID Generator
 * 
 * Generates unique 64-bit IDs without coordination between nodes.
 * 
 * Bit allocation (64 bits total):
 * - 1 bit:  unused (sign bit, always 0)
 * - 41 bits: timestamp (milliseconds since custom epoch) - ~69 years
 * - 10 bits: machine ID (0-1023 machines)
 * - 12 bits: sequence number (0-4095 per millisecond)
 * 
 * Custom epoch: January 1, 2024 00:00:00 UTC
 */

const CUSTOM_EPOCH = 1704067200000n; // Jan 1, 2024 UTC

// Bit lengths
const TIMESTAMP_BITS = 41n;
const MACHINE_ID_BITS = 10n;
const SEQUENCE_BITS = 12n;

// Max values
const MAX_MACHINE_ID = (1n << MACHINE_ID_BITS) - 1n; // 1023
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n;     // 4095

// Bit shifts
const MACHINE_ID_SHIFT = SEQUENCE_BITS;
const TIMESTAMP_SHIFT = SEQUENCE_BITS + MACHINE_ID_BITS;

class SnowflakeGenerator {
  constructor(machineId = 1) {
    const mid = BigInt(machineId);
    
    if (mid < 0n || mid > MAX_MACHINE_ID) {
      throw new Error(`Machine ID must be between 0 and ${MAX_MACHINE_ID}`);
    }
    
    this.machineId = mid;
    this.sequence = 0n;
    this.lastTimestamp = -1n;
  }

  /**
   * Generate a new unique Snowflake ID
   * @returns {bigint} Unique 64-bit ID
   */
  generate() {
    let timestamp = BigInt(Date.now()) - CUSTOM_EPOCH;

    if (timestamp === this.lastTimestamp) {
      // Same millisecond - increment sequence
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
      
      if (this.sequence === 0n) {
        // Sequence overflow - wait for next millisecond
        timestamp = this.waitNextMillis(this.lastTimestamp);
      }
    } else {
      // New millisecond - reset sequence
      this.sequence = 0n;
    }

    if (timestamp < this.lastTimestamp) {
      throw new Error('Clock moved backwards! Refusing to generate ID.');
    }

    this.lastTimestamp = timestamp;

    // Combine all parts into final ID
    const id = (timestamp << TIMESTAMP_SHIFT) |
               (this.machineId << MACHINE_ID_SHIFT) |
               this.sequence;

    return id;
  }

  /**
   * Wait until the next millisecond
   * @param {bigint} lastTimestamp 
   * @returns {bigint} Current timestamp
   */
  waitNextMillis(lastTimestamp) {
    let timestamp = BigInt(Date.now()) - CUSTOM_EPOCH;
    while (timestamp <= lastTimestamp) {
      timestamp = BigInt(Date.now()) - CUSTOM_EPOCH;
    }
    return timestamp;
  }

  /**
   * Parse a Snowflake ID into its components
   * @param {bigint} id 
   * @returns {object} Parsed components
   */
  static parse(id) {
    const idBigInt = BigInt(id);
    
    const sequence = idBigInt & MAX_SEQUENCE;
    const machineId = (idBigInt >> MACHINE_ID_SHIFT) & MAX_MACHINE_ID;
    const timestamp = (idBigInt >> TIMESTAMP_SHIFT) + CUSTOM_EPOCH;
    
    return {
      timestamp: new Date(Number(timestamp)),
      machineId: Number(machineId),
      sequence: Number(sequence),
    };
  }
}

// Export singleton instance
const machineId = parseInt(process.env.MACHINE_ID || '1', 10);
export const snowflake = new SnowflakeGenerator(machineId);
export default snowflake;
