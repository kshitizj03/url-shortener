/**
 * Base62 Encoder/Decoder
 * 
 * Converts BigInt IDs to short alphanumeric strings.
 * Charset: 0-9, a-z, A-Z (62 characters)
 * 
 * Example:
 *   123456789n → "8m0Kx"
 */

const CHARSET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = BigInt(CHARSET.length); // 62n

/**
 * Encode a BigInt to a Base62 string
 * @param {bigint|number|string} num - Number to encode
 * @returns {string} Base62 encoded string
 */
export function encode(num) {
  let n = BigInt(num);
  
  if (n === 0n) {
    return CHARSET[0];
  }
  
  if (n < 0n) {
    throw new Error('Cannot encode negative numbers');
  }
  
  let result = '';
  
  while (n > 0n) {
    const remainder = n % BASE;
    result = CHARSET[Number(remainder)] + result;
    n = n / BASE;
  }
  
  return result;
}

/**
 * Decode a Base62 string back to BigInt
 * @param {string} str - Base62 encoded string
 * @returns {bigint} Decoded number
 */
export function decode(str) {
  if (!str || typeof str !== 'string') {
    throw new Error('Invalid input: expected non-empty string');
  }
  
  let result = 0n;
  
  for (const char of str) {
    const index = CHARSET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid character in Base62 string: ${char}`);
    }
    result = result * BASE + BigInt(index);
  }
  
  return result;
}

export default { encode, decode };
