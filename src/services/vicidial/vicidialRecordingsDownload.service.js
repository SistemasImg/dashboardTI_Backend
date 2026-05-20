const axios = require("axios");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const archiverModule = require("archiver");
const logger = require("../../utils/logger");
const vicidialConfig = require("../../config/vicidial");

function createZipArchive() {
  if (typeof archiverModule === "function") {
    return archiverModule("zip", { zlib: { level: 9 } });
  }

  if (typeof archiverModule?.default === "function") {
    return archiverModule.default("zip", { zlib: { level: 9 } });
  }

  if (typeof archiverModule?.ZipArchive === "function") {
    return new archiverModule.ZipArchive({ zlib: { level: 9 } });
  }

  throw Object.assign(new Error("ZIP library is not available"), {
    statusCode: 500,
  });
}

const ALLOWED_HOST = vicidialConfig.ALLOWED_HOST;

function getVicidialHeaders() {
  const username =
    process.env.VICIDIAL_RECORDINGS_USER || process.env.VICIDIAL_USER;
  const password =
    process.env.VICIDIAL_RECORDINGS_PASS || process.env.VICIDIAL_PASS;

  const token = Buffer.from(`${username}:${password}`).toString("base64");

  return {
    Authorization: `Basic ${token}`,
    "User-Agent": "Mozilla/5.0",
    Referer: `${vicidialConfig.ADMIN_BASE_URL}/`,
    Origin: vicidialConfig.ORIGIN,
  };
}

