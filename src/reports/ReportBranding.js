/**
 * ReportBranding.js — Logo upload, validation, and canvas compression.
 *
 * Compresses uploaded images to max 400×400px before base64 encoding.
 * Only accepts PNG and JPG. Rejects URLs (CORS risk) and files >2MB.
 */

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB input limit
const MAX_DIMENSION  = 400;              // px after resize
const COMPRESS_QUAL  = 0.82;            // JPEG quality for compressed output

/**
 * Reads a File object, validates it, compresses via canvas, and returns
 * a base64 data URL (image/jpeg) ready to store in localStorage.
 *
 * @param {File} file
 * @returns {Promise<string>} base64 data URL
 */
export async function processLogoFile(file) {
  if (!file) throw new Error('No file provided.');

  if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
    throw new Error('Only PNG and JPG files are accepted as logo.');
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 2 MB.`);
  }

  const dataUrl = await _readFileAsDataURL(file);
  const compressed = await _compressImage(dataUrl);
  return compressed;
}

/**
 * Validates that a string is a base64 data URL (not an external URL).
 * External URLs are rejected to avoid CORS issues in html2canvas.
 */
export function validateLogoDataUrl(value) {
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) {
    throw new Error('External URLs are not accepted as logo. Please upload a PNG or JPG file directly.');
  }
  if (!value.startsWith('data:image/')) {
    throw new Error('Invalid logo format. Please upload a PNG or JPG file.');
  }
  return value;
}

function _readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

function _compressImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      // Downscale if too large
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const compressed = canvas.toDataURL('image/jpeg', COMPRESS_QUAL);
      resolve(compressed);
    };
    img.onerror = () => reject(new Error('Failed to decode image.'));
    img.src = dataUrl;
  });
}

/**
 * Returns an HTMLImageElement pre-loaded from a base64 data URL.
 * Used by ReportSections to embed logo into jsPDF.
 *
 * @param {string} dataUrl
 * @returns {Promise<HTMLImageElement>}
 */
export function loadLogoImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load logo image.'));
    img.src = dataUrl;
  });
}
