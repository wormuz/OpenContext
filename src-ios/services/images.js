const FileSystem = require('expo-file-system');
const { generateStableId } = require('../utils/uuid');

const APP_ROOT = `${FileSystem.documentDirectory}opencontext/`;
const IMAGES_ROOT = `${APP_ROOT}images/`;

async function ensureImagesRoot() {
  await FileSystem.makeDirectoryAsync(IMAGES_ROOT, { intermediates: true });
}

function inferExtension(asset) {
  const source = asset?.fileName || asset?.uri || '';
  const match = source.match(/\.([a-z0-9]+)(?:\?|$)/i);
  if (match) {
    return match[1].toLowerCase();
  }
  return 'jpg';
}

async function importImageAsset(asset) {
  if (!asset?.uri) return null;
  await ensureImagesRoot();
  const ext = inferExtension(asset);
  const name = `${Date.now().toString(36)}-${generateStableId().slice(0, 8)}.${ext}`;
  const dest = `${IMAGES_ROOT}${name}`;
  await FileSystem.copyAsync({ from: asset.uri, to: dest });
  return dest;
}

module.exports = {
  importImageAsset,
};