function createPermissionDeniedError() {
  return Object.assign(
    new Error(
      "Vicidial user does not have permission to access recordings. Configure a user with recording access.",
    ),
    {
      statusCode: 403,
      errorCode: "VICIDIAL_RECORDINGS_PERMISSION_DENIED",
    },
  );
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function summarizeHtml(value, maxLength = 240) {
  const normalized = String(value || "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (!normalized) return "[empty html]";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function assertAllowedVicidialUrl(urlString) {
  let parsed;

  try {
    parsed = new URL(urlString);
  } catch (error) {
    logger.warn(
      `VicidialRecordingsDownloadService → invalid recording url: ${error.message}`,
    );
    throw Object.assign(new Error("Invalid url"), { statusCode: 400 });
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== ALLOWED_HOST) {
    throw Object.assign(new Error("URL host is not allowed"), {
      statusCode: 400,
    });
  }

  return parsed.toString();
}

function sanitizeFileName(value) {
  const raw = String(value || "recording").trim();
  const safe = raw.replaceAll(/[\\/:*?"<>|]/g, "_").replaceAll(/\s+/g, "_");
  return safe || "recording";
}

function ensureAudioExtension(fileName, contentType) {
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(fileName);
  if (hasExtension) return fileName;

  const type = String(contentType || "").toLowerCase();
  if (type.includes("wav")) return `${fileName}.wav`;
  if (type.includes("mpeg") || type.includes("mp3")) return `${fileName}.mp3`;
  if (type.includes("ogg")) return `${fileName}.ogg`;

  return `${fileName}.mp3`;
}

function isDownloadableAudio(contentType) {
  const type = String(contentType || "").toLowerCase();
  return type.includes("audio") || type.includes("application/octet-stream");
}

function isHtmlResponse(contentType) {
  return String(contentType || "")
    .toLowerCase()
    .includes("text/html");
}

async function streamToString(stream, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;

  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) {
      throw Object.assign(new Error("HTML response is too large"), {
        statusCode: 502,
      });
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function extractAudioUrlFromHtml(html, baseUrl) {
  const text = decodeHtmlEntities(html);
  const candidates = [];

  const quotedPattern = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let match = quotedPattern.exec(text);
  while (match) {
    candidates.push(match[1]);
    match = quotedPattern.exec(text);
  }

  const directAudioPattern =
    /https?:\/\/[^\s"'<>]+\.(?:mp3|wav|ogg)(?:\?[^\s"'<>]*)?/gi;
  match = directAudioPattern.exec(text);
  while (match) {
    candidates.push(match[0]);
    match = directAudioPattern.exec(text);
  }

  const recordingPathPattern = /\/[^\s"'<>]*RECORDINGS[^\s"'<>]*/gi;
  match = recordingPathPattern.exec(text);
  while (match) {
    candidates.push(match[0]);
    match = recordingPathPattern.exec(text);
  }

  const jsOpenPattern = /window\.open\(\s*["']([^"']+)["']/gi;
  match = jsOpenPattern.exec(text);
  while (match) {
    candidates.push(match[1]);
    match = jsOpenPattern.exec(text);
  }

  const locationAssignPattern =
    /(?:location|document\.location|window\.location|top\.location)\s*=\s*["']([^"']+)["']/gi;
  match = locationAssignPattern.exec(text);
  while (match) {
    candidates.push(match[1]);
    match = locationAssignPattern.exec(text);
  }

  const looseQuotedPattern = /["']([^"']+)["']/g;
  match = looseQuotedPattern.exec(text);
  while (match) {
    const value = match[1] || "";
    const upper = value.toUpperCase();
    const seemsAudioLike =
      value.includes(".mp3") ||
      value.includes(".wav") ||
      value.includes(".ogg") ||
      upper.includes("RECORDINGS") ||
      upper.includes("MONITOR") ||
      upper.includes("RECORDING");

    if (seemsAudioLike) {
      candidates.push(value);
    }

    match = looseQuotedPattern.exec(text);
  }

  for (const raw of candidates) {
    if (!raw) continue;

    try {
      const resolved = new URL(raw, baseUrl).toString();
      const parsed = new URL(resolved);
      const isAllowedHost =
        parsed.protocol === "https:" && parsed.hostname === ALLOWED_HOST;

      if (isAllowedHost) {
        return resolved;
      }
    } catch (error) {
      logger.warn(
        `VicidialRecordingsDownloadService → invalid extracted audio URL: ${error.message}`,
      );
    }
  }

  return null;
}

async function fetchRawRecording(url, responseType = "stream") {
  return axios.get(url, {
    headers: {
      ...getVicidialHeaders(),
      Referer: url,
      Accept: "audio/*,*/*;q=0.9",
    },
    responseType,
    timeout: 60000,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 300,
  });
}

function getUniqueFileName(fileName, usedNames) {
  const extensionMatch = fileName.match(/(\.[a-z0-9]{2,5})$/i);
  const extension = extensionMatch ? extensionMatch[1] : "";
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;

  if (!usedNames.has(fileName)) {
    usedNames.add(fileName);
    return fileName;
  }

  let suffix = 1;
  while (usedNames.has(`${baseName}_${suffix}${extension}`)) {
    suffix += 1;
  }

  const uniqueName = `${baseName}_${suffix}${extension}`;
  usedNames.add(uniqueName);
  return uniqueName;
}

async function fetchRecordingStream(url) {
  const firstResponse = await fetchRawRecording(url, "stream");
  const firstContentType =
    firstResponse.headers["content-type"] || "application/octet-stream";

  if (isDownloadableAudio(firstContentType)) {
    return {
      stream: firstResponse.data,
      contentType: firstContentType,
    };
  }

  if (!isHtmlResponse(firstContentType)) {
    throw Object.assign(
      new Error(`Unexpected content-type for recording: ${firstContentType}`),
      { statusCode: 502 },
    );
  }

  const html = await streamToString(firstResponse.data);
  const audioUrl = extractAudioUrlFromHtml(html, url);

  if (!audioUrl) {
    const htmlSummary = summarizeHtml(html);
    const isLikelyLogin = /login|username|password|VD_login/i.test(html);
    const isPermissionDenied =
      /do not have permissions to access recordings/i.test(html);
    logger.warn(
      `VicidialRecordingsDownloadService → HTML did not expose direct audio URL. loginLike=${isLikelyLogin}. summary="${htmlSummary}"`,
    );

    if (isPermissionDenied) {
      throw createPermissionDeniedError();
    }

    throw Object.assign(
      new Error("Unable to extract audio URL from Vicidial HTML response"),
      { statusCode: 502 },
    );
  }

  logger.info(
    `VicidialRecordingsDownloadService → resolved HTML recording page to audio URL: ${audioUrl}`,
  );

  const secondResponse = await fetchRawRecording(audioUrl, "stream");
  const secondContentType =
    secondResponse.headers["content-type"] || "application/octet-stream";

  if (isHtmlResponse(secondContentType)) {
    const html = await streamToString(secondResponse.data);
    if (/do not have permissions to access recordings/i.test(html)) {
      throw createPermissionDeniedError();
    }

    throw Object.assign(
      new Error(
        "Vicidial returned HTML instead of audio for the resolved recording URL",
      ),
      { statusCode: 502 },
    );
  }

  if (!isDownloadableAudio(secondContentType)) {
    throw Object.assign(
      new Error(`Unexpected content-type for recording: ${secondContentType}`),
      { statusCode: 502 },
    );
  }

  return {
    stream: secondResponse.data,
    contentType: secondContentType,
  };
}

async function downloadRecordingToTempFile({ url, fileName, tempDir }) {
  const { stream, contentType } = await fetchRecordingStream(url);

  const finalName = ensureAudioExtension(fileName, contentType);
  const filePath = path.join(tempDir, finalName);

  await pipeline(stream, fs.createWriteStream(filePath));

  const stats = await fsPromises.stat(filePath);
  if (!stats.size || stats.size < 2048) {
    throw Object.assign(
      new Error(`Downloaded file is too small (${stats.size} bytes)`),
      { statusCode: 502 },
    );
  }

  return {
    filePath,
    fileName: finalName,
    size: stats.size,
  };
}

async function streamSingleRecordingProxy({ url, filename, res }) {
  const safeUrl = assertAllowedVicidialUrl(url);
  const safeBaseName = sanitizeFileName(filename || "recording");

  const { stream, contentType } = await fetchRecordingStream(safeUrl);

  if (!isDownloadableAudio(contentType)) {
    throw Object.assign(
      new Error(`Unexpected content-type for recording: ${contentType}`),
      { statusCode: 502 },
    );
  }

  const finalName = ensureAudioExtension(safeBaseName, contentType);

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${finalName}"`);

  stream.on("error", (error) => {
    logger.error(
      `VicidialRecordingsDownloadService → single stream error: ${error.message}`,
    );
    if (res.headersSent) {
      res.end();
      return;
    }

    res
      .status(500)
      .json({ success: false, message: "Error streaming recording" });
  });

  stream.pipe(res);
}

async function streamRecordingsZip({
  recordings,
  minDurationSeconds,
  zipName,
  res,
}) {
  if (!Array.isArray(recordings) || recordings.length === 0) {
    throw Object.assign(new Error("recordings must be a non-empty array"), {
      statusCode: 400,
    });
  }

  const minSeconds = Number.isInteger(minDurationSeconds)
    ? minDurationSeconds
    : 120;

  const filtered = recordings.filter((item) => {
    if (typeof item.durationSeconds !== "number") return true;
    return item.durationSeconds >= minSeconds;
  });

  if (!filtered.length) {
    throw Object.assign(
      new Error("No recordings matched the minimum duration filter"),
      { statusCode: 400 },
    );
  }

  const safeZipName = sanitizeFileName(zipName || "vicidial_recordings");
  const finalZipName = safeZipName.toLowerCase().endsWith(".zip")
    ? safeZipName
    : `${safeZipName}.zip`;

  const tempDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "vicidial-recordings-"),
  );
  const usedNames = new Set();
  const downloaded = [];
  let permissionDeniedCount = 0;

  try {
    for (let index = 0; index < filtered.length; index += 1) {
      const item = filtered[index];

      try {
        const safeUrl = assertAllowedVicidialUrl(item.url);
        const safeBaseName = sanitizeFileName(
          item.fileName || `recording_${index + 1}`,
        );
        const baseWithExt = ensureAudioExtension(safeBaseName, "");
        const uniqueName = getUniqueFileName(baseWithExt, usedNames);

        const file = await downloadRecordingToTempFile({
          url: safeUrl,
          fileName: uniqueName,
          tempDir,
        });

        downloaded.push(file);
        logger.info(
          `VicidialRecordingsDownloadService → downloaded ${file.fileName} (${file.size} bytes)`,
        );
      } catch (error) {
        if (error?.errorCode === "VICIDIAL_RECORDINGS_PERMISSION_DENIED") {
          permissionDeniedCount += 1;
        }
        logger.warn(
          `VicidialRecordingsDownloadService → skipped recording ${index + 1}: ${error.message}`,
        );
      }
    }

    if (!downloaded.length) {
      if (permissionDeniedCount === filtered.length) {
        throw createPermissionDeniedError();
      }

      throw Object.assign(
        new Error(
          "No valid recordings were downloaded from Vicidial for ZIP generation",
        ),
        { statusCode: 502 },
      );
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${finalZipName}"`,
    );

    const archive = createZipArchive();

    archive.on("error", (error) => {
      logger.error(
        `VicidialRecordingsDownloadService → zip error: ${error.message}`,
      );
      if (res.headersSent) {
        res.end();
        return;
      }

      res.status(500).json({ success: false, message: "Error generating ZIP" });
    });

    archive.pipe(res);

    downloaded.forEach((file) => {
      archive.file(file.filePath, { name: file.fileName });
    });

    const zipDone = new Promise((resolve, reject) => {
      res.on("finish", resolve);
      res.on("error", reject);
      archive.on("error", reject);
    });

    await archive.finalize();
    await zipDone;

    logger.info(
      `VicidialRecordingsDownloadService → ZIP generated with ${downloaded.length} files`,
    );
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  streamSingleRecordingProxy,
  streamRecordingsZip,
  fetchRecordingStream,
};
