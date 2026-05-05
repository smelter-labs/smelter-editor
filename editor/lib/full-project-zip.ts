import JSZip from 'jszip';
import {
  buildRoomConfigFileName,
  parseRoomConfig,
  type RoomConfig,
  type RoomConfigInput,
} from './room-config';

type FullProjectAssetKind = 'mp4' | 'audio' | 'image';

type FullProjectManifestAsset = {
  kind: FullProjectAssetKind;
  path: string;
  inputIndex?: number;
};

type FullProjectManifest = {
  version: 1;
  assets: FullProjectManifestAsset[];
};

type FullProjectImportProgress = {
  phase: string;
  current: number;
  total: number;
};

const ROOM_CONFIG_FILE = 'room-config.json';
const MANIFEST_FILE = 'manifest.json';
const MAX_FOLDER_DEPTH = 3;

const ASSET_BASE_DIR: Record<FullProjectAssetKind, string> = {
  mp4: 'mp4s',
  audio: 'audios',
  image: 'pictures',
};

const DOWNLOAD_ROUTE: Record<FullProjectAssetKind, string> = {
  mp4: 'mp4',
  audio: 'audio',
  image: 'picture',
};

const UPLOAD_ROUTE: Record<FullProjectAssetKind, string> = {
  mp4: '/api/upload/mp4',
  audio: '/api/upload/audio',
  image: '/api/upload/picture',
};

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('Asset path is empty.');
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Asset path contains invalid segments: ${value}`);
  }
  return segments.join('/');
}

function assertFolderDepth(relativePath: string): void {
  const segments = relativePath.split('/');
  const folderDepth = Math.max(0, segments.length - 1);
  if (folderDepth > MAX_FOLDER_DEPTH) {
    throw new Error(
      `Asset folder depth exceeds ${MAX_FOLDER_DEPTH}: ${relativePath}`,
    );
  }
}

function encodePathSegments(relativePath: string): string {
  return relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function pushAssetFromInput(
  assets: FullProjectManifestAsset[],
  input: RoomConfigInput,
  inputIndex: number,
): void {
  if (input.type === 'local-mp4' && input.mp4FileName) {
    const relative = normalizeRelativePath(input.mp4FileName);
    assertFolderDepth(relative);
    assets.push({
      kind: 'mp4',
      path: `${ASSET_BASE_DIR.mp4}/${relative}`,
      inputIndex,
    });
  }

  if (input.type === 'local-mp4' && input.audioFileName) {
    const relative = normalizeRelativePath(input.audioFileName);
    assertFolderDepth(relative);
    assets.push({
      kind: 'audio',
      path: `${ASSET_BASE_DIR.audio}/${relative}`,
      inputIndex,
    });
  }

  if (input.type === 'image' && input.imageFileName) {
    const relative = normalizeRelativePath(input.imageFileName);
    assertFolderDepth(relative);
    assets.push({
      kind: 'image',
      path: `${ASSET_BASE_DIR.image}/${relative}`,
      inputIndex,
    });
  }
}

export function buildFullProjectManifest(
  config: RoomConfig,
): FullProjectManifest {
  const assets: FullProjectManifestAsset[] = [];
  config.inputs.forEach((input, inputIndex) =>
    pushAssetFromInput(assets, input, inputIndex),
  );

  const deduped = new Map<string, FullProjectManifestAsset>();
  for (const asset of assets) {
    const key = `${asset.kind}:${asset.path}`;
    if (!deduped.has(key)) {
      deduped.set(key, asset);
    }
  }

  return {
    version: 1,
    assets: [...deduped.values()],
  };
}

function getMissingAssetReferences(config: RoomConfig): string[] {
  const missing: string[] = [];
  config.inputs.forEach((input, index) => {
    if (input.type === 'local-mp4') {
      if (!input.mp4FileName && !input.audioFileName) {
        missing.push(`inputs[${index}] local-mp4 has no file reference`);
      }
    }
    if (input.type === 'image' && !input.imageFileName) {
      missing.push(`inputs[${index}] image has no imageFileName`);
    }
  });
  return missing;
}

async function fetchAssetData(
  asset: FullProjectManifestAsset,
): Promise<ArrayBuffer> {
  const baseDir = ASSET_BASE_DIR[asset.kind];
  if (!asset.path.startsWith(`${baseDir}/`)) {
    throw new Error(`Invalid ${asset.kind} asset path: ${asset.path}`);
  }

  const relativePath = asset.path.slice(baseDir.length + 1);
  const encoded = encodePathSegments(relativePath);
  const response = await fetch(
    `/api/download/${DOWNLOAD_ROUTE[asset.kind]}/${encoded}`,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to download asset (${asset.path}): ${response.status} ${response.statusText}`,
    );
  }
  const data = await response.arrayBuffer();
  if (data.byteLength === 0) {
    throw new Error(
      `Downloaded asset is empty (${asset.path}). Check source file and download route.`,
    );
  }
  return data;
}

async function uploadAsset(
  asset: FullProjectManifestAsset,
  zip: JSZip,
): Promise<void> {
  const zipEntry = zip.file(asset.path);
  if (!zipEntry) {
    throw new Error(`Missing file in zip archive: ${asset.path}`);
  }

  const baseDir = ASSET_BASE_DIR[asset.kind];
  if (!asset.path.startsWith(`${baseDir}/`)) {
    throw new Error(
      `Invalid ${asset.kind} asset path in manifest: ${asset.path}`,
    );
  }

  const relativePath = asset.path.slice(baseDir.length + 1);
  const normalizedRelative = normalizeRelativePath(relativePath);
  assertFolderDepth(normalizedRelative);

  const segments = normalizedRelative.split('/');
  const fileName = segments[segments.length - 1];
  const folder = segments.slice(0, -1).join('/');

  const blob = await zipEntry.async('blob');
  const formData = new FormData();
  if (folder) {
    formData.append('folder', folder);
  }
  formData.append('file', new File([blob], fileName, { type: blob.type }));

  const response = await fetch(UPLOAD_ROUTE[asset.kind], {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(
      `Failed to upload ${asset.path}: ${response.status} ${response.statusText}${bodyText ? ` - ${bodyText}` : ''}`,
    );
  }
}

function applyManifestToConfig(
  config: RoomConfig,
  manifest: FullProjectManifest,
): RoomConfig {
  const normalizedInputs = config.inputs.map((input) => ({ ...input }));

  for (const asset of manifest.assets) {
    if (asset.inputIndex === undefined) {
      continue;
    }
    const input = normalizedInputs[asset.inputIndex];
    if (!input) {
      continue;
    }

    const baseDir = ASSET_BASE_DIR[asset.kind];
    const relativePath = asset.path.startsWith(`${baseDir}/`)
      ? asset.path.slice(baseDir.length + 1)
      : asset.path;

    if (asset.kind === 'mp4') {
      input.mp4FileName = relativePath;
    } else if (asset.kind === 'audio') {
      input.audioFileName = relativePath;
    } else if (asset.kind === 'image') {
      input.imageFileName = relativePath;
    }
  }

  return {
    ...config,
    inputs: normalizedInputs,
  };
}

export async function downloadFullProjectZip(
  config: RoomConfig,
  fileName?: string,
): Promise<void> {
  const missing = getMissingAssetReferences(config);
  if (missing.length > 0) {
    throw new Error(
      `Cannot build full project archive. Missing asset references: ${missing.join(', ')}`,
    );
  }

  const manifest = buildFullProjectManifest(config);
  const zip = new JSZip();

  zip.file(ROOM_CONFIG_FILE, JSON.stringify(config, null, 2));
  zip.file(MANIFEST_FILE, JSON.stringify(manifest, null, 2));

  for (const asset of manifest.assets) {
    const data = await fetchAssetData(asset);
    zip.file(asset.path, data);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(
    zipBlob,
    fileName ?? buildRoomConfigFileName(config, 'room-project', 'zip'),
  );
}

export async function importFullProjectZip(
  file: File,
  callbacks?: {
    onProgress?: (event: FullProjectImportProgress) => void;
  },
): Promise<RoomConfig> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const roomConfigEntry = zip.file(ROOM_CONFIG_FILE);
  if (!roomConfigEntry) {
    throw new Error(`Archive is missing ${ROOM_CONFIG_FILE}.`);
  }

  const roomConfigText = await roomConfigEntry.async('text');
  const config = parseRoomConfig(roomConfigText);

  const manifestEntry = zip.file(MANIFEST_FILE);
  const manifest = manifestEntry
    ? (JSON.parse(await manifestEntry.async('text')) as FullProjectManifest)
    : buildFullProjectManifest(config);

  if (manifest.version !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error('Invalid project archive manifest.');
  }

  const total = manifest.assets.length || 1;
  let current = 0;
  for (const asset of manifest.assets) {
    current += 1;
    callbacks?.onProgress?.({
      phase: `Uploading ${asset.path}`,
      current,
      total,
    });
    await uploadAsset(asset, zip);
  }

  return applyManifestToConfig(config, manifest);
}
